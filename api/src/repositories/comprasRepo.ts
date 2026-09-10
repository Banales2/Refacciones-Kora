import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { CompraCreate } from '../schemas/compraSchema'
import * as facturasRepo from './facturasRepo'
import * as unidadesRepo from './unidadesPiezaRepo'

// Un renglón ya guardado, con la forma que el front necesita para ofrecerlo
// como existencia consumible: es la misma que devuelve `lotes-disponibles`, así
// que la compra se puede usar en el mantenimiento sin esperar a que esa lista
// se refresque.
export interface CompraLote {
  id: number
  pieza_id: number
  /** Para poder ofrecer la posición en la que se monta, sin recargar la lista. */
  tipo_pieza_id: number | null
  numero_serie: string
  descripcion: string
  costo_unitario: number
  cantidad_disponible: number
  fecha_compra: string
  sucursal_id: number
  sucursal: string
  /**
   * Tasa de IVA a sumarle al costo, en por ciento. `null` = el precio ya lo
   * incluye. Es la misma en los N renglones: el IVA es de la factura.
   */
  tasa_iva: number | null
  /**
   * Descuento de la factura, en por ciento, que se resta ANTES del IVA. `null`
   * = sin descuento. No toca `costo_unitario`: es de la factura completa, así
   * que solo cambia su total, no lo que vale la pieza en inventario.
   */
  descuento_pct: number | null
  /** Verdadero si la refacción se dio de alta en esta misma compra. */
  pieza_nueva: boolean
}

export interface CompraCreada {
  num_factura: string
  lotes: CompraLote[]
}

/**
 * Guarda la factura completa en una sola transacción: las refacciones nuevas,
 * sus lotes y las existencias que estos meten en la sucursal que recibe.
 *
 * Todo o nada, a propósito. Hacerlo renglón por renglón (un POST por lote,
 * como hacía la captura encadenada) deja media factura registrada cuando el
 * quinto renglón falla, y el hueco no se ve: los cuatro primeros ya son stock
 * real y nadie sabe que faltan los demás. Aquí, o entra la factura entera o no
 * entra nada y el usuario corrige sobre lo que ya tenía capturado.
 *
 * `cantidad_disponible` se sigue escribiendo mientras la columna exista, por lo
 * mismo que en `lotesRepo.create`: que quien mire la tabla a mano no vea un
 * cero engañoso. Nadie la lee — el stock sale de `existencias_lote`.
 */
export async function crearCompra(
  data: CompraCreate, autorizadoPor: string,
): Promise<CompraCreada> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    // La cabecera, una sola vez. Antes se copiaba en los N renglones, y esa
    // copia era la que dejaba facturas con la tasa o el descuento disparejos.
    // Si el proveedor ya tiene ese folio, los renglones entran en la factura que
    // ya existe: es el mismo papel capturado en dos tandas.
    const facturaId = await facturasRepo.findOrCreate(tx, {
      proveedor_id:   data.proveedor_id,
      folio:          data.num_factura,
      fecha_compra:   data.fecha_compra,
      tasa_iva:       data.tasa_iva ?? null,
      descuento_pct:  data.descuento_pct ?? null,
      comprado_por:   data.comprado_por,
      autorizado_por: autorizadoPor,
    })

    const sucursal = await tx.request()
      .input('id', sql.Int, data.sucursal_id)
      .query('SELECT nombre FROM sucursales WHERE id = @id')
    const nombreSucursal: string = sucursal.recordset[0]?.nombre ?? ''

    const lotes: CompraLote[] = []

    for (const renglon of data.renglones) {
      let piezaId = renglon.pieza_id
      let numeroSerie: string
      let descripcion: string
      let tipoPiezaId: number | null

      if (renglon.pieza_nueva) {
        const nueva = await tx.request()
          .input('ns', sql.NVarChar(80), renglon.pieza_nueva.numero_serie)
          .input('desc', sql.NVarChar(300), renglon.pieza_nueva.descripcion)
          .input('tipoPiezaId', sql.Int, renglon.pieza_nueva.tipo_pieza_id)
          .query(`
            INSERT INTO piezas (numero_serie, descripcion, tipo_pieza_id)
            OUTPUT INSERTED.id
            VALUES (@ns, @desc, @tipoPiezaId)`)
        piezaId = nueva.recordset[0].id as number
        numeroSerie = renglon.pieza_nueva.numero_serie
        descripcion = renglon.pieza_nueva.descripcion
        tipoPiezaId = renglon.pieza_nueva.tipo_pieza_id
      } else {
        const pieza = await tx.request()
          .input('id', sql.Int, piezaId!)
          .query('SELECT numero_serie, descripcion, tipo_pieza_id FROM piezas WHERE id = @id')
        const fila = pieza.recordset[0]
        // El service ya verificó que existe; si desapareció entre la validación
        // y aquí, la transacción entera se cae y no queda media factura.
        if (!fila) throw new Error(`La refacción ${piezaId} ya no existe`)
        numeroSerie = fila.numero_serie
        descripcion = fila.descripcion
        tipoPiezaId = fila.tipo_pieza_id
      }

      const insLote = await tx.request()
        .input('pieza_id', sql.Int, piezaId!)
        .input('factura_id', sql.Int, facturaId)
        .input('sucursal_id', sql.Int, data.sucursal_id)
        .input('costo_unitario', sql.Decimal(18, 2), renglon.costo_unitario)
        .input('cantidad_inicial', sql.Int, renglon.cantidad_inicial)
        .query(`
          INSERT INTO lotes_pieza
            (pieza_id, factura_id, sucursal_id, costo_unitario,
             cantidad_inicial, cantidad_disponible)
          OUTPUT INSERTED.id
          VALUES (@pieza_id, @factura_id, @sucursal_id, @costo_unitario,
                  @cantidad_inicial, @cantidad_inicial)`)
      const loteId = insLote.recordset[0].id as number

      await tx.request()
        .input('lote_id', sql.Int, loteId)
        .input('sucursal_id', sql.Int, data.sucursal_id)
        .input('cantidad', sql.Int, renglon.cantidad_inicial)
        .query(`
          INSERT INTO existencias_lote (lote_id, sucursal_id, cantidad)
          VALUES (@lote_id, @sucursal_id, @cantidad)`)

      // Si la refacción es de un tipo que se rastrea una por una, cada unidad
      // que entra nace aquí con su identidad. Va en la misma transacción que la
      // existencia: unidades sin existencia (o al revés) es justo la
      // divergencia que hay que evitar mientras las dos capas convivan.
      if (await unidadesRepo.piezaEsRastreada(tx, piezaId!)) {
        await unidadesRepo.crearDeCompra(
          tx, piezaId!, loteId, data.sucursal_id, renglon.cantidad_inicial,
        )
      }

      lotes.push({
        id: loteId,
        pieza_id: piezaId!,
        tipo_pieza_id: tipoPiezaId,
        numero_serie: numeroSerie,
        descripcion,
        costo_unitario: renglon.costo_unitario,
        // El lote acaba de entrar completo: lo disponible es lo que se compró.
        cantidad_disponible: renglon.cantidad_inicial,
        fecha_compra: data.fecha_compra,
        sucursal_id: data.sucursal_id,
        sucursal: nombreSucursal,
        tasa_iva: data.tasa_iva ?? null,
        descuento_pct: data.descuento_pct ?? null,
        pieza_nueva: renglon.pieza_nueva !== undefined,
      })
    }

    await tx.commit()
    return { num_factura: data.num_factura, lotes }
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
