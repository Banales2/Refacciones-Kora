import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { ImportacionHistorica } from '../schemas/historicoSchema'
import { ValidationError } from '../shared/errors'

// La carga de facturas anteriores al sistema.
//
// Escribe lo mismo que una compra —factura, lotes, existencia— con dos
// diferencias que son toda la razón de que este archivo exista aparte de
// `comprasRepo`:
//
//   existencia = 0   Las piezas se compraron y se gastaron. `cantidad_inicial`
//                    dice cuántas entraron —y es lo que multiplica al costo en
//                    todo reporte de gasto—; la existencia dice cuántas hay hoy
//                    en el estante, que son ninguna. El stock siempre sale de
//                    `existencias_lote`, así que el almacén no ve nada de esto.
//   sin unidades     Una unidad es una pieza física que se puede ir a tocar, y
//                    estas ya no existen. Con la existencia en cero, el cuadre
//                    de unidades contra existencias sigue dando cero a cero.
//
// Ver `db/migrations/028_facturas_historicas.sql`.

/**
 * Lo único que estas consultas necesitan de quien las corre. El pool y una
 * transacción lo cumplen igual, y así la misma lectura sirve para el vistazo
 * previo del service —sin transacción— y para la importación, que va dentro de
 * la suya y tiene que ver lo que ella misma acaba de escribir.
 */
type Consultable = { request(): sql.Request }

/** Una refacción que el archivo trajo y que no estaba en el catálogo. */
export interface PiezaDadaDeAlta {
  id: number
  numero_serie: string
  descripcion: string
}

export interface ImportacionResultado {
  facturas_creadas: number
  /**
   * Folios que el proveedor ya tenía registrados y que no se tocaron. Ver
   * `importar`: reimportar el mismo archivo no duplica nada.
   */
  folios_omitidos: string[]
  /** Renglones que sí entraron; los de los folios omitidos no cuentan. */
  renglones_creados: number
  piezas_nuevas: PiezaDadaDeAlta[]
}

/**
 * Los ids de las series que ya están en el catálogo, en una sola consulta.
 *
 * Va por tandas de 500 porque SQL Server no admite más de 2,100 parámetros en
 * una consulta, y un archivo puede traer más series que eso.
 */
async function piezasPorSerie(
  origen: Consultable, series: string[],
): Promise<Map<string, number>> {
  const encontradas = new Map<string, number>()
  for (let i = 0; i < series.length; i += 500) {
    const tanda = series.slice(i, i + 500)
    const req = origen.request()
    const params = tanda.map((serie, j) => {
      req.input(`s${j}`, sql.NVarChar(80), serie)
      return `@s${j}`
    })
    const res = await req.query(
      `SELECT id, numero_serie FROM piezas WHERE numero_serie IN (${params.join(', ')})`,
    )
    for (const fila of res.recordset) {
      encontradas.set(fila.numero_serie as string, fila.id as number)
    }
  }
  return encontradas
}

/**
 * Cuáles de esas series ya están en el catálogo. Lo usa el service para saber a
 * qué renglones hay que exigirles tipo de pieza: solo a los que van a dar de
 * alta una refacción.
 */
export async function seriesEnCatalogo(series: string[]): Promise<Set<string>> {
  const pool = await getPool()
  return new Set((await piezasPorSerie(pool, series)).keys())
}

/** Los folios que este proveedor ya tiene registrados, de entre los del archivo. */
async function foliosYaRegistrados(
  tx: sql.Transaction, proveedorId: number, folios: string[],
): Promise<Set<string>> {
  const existentes = new Set<string>()
  for (let i = 0; i < folios.length; i += 500) {
    const tanda = folios.slice(i, i + 500)
    const req = tx.request().input('pv', sql.Int, proveedorId)
    const params = tanda.map((folio, j) => {
      req.input(`f${j}`, sql.NVarChar(30), folio)
      return `@f${j}`
    })
    const res = await req.query(
      `SELECT folio FROM facturas
       WHERE proveedor_id = @pv AND folio IN (${params.join(', ')})`,
    )
    for (const fila of res.recordset) existentes.add(fila.folio as string)
  }
  return existentes
}

/**
 * Carga el archivo completo en una sola transacción: o entra todo o no entra
 * nada. Igual que en una compra, media importación es un historial incompleto
 * que nadie sabe que lo está.
 *
 * LOS FOLIOS REPETIDOS SE OMITEN, no se fusionan. Es la única diferencia de
 * fondo con `facturasRepo.findOrCreate`, que sí mete los renglones nuevos en la
 * factura que ya existe porque ahí son el mismo papel capturado en dos tandas.
 * Aquí no: volver a soltar el mismo archivo —porque se cayó la conexión, porque
 * no quedó claro si entró— es lo normal, y fusionar convertiría cada reintento
 * en una factura con los renglones duplicados. Omitir hace que reimportar sea
 * seguro y que el segundo intento continúe donde se quedó el primero.
 */
export async function importar(
  data: ImportacionHistorica, autorizadoPor: string,
): Promise<ImportacionResultado> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const series = [...new Set(
      data.facturas.flatMap((f) => f.renglones.map((r) => r.numero_serie)),
    )]
    const piezaDeSerie = await piezasPorSerie(tx, series)
    const yaRegistrados = await foliosYaRegistrados(
      tx, data.proveedor_id, data.facturas.map((f) => f.num_factura),
    )

    const piezasNuevas: PiezaDadaDeAlta[] = []
    const foliosOmitidos: string[] = []
    let facturasCreadas = 0
    let renglonesCreados = 0

    for (const factura of data.facturas) {
      if (yaRegistrados.has(factura.num_factura)) {
        foliosOmitidos.push(factura.num_factura)
        continue
      }

      // El descuento va en NULL: el precio del archivo es el que ya se pagó,
      // así que restarle un porcentaje encima lo contaría dos veces.
      const insFactura = await tx.request()
        .input('pv',       sql.Int,           data.proveedor_id)
        .input('folio',    sql.NVarChar(30),  factura.num_factura)
        .input('fecha',    sql.Date,          factura.fecha_compra)
        .input('tasa',     sql.Decimal(5, 2), data.tasa_iva ?? null)
        .input('comprado', sql.NVarChar(120), data.comprado_por)
        .input('autoriza', sql.NVarChar(120), autorizadoPor)
        .query(`
          INSERT INTO facturas
            (proveedor_id, folio, fecha_compra, tasa_iva, descuento_pct,
             comprado_por, autorizado_por, historica)
          OUTPUT INSERTED.id
          VALUES (@pv, @folio, @fecha, @tasa, NULL, @comprado, @autoriza, 1)`)
      const facturaId = insFactura.recordset[0].id as number
      facturasCreadas++

      for (const renglon of factura.renglones) {
        let piezaId = piezaDeSerie.get(renglon.numero_serie)
        if (piezaId === undefined) {
          // El service ya lo comprobó contra el catálogo; esto es la red por si
          // la refacción se borró entre la comprobación y aquí. Reventar
          // deshace la importación entera en vez de dar de alta una refacción
          // sin tipo, que es la única clasificación que tiene.
          if (renglon.tipo_pieza_id === undefined) {
            throw new ValidationError(
              `La refacción ${renglon.numero_serie} no está en el catálogo y su renglón no trae tipo de pieza`,
            )
          }
          const nueva = await tx.request()
            .input('ns',   sql.NVarChar(80),  renglon.numero_serie)
            .input('desc', sql.NVarChar(300), renglon.descripcion)
            .input('tipo', sql.Int,           renglon.tipo_pieza_id)
            .query(`
              INSERT INTO piezas (numero_serie, descripcion, tipo_pieza_id)
              OUTPUT INSERTED.id
              VALUES (@ns, @desc, @tipo)`)
          piezaId = nueva.recordset[0].id as number
          // Al mapa también: la misma serie aparece en varias facturas del
          // archivo y solo se da de alta la primera vez.
          piezaDeSerie.set(renglon.numero_serie, piezaId)
          piezasNuevas.push({
            id: piezaId,
            numero_serie: renglon.numero_serie,
            descripcion:  renglon.descripcion,
          })
        }

        // `cantidad_disponible` en cero, que es lo que queda. La columna está
        // obsoleta y nadie la lee (migración 002), pero se escribe para que
        // quien mire la tabla a mano no vea un stock que no existe.
        const insLote = await tx.request()
          .input('pieza_id',    sql.Int,            piezaId)
          .input('factura_id',  sql.Int,            facturaId)
          .input('sucursal_id', sql.Int,            data.sucursal_id)
          .input('costo',       sql.Decimal(18, 2), renglon.costo_unitario)
          .input('cantidad',    sql.Int,            renglon.cantidad_inicial)
          .query(`
            INSERT INTO lotes_pieza
              (pieza_id, factura_id, sucursal_id, costo_unitario,
               cantidad_inicial, cantidad_disponible)
            OUTPUT INSERTED.id
            VALUES (@pieza_id, @factura_id, @sucursal_id, @costo, @cantidad, 0)`)
        const loteId = insLote.recordset[0].id as number

        // La fila de existencia se escribe aunque sea cero. Podría no existir
        // —`disponibleDelLote` hace COALESCE y daría cero igual—, pero entonces
        // el lote no aparecería en ningún conteo por sucursal, y "no queda
        // nada" y "no se sabe" se verían iguales.
        await tx.request()
          .input('lote_id',     sql.Int, loteId)
          .input('sucursal_id', sql.Int, data.sucursal_id)
          .query(`
            INSERT INTO existencias_lote (lote_id, sucursal_id, cantidad)
            VALUES (@lote_id, @sucursal_id, 0)`)

        renglonesCreados++
      }
    }

    await tx.commit()
    return {
      facturas_creadas:  facturasCreadas,
      folios_omitidos:   foliosOmitidos,
      renglones_creados: renglonesCreados,
      piezas_nuevas:     piezasNuevas,
    }
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
