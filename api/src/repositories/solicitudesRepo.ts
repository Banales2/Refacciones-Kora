// Solicitudes de refacción: el canal del patio hacia oficina. Quien está a
// cargo de una sucursal pide lo que le falta, y alguien de oficina lo aprueba
// o lo niega. Ver la migración 054.
//
// La cabecera y sus renglones se leen siempre juntos: no hay pantalla que
// quiera una solicitud sin saber qué pidió, así que este repo nunca devuelve la
// cabecera pelada.
import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { Alcance } from '../shared/alcance'

export type EstadoSolicitud = 'pendiente' | 'aprobada' | 'rechazada' | 'surtida'

export interface RenglonSolicitud {
  pieza_id:     number
  numero_serie: string
  descripcion:  string
  tipo_pieza:   string | null
  cantidad:     number
  /**
   * Lo que hay hoy de esa refacción en la sucursal que la pide. Va aquí porque
   * es la primera pregunta de quien autoriza: pedir cuatro balatas teniendo
   * seis en el estante suele ser que no se buscaron bien.
   */
  existencia:   number
}

export interface Solicitud {
  id:             number
  sucursal_id:    number
  sucursal:       string
  motivo:         string
  estado:         EstadoSolicitud
  solicitado_por: string
  fecha:          string
  resuelto_por:    string | null
  resuelto_en:     string | null
  resolucion_nota: string | null
  surtido_por:    string | null
  surtida_en:     string | null
  created_at:     string
  renglones:      RenglonSolicitud[]
}

const SELECT_SOLICITUD = `
  SELECT s.id, s.sucursal_id, suc.nombre AS sucursal, s.motivo, s.estado,
         s.solicitado_por, CONVERT(char(10), s.fecha, 23) AS fecha,
         s.resuelto_por, s.resuelto_en, s.resolucion_nota,
         s.surtido_por, s.surtida_en, s.created_at
  FROM solicitudes_refaccion s
  JOIN sucursales suc ON suc.id = s.sucursal_id`

// Los renglones de un conjunto de solicitudes, en una sola consulta: pedirlos
// solicitud por solicitud convertía la lista en N+1 viajes.
async function renglonesDe(ids: number[]): Promise<Map<number, RenglonSolicitud[]>> {
  const porSolicitud = new Map<number, RenglonSolicitud[]>()
  if (ids.length === 0) return porSolicitud

  const pool = await getPool()
  const req = pool.request()
  const params = ids.map((id, i) => { req.input(`s${i}`, sql.Int, id); return `@s${i}` }).join(',')
  const r = await req.query(`
    SELECT r.solicitud_id, r.pieza_id, p.numero_serie, p.descripcion,
           t.nombre AS tipo_pieza, r.cantidad,
           -- La existencia en la sucursal que pide, no en toda la flota: lo
           -- que hay en otro patio no le resuelve nada a quien está pidiendo.
           COALESCE((SELECT SUM(ex.cantidad)
                     FROM existencias_lote ex
                     JOIN lotes_pieza l ON l.id = ex.lote_id
                     WHERE l.pieza_id = r.pieza_id AND ex.sucursal_id = s.sucursal_id), 0) AS existencia
    FROM solicitud_refaccion_renglones r
    JOIN solicitudes_refaccion s ON s.id = r.solicitud_id
    JOIN piezas p                ON p.id = r.pieza_id
    LEFT JOIN tipos_pieza t      ON t.id = p.tipo_pieza_id
    WHERE r.solicitud_id IN (${params})
    ORDER BY r.solicitud_id, p.numero_serie`)

  for (const row of r.recordset) {
    const lista = porSolicitud.get(row.solicitud_id) ?? []
    lista.push({
      pieza_id: row.pieza_id, numero_serie: row.numero_serie,
      descripcion: row.descripcion, tipo_pieza: row.tipo_pieza,
      cantidad: row.cantidad, existencia: row.existencia,
    })
    porSolicitud.set(row.solicitud_id, lista)
  }
  return porSolicitud
}

async function conRenglones(filas: Omit<Solicitud, 'renglones'>[]): Promise<Solicitud[]> {
  const mapa = await renglonesDe(filas.map((f) => f.id))
  return filas.map((f) => ({ ...f, renglones: mapa.get(f.id) ?? [] }))
}

/**
 * Las solicitudes que alcanza a ver quien pregunta.
 *
 * El acotado se aplica aquí y no con un filtro en memoria porque estas filas se
 * acumulan: el responsable ve las de su sucursal y nada más, que es justo lo
 * que necesita para no volver a pedir lo que ya pidió su compañero.
 */
export async function findAll(
  alcance: Alcance, estado?: EstadoSolicitud,
): Promise<Solicitud[]> {
  const pool = await getPool()
  const req = pool.request()
    .input('suc',    sql.Int,         alcance.sucursalId)
    .input('estado', sql.VarChar(12), estado ?? null)
  const r = await req.query(`
    ${SELECT_SOLICITUD}
    WHERE (@suc IS NULL OR s.sucursal_id = @suc)
      AND (@estado IS NULL OR s.estado = @estado)
    -- Lo que espera respuesta primero, y dentro de eso lo más viejo: una
    -- solicitud de hace cinco días es más urgente que la de hoy, y un orden
    -- puramente cronológico la enterraría.
    ORDER BY CASE s.estado WHEN 'pendiente' THEN 0 WHEN 'aprobada' THEN 1 ELSE 2 END,
             s.fecha DESC, s.id DESC`)
  return conRenglones(r.recordset)
}

export async function findById(id: number): Promise<Solicitud | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_SOLICITUD} WHERE s.id = @id`)
  if (!r.recordset[0]) return null
  return (await conRenglones(r.recordset))[0]
}

/** Cuántas esperan respuesta. Es el contador del tablero. */
export async function contarPendientes(alcance: Alcance): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('suc', sql.Int, alcance.sucursalId)
    .query(`
      SELECT COUNT(*) AS n FROM solicitudes_refaccion
      WHERE estado = 'pendiente' AND (@suc IS NULL OR sucursal_id = @suc)`)
  return r.recordset[0].n
}

export interface SolicitudCreate {
  sucursal_id: number
  motivo:      string
  fecha:       string
  renglones:   { pieza_id: number; cantidad: number }[]
}

/**
 * La cabecera y sus renglones entran juntos o no entra ninguno: una solicitud
 * sin renglones no pide nada, y quedaría en la bandeja de oficina como un
 * pendiente imposible de resolver.
 */
export async function create(data: SolicitudCreate, solicitadoPor: string): Promise<Solicitud> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const r = await tx.request()
      .input('suc',    sql.Int,           data.sucursal_id)
      .input('motivo', sql.NVarChar(500), data.motivo)
      .input('quien',  sql.NVarChar(120), solicitadoPor)
      .input('fecha',  sql.Date,          data.fecha)
      .query(`
        INSERT INTO solicitudes_refaccion (sucursal_id, motivo, solicitado_por, fecha)
        OUTPUT INSERTED.id
        VALUES (@suc, @motivo, @quien, @fecha)`)
    const id = r.recordset[0].id as number

    for (const renglon of data.renglones) {
      await tx.request()
        .input('sid',  sql.Int, id)
        .input('pid',  sql.Int, renglon.pieza_id)
        .input('cant', sql.Int, renglon.cantidad)
        .query(`
          INSERT INTO solicitud_refaccion_renglones (solicitud_id, pieza_id, cantidad)
          VALUES (@sid, @pid, @cant)`)
    }

    await tx.commit()
    return (await findById(id))!
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * Contesta la solicitud. Devuelve null si alguien más la contestó primero: el
 * UPDATE exige que siga pendiente, así que la carrera la pierde el segundo en
 * vez de pisar la decisión del primero.
 */
export async function resolver(
  id: number, estado: 'aprobada' | 'rechazada', resueltoPor: string, nota: string | null,
): Promise<Solicitud | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',     sql.Int,           id)
    .input('estado', sql.VarChar(12),   estado)
    .input('quien',  sql.NVarChar(120), resueltoPor)
    .input('nota',   sql.NVarChar(500), nota)
    .query(`
      UPDATE solicitudes_refaccion
      SET estado = @estado, resuelto_por = @quien, resuelto_en = SYSDATETIME(),
          resolucion_nota = @nota, updated_at = SYSDATETIME()
      OUTPUT INSERTED.id
      WHERE id = @id AND estado = 'pendiente'`)
  if (r.recordset.length === 0) return null
  return findById(id)
}

/** La pieza llegó al patio. Solo desde 'aprobada': lo que nadie autorizó no se surte. */
export async function surtir(id: number, surtidoPor: string): Promise<Solicitud | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',    sql.Int,           id)
    .input('quien', sql.NVarChar(120), surtidoPor)
    .query(`
      UPDATE solicitudes_refaccion
      SET estado = 'surtida', surtido_por = @quien, surtida_en = SYSDATETIME(),
          updated_at = SYSDATETIME()
      OUTPUT INSERTED.id
      WHERE id = @id AND estado = 'aprobada'`)
  if (r.recordset.length === 0) return null
  return findById(id)
}

/** ¿Las refacciones que se piden existen? Devuelve las que no. */
export async function piezasInexistentes(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return []
  const pool = await getPool()
  const req = pool.request()
  const params = ids.map((id, i) => { req.input(`p${i}`, sql.Int, id); return `@p${i}` }).join(',')
  const r = await req.query(`SELECT id FROM piezas WHERE id IN (${params})`)
  const existen = new Set(r.recordset.map((f: { id: number }) => f.id))
  return ids.filter((id) => !existen.has(id))
}
