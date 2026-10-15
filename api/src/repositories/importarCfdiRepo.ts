import * as sql from 'mssql'
import { getPool } from '../shared/db'
import * as unidadesRepo from './unidadesPiezaRepo'

// Guardar una factura de refacciones importada de su XML, y lo que se aprende
// de ella. Ver la migración 070.

export type TipoConcepto = 'refaccion' | 'mano_obra' | 'cargo'

/** Lo aprendido de un número de parte del proveedor. */
export interface ConceptoAprendido {
  no_identificacion: string
  tipo: TipoConcepto
  pieza_id: number | null
  numero_serie: string | null
  descripcion: string | null
  contenido: number
}

export async function conceptosDe(proveedorId: number): Promise<ConceptoAprendido[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('pv', sql.Int, proveedorId)
    .query(`
      SELECT pc.no_identificacion, pc.tipo, pc.pieza_id, p.numero_serie, p.descripcion, pc.contenido
      FROM proveedor_conceptos pc
      LEFT JOIN piezas p ON p.id = pc.pieza_id
      WHERE pc.proveedor_id = @pv`)
  return r.recordset.map((x) => ({ ...x, contenido: Number(x.contenido) })) as ConceptoAprendido[]
}

export async function proveedorPorRfc(rfc: string): Promise<{ id: number; nombre: string } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('rfc', sql.NVarChar(13), rfc)
    .query('SELECT id, nombre FROM proveedores WHERE rfc = @rfc')
  return r.recordset[0] ?? null
}

export async function facturaPorUuid(uuid: string): Promise<{ id: number; folio: string } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('uuid', sql.Char(36), uuid)
    .query('SELECT id, folio FROM facturas WHERE uuid = @uuid')
  return r.recordset[0] ?? null
}

export interface PiezaNuevaCfdi {
  numero_serie: string
  descripcion: string
  marca: string
  tipo_pieza_id: number
}

export interface RefaccionResuelta {
  pieza_id?: number
  pieza_nueva?: PiezaNuevaCfdi
  /** Piezas, ya divididas por el contenido: entero. */
  cantidad: number
  costo_unitario: number
}

export interface ImportacionResuelta {
  uuid: string
  folio: string
  fecha: string
  tasa_iva: number | null
  descuento_pct: number | null
  comprado_por: string
  autorizado_por: string
  sucursal_id: number
  fecha_llegada: string | null
  /** El proveedor que ya existía (`ligar_rfc` si hay que ponerle el RFC), o uno nuevo. */
  proveedor: { id: number; ligar_rfc: string | null } | { nuevo: { nombre: string; rfc: string } }
  refacciones: RefaccionResuelta[]
  /** Toda la mano de obra del papel en un renglón: un importe por servicio (046). */
  mano_obra: number | null
  cargos: { descripcion: string; importe: number }[]
  /** `refaccion`: índice en `refacciones`, de donde sale la pieza. */
  aprender: { no_identificacion: string; tipo: TipoConcepto; refaccion: number | null; contenido: number }[]
}

export interface Importada {
  factura_id: number
  proveedor_id: number
  proveedor_nuevo: boolean
  lotes: { id: number; pieza_id: number; pieza_nueva: boolean }[]
}

export type ResultadoImportacion =
  | { estado: 'duplicada' }
  | { estado: 'folio_existente' }
  | { estado: 'importada'; datos: Importada }

/**
 * Todo o nada, como el alta de compra: la factura, sus lotes y existencias, el
 * papel ya transcrito para el cuadre (`facturas_renglones`, ligado a cada lote),
 * la mano de obra, los cargos y lo aprendido. Lo único que no hace es sellar:
 * eso es del admin, en el cuadre.
 */
export async function importar(d: ImportacionResuelta): Promise<ResultadoImportacion> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  const salir = async (r: ResultadoImportacion) => { await tx.rollback(); return r }
  try {
    const dup = await tx.request()
      .input('uuid', sql.Char(36), d.uuid)
      .query('SELECT 1 FROM facturas WITH (UPDLOCK, HOLDLOCK) WHERE uuid = @uuid')
    if (dup.recordset.length > 0) return salir({ estado: 'duplicada' })

    let proveedorId: number
    let proveedorNuevo = false
    if ('nuevo' in d.proveedor) {
      const p = await tx.request()
        .input('nombre', sql.NVarChar(100), d.proveedor.nuevo.nombre)
        .input('rfc',    sql.NVarChar(13),  d.proveedor.nuevo.rfc)
        .query('INSERT INTO proveedores (nombre, rfc) OUTPUT INSERTED.id VALUES (@nombre, @rfc)')
      proveedorId = p.recordset[0].id as number
      proveedorNuevo = true
    } else {
      proveedorId = d.proveedor.id
      if (d.proveedor.ligar_rfc) {
        await tx.request()
          .input('id',  sql.Int,          proveedorId)
          .input('rfc', sql.NVarChar(13), d.proveedor.ligar_rfc)
          .query('UPDATE proveedores SET rfc = @rfc WHERE id = @id AND rfc IS NULL')
      }
    }

    const folio = await tx.request()
      .input('pv',    sql.Int,          proveedorId)
      .input('folio', sql.NVarChar(30), d.folio)
      .query('SELECT 1 FROM facturas WITH (UPDLOCK, HOLDLOCK) WHERE proveedor_id = @pv AND folio = @folio')
    if (folio.recordset.length > 0) return salir({ estado: 'folio_existente' })

    const f = await tx.request()
      .input('pv',        sql.Int,           proveedorId)
      .input('folio',     sql.NVarChar(30),  d.folio)
      .input('fecha',     sql.Date,          d.fecha)
      .input('tasa',      sql.Decimal(5, 2), d.tasa_iva)
      .input('descuento', sql.Decimal(5, 2), d.descuento_pct)
      .input('comprado',  sql.NVarChar(120), d.comprado_por)
      .input('autoriza',  sql.NVarChar(120), d.autorizado_por)
      .input('uuid',      sql.Char(36),      d.uuid)
      .query(`
        INSERT INTO facturas
          (proveedor_id, folio, fecha_compra, tasa_iva, descuento_pct, comprado_por, autorizado_por, uuid)
        OUTPUT INSERTED.id
        VALUES (@pv, @folio, @fecha, @tasa, @descuento, @comprado, @autoriza, @uuid)`)
    const facturaId = f.recordset[0].id as number

    const lotes: Importada['lotes'] = []
    for (const r of d.refacciones) {
      let piezaId = r.pieza_id
      if (r.pieza_nueva) {
        const p = await tx.request()
          .input('ns',    sql.NVarChar(80),  r.pieza_nueva.numero_serie)
          .input('desc',  sql.NVarChar(300), r.pieza_nueva.descripcion)
          .input('marca', sql.NVarChar(80),  r.pieza_nueva.marca)
          .input('tipo',  sql.Int,           r.pieza_nueva.tipo_pieza_id)
          .query(`
            INSERT INTO piezas (numero_serie, descripcion, marca, tipo_pieza_id)
            OUTPUT INSERTED.id
            VALUES (@ns, @desc, @marca, @tipo)`)
        piezaId = p.recordset[0].id as number
      }

      // Igual que `comprasRepo.crearCompra`: lote, su existencia en la sucursal
      // que recibe y, si la pieza se rastrea, sus unidades.
      const l = await tx.request()
        .input('pieza_id',       sql.Int,            piezaId!)
        .input('factura_id',     sql.Int,            facturaId)
        .input('sucursal_id',    sql.Int,            d.sucursal_id)
        .input('costo_unitario', sql.Decimal(18, 2), r.costo_unitario)
        .input('cantidad',       sql.Int,            r.cantidad)
        .input('capturado_por',  sql.NVarChar(120),  d.autorizado_por)
        .input('fecha_llegada',  sql.Date,           d.fecha_llegada)
        .query(`
          INSERT INTO lotes_pieza
            (pieza_id, factura_id, sucursal_id, costo_unitario,
             cantidad_inicial, cantidad_disponible, capturado_por, fecha_llegada)
          OUTPUT INSERTED.id
          VALUES (@pieza_id, @factura_id, @sucursal_id, @costo_unitario,
                  @cantidad, @cantidad, @capturado_por, @fecha_llegada)`)
      const loteId = l.recordset[0].id as number

      await tx.request()
        .input('lote_id',     sql.Int, loteId)
        .input('sucursal_id', sql.Int, d.sucursal_id)
        .input('cantidad',    sql.Int, r.cantidad)
        .query(`
          INSERT INTO existencias_lote (lote_id, sucursal_id, cantidad)
          VALUES (@lote_id, @sucursal_id, @cantidad)`)

      if (await unidadesRepo.piezaEsRastreada(tx, piezaId!)) {
        await unidadesRepo.crearDeCompra(tx, piezaId!, loteId, d.sucursal_id, r.cantidad, [])
      }

      // El papel ya transcrito: lo dice el XML, no alguien que lo tecleó. Queda
      // ligado a su lote y el cuadre sale sin diferencias; lo que falta es que
      // el admin lo mire y lo selle.
      await tx.request()
        .input('fid',   sql.Int,            facturaId)
        .input('pieza', sql.Int,            piezaId!)
        .input('cant',  sql.Int,            r.cantidad)
        .input('costo', sql.Decimal(18, 2), r.costo_unitario)
        .input('lote',  sql.Int,            loteId)
        .query(`
          INSERT INTO facturas_renglones (factura_id, pieza_id, cantidad, costo_unitario, lote_id)
          VALUES (@fid, @pieza, @cant, @costo, @lote)`)

      lotes.push({ id: loteId, pieza_id: piezaId!, pieza_nueva: r.pieza_nueva !== undefined })
    }

    if (d.mano_obra !== null) {
      await tx.request()
        .input('fid',     sql.Int,            facturaId)
        .input('importe', sql.Decimal(18, 2), d.mano_obra)
        .query(`
          INSERT INTO facturas_mano_obra (factura_id, mantenimiento_id, importe)
          VALUES (@fid, NULL, @importe)`)
    }

    for (const c of d.cargos) {
      await tx.request()
        .input('fid',     sql.Int,            facturaId)
        .input('desc',    sql.NVarChar(255),  c.descripcion)
        .input('importe', sql.Decimal(18, 2), c.importe)
        .query(`
          INSERT INTO facturas_cargos (factura_id, descripcion, importe)
          VALUES (@fid, @desc, @importe)`)
    }

    // Lo aprendido se pisa: si alguien lo cambió en esta importación, la nueva
    // decisión es la que vale para la próxima.
    for (const a of d.aprender) {
      const pieza = a.refaccion !== null ? lotes[a.refaccion].pieza_id : null
      await tx.request()
        .input('pv',    sql.Int,            proveedorId)
        .input('noid',  sql.NVarChar(100),  a.no_identificacion)
        .input('tipo',  sql.NVarChar(12),   a.tipo)
        .input('pieza', sql.Int,            pieza)
        .input('cont',  sql.Decimal(12, 3), a.contenido)
        .query(`
          MERGE proveedor_conceptos WITH (HOLDLOCK) AS t
          USING (SELECT @pv AS proveedor_id, @noid AS no_identificacion) AS s
             ON t.proveedor_id = s.proveedor_id AND t.no_identificacion = s.no_identificacion
          WHEN MATCHED THEN
            UPDATE SET tipo = @tipo, pieza_id = @pieza, contenido = @cont,
                       actualizado_en = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (proveedor_id, no_identificacion, tipo, pieza_id, contenido)
            VALUES (@pv, @noid, @tipo, @pieza, @cont);`)
    }

    await tx.commit()
    return {
      estado: 'importada',
      datos: { factura_id: facturaId, proveedor_id: proveedorId, proveedor_nuevo: proveedorNuevo, lotes },
    }
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
