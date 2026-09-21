import * as sql from 'mssql'
import { getPool } from '../shared/db'

// La mano de obra que cobra el papel del taller.
//
// Es la tercera lista del cuadre. `lotes_pieza` dice qué refacciones están
// capturadas, `facturas_renglones` qué refacciones cobra el papel, y esta dice
// qué mano de obra cobra — contra lo que ya está capturado en
// `mantenimiento.costo`.
//
// SIGUE EL MODELO DE GASOLINA, NO EL DE REFACCIONES, y la diferencia se nota en
// todo este archivo: un mantenimiento existe independientemente de que el taller
// haya emitido su papel, igual que una recarga. De ahí que el renglón apunte al
// mantenimiento (y no al revés), que haya candidatos que proponer, y que el
// mantenimiento sin facturar se detecte solo — cosa que en refacciones no se
// puede, porque un lote no existe hasta que alguien captura la compra.
//
// EL TALLER ES UN PROVEEDOR Y ESO NO SE VE. La factura cuelga de `proveedor_id`
// como cualquier otra; el puente `tecnicos.proveedor_id` es el que deja que la
// pantalla siga hablando de talleres. Por eso todas las consultas de aquí llegan
// al taller pasando por el proveedor de la factura.
//
// Ver `db/migrations/046_facturas_de_mantenimiento.sql`.

/** Un renglón de mano de obra del papel, con el servicio que reclama. */
export interface RenglonManoObra {
  id: number
  /** El mantenimiento que cobra. `null` = no casó con ninguno. */
  mantenimiento_id: number | null
  /** Lo que el papel cobra por ese servicio. */
  importe: number
  // Lo del mantenimiento casado, para poder comparar sin una segunda consulta.
  /** Lo que está capturado como mano de obra. `null` = el renglón no casó. */
  mantenimiento_costo: number | null
  mantenimiento_fecha: string | null
  mantenimiento_tipo: string | null
  /** Quién tecleó ese mantenimiento. Es a quien se le carga el error. */
  capturado_por: string | null
  vehiculo: string | null
  taller: string | null
}

const SELECT_RENGLONES = `
  SELECT fmo.id, fmo.mantenimiento_id, fmo.importe,
         m.costo AS mantenimiento_costo,
         CONVERT(char(10), m.fecha, 23) AS mantenimiento_fecha,
         m.tipo AS mantenimiento_tipo,
         m.capturado_por,
         CASE WHEN m.id IS NULL THEN NULL
              ELSE CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) END AS vehiculo,
         t.nombre AS taller
  FROM facturas_mano_obra fmo
  LEFT JOIN mantenimiento m  ON m.id  = fmo.mantenimiento_id
  LEFT JOIN vehiculos     v  ON v.id  = m.vehiculo_id
  LEFT JOIN modelos       mo ON mo.id = v.modelo_id
  LEFT JOIN tecnicos      t  ON t.id  = m.tecnico_id`

export async function renglonesDelPapel(facturaId: number): Promise<RenglonManoObra[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`${SELECT_RENGLONES} WHERE fmo.factura_id = @id ORDER BY fmo.id`)
  return r.recordset as RenglonManoObra[]
}

export interface RenglonManoObraAGuardar {
  mantenimiento_id: number | null
  importe: number
}

/**
 * Reemplaza por completo los renglones de mano de obra de una factura.
 *
 * Se borra todo y se vuelve a insertar, igual que en `cuadreFacturaRepo`: lo que
 * manda la pantalla es la verdad completa del papel, y calcular altas, bajas y
 * cambios contra lo que había solo agrega una forma de equivocarse.
 *
 * El UNIQUE filtrado de `mantenimiento_id` puede tumbar el INSERT si otra
 * factura ya reclamó ese servicio. Se deja subir tal cual y lo traduce el
 * service: es la regla que impide cobrar dos veces el mismo trabajo, y tiene que
 * vivir en la base para que dos capturas simultáneas no se cuelen las dos.
 */
export async function reemplazarRenglones(
  facturaId: number, renglones: RenglonManoObraAGuardar[],
): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request()
      .input('id', sql.Int, facturaId)
      .query('DELETE FROM facturas_mano_obra WHERE factura_id = @id')

    for (const r of renglones) {
      await tx.request()
        .input('fid',     sql.Int,            facturaId)
        .input('mant',    sql.Int,            r.mantenimiento_id ?? null)
        .input('importe', sql.Decimal(18, 2), r.importe)
        .query(`
          INSERT INTO facturas_mano_obra (factura_id, mantenimiento_id, importe)
          VALUES (@fid, @mant, @importe)`)
    }

    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * Los mantenimientos que esta factura podría estar cobrando.
 *
 * > Los del **taller que la emitió**, con fecha **menor o igual** a la de la
 * > factura, que **ningún renglón de ninguna otra factura** haya reclamado.
 *
 * Las tres condiciones son la misma idea que en gasolina: el taller no cobra
 * trabajos de otro taller, no cobra por adelantado, y un servicio ya facturado
 * no se puede volver a ofrecer. La tercera excluye las de OTRAS facturas, no las
 * de esta: las suyas tienen que seguir apareciendo para poder cambiarlas.
 *
 * El taller sale del proveedor de la factura por `tecnicos.proveedor_id`. Si ese
 * proveedor no es el reflejo de ningún taller —una factura de refacciones
 * normal— no hay candidatos, que es la respuesta correcta.
 */
export interface MantenimientoCandidato {
  id: number
  fecha: string | null
  tipo: string | null
  costo: number
  km_actual: number | null
  vehiculo: string
  taller: string | null
  observaciones: string | null
}

export async function candidatos(
  facturaId: number, limite = 400,
): Promise<MantenimientoCandidato[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',     sql.Int, facturaId)
    .input('limite', sql.Int, limite)
    .query(`
      SELECT TOP (@limite)
             m.id, CONVERT(char(10), m.fecha, 23) AS fecha, m.tipo, m.costo,
             m.km_actual, m.observaciones,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             t.nombre AS taller
      FROM mantenimiento m
      JOIN facturas  f  ON f.id  = @id
      JOIN tecnicos  t  ON t.id  = m.tecnico_id AND t.proveedor_id = f.proveedor_id
      JOIN vehiculos v  ON v.id  = m.vehiculo_id
      JOIN modelos   mo ON mo.id = v.modelo_id
      -- Sin fecha también entra. "No cobra por adelantado" no se puede
      -- comprobar contra una fecha que no existe, y excluirlo dejaría a los
      -- mantenimientos viejos sin forma de facturarse nunca: saldrían en la
      -- bandeja de sin facturar y no habría manera de sacarlos de ahí.
      WHERE (m.fecha IS NULL OR m.fecha <= f.fecha_compra)
        AND NOT EXISTS (
          SELECT 1 FROM facturas_mano_obra otro
          WHERE otro.mantenimiento_id = m.id AND otro.factura_id <> @id
        )
      ORDER BY m.fecha DESC, m.id DESC`)
  return r.recordset as MantenimientoCandidato[]
}

/** Los mantenimientos que esta factura reclama. Para sellarlos con ella. */
export async function idsDeMantenimientos(facturaId: number): Promise<number[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT mantenimiento_id AS id FROM facturas_mano_obra
      WHERE factura_id = @id AND mantenimiento_id IS NOT NULL`)
  return r.recordset.map((x: { id: number }) => x.id)
}

/**
 * Aplica lo que dice el papel al mantenimiento.
 *
 * El papel gana: `mantenimiento.costo` es de donde sale el gasto en todos los
 * reportes, así que dejarlo como se capturó y guardar el importe real solo en el
 * renglón crearía dos verdades y obligaría a cada reporte a elegir una. Lo que
 * se corrigió queda en `correcciones_revision`, que es donde vive la historia.
 */
export async function setCosto(mantenimientoId: number, costo: number): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('id',    sql.Int,            mantenimientoId)
    .input('costo', sql.Decimal(18, 2), costo)
    .query('UPDATE mantenimiento SET costo = @costo WHERE id = @id')
}

// ── La bandeja inversa ───────────────────────────────────────────────────────

/**
 * Los mantenimientos que ninguna factura ha reclamado todavía.
 *
 * Es el reverso de lo que enseña el cuadre: allá se ve lo que el taller cobra y
 * no está capturado; aquí, lo que está capturado y el taller no ha cobrado.
 *
 * Casi nunca es un problema —el papel llega después del servicio— pero uno de
 * hace tres meses sin facturar sí lo es, y de ahí que cada renglón traiga los
 * días que lleva esperando. Es el gemelo de `recargas-sin-facturar`.
 *
 * Los de costo cero no salen: no hay nada que facturar, y llenar la bandeja de
 * servicios que nadie va a cobrar es la forma más rápida de que deje de mirarse.
 */
export interface MantenimientoSinFacturar {
  id: number
  fecha: string | null
  tipo: string | null
  costo: number
  vehiculo: string
  taller: string | null
  /** Cuántos días lleva esperando su factura. */
  dias: number | null
}

export interface SinFacturarQuery {
  page: number
  pageSize: number
  tecnico_id?: number
  search?: string
  desde?: string
  hasta?: string
}

export async function sinFacturar(
  p: SinFacturarQuery,
): Promise<{ data: MantenimientoSinFacturar[]; total: number; costo_total: number }> {
  const pool = await getPool()
  const req = pool.request()
    .input('offset',   sql.Int, (p.page - 1) * p.pageSize)
    .input('pageSize', sql.Int, p.pageSize)

  const where = [
    'm.costo > 0',
    'NOT EXISTS (SELECT 1 FROM facturas_mano_obra fmo WHERE fmo.mantenimiento_id = m.id)',
  ]
  if (p.tecnico_id) { req.input('tec', sql.Int, p.tecnico_id); where.push('m.tecnico_id = @tec') }
  if (p.desde) { req.input('desde', sql.Date, p.desde); where.push('m.fecha >= @desde') }
  if (p.hasta) { req.input('hasta', sql.Date, p.hasta); where.push('m.fecha <= @hasta') }
  if (p.search) {
    req.input('search', `%${p.search}%`)
    where.push('(v.numero_serie LIKE @search OR t.nombre LIKE @search OR m.tipo LIKE @search)')
  }
  const filtro = `WHERE ${where.join(' AND ')}`

  const from = `
    FROM mantenimiento m
    JOIN vehiculos v  ON v.id  = m.vehiculo_id
    JOIN modelos   mo ON mo.id = v.modelo_id
    LEFT JOIN tecnicos t ON t.id = m.tecnico_id
    ${filtro}`

  const r = await req.query(`
    SELECT m.id, CONVERT(char(10), m.fecha, 23) AS fecha, m.tipo, m.costo,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
           t.nombre AS taller,
           DATEDIFF(day, m.fecha, CAST(SYSDATETIME() AS DATE)) AS dias
    ${from}
    ORDER BY m.fecha DESC, m.id DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(*) AS total, COALESCE(SUM(m.costo), 0) AS costo_total ${from};
  `)

  const resumen = (r.recordsets[1] as unknown as { total: number; costo_total: number }[])[0]
  return {
    data: r.recordsets[0] as unknown as MantenimientoSinFacturar[],
    total: resumen.total,
    costo_total: resumen.costo_total,
  }
}
