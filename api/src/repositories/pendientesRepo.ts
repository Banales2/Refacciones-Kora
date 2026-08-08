// Tabla padre de todo lo que hay que atenderle a un vehículo. Tiene dos hijos
// que comparten su id: `requerimientos_exclusivos` (preventivo, vence por
// km/tiempo y se repite) e `incidencias` (algo reportado, se cierra una vez).
//
// Los mantenimientos y las agendas se enlazan contra este padre, así que "qué
// atendió este mantenimiento" es un solo JOIN sin importar de qué tipo sea.
//
// Aquí viven únicamente los campos compartidos y las operaciones sobre el padre;
// cada hijo maneja los suyos en su propio repo y llama a estos helpers dentro de
// su transacción. Un pendiente sin hijo no significa nada, por eso `insert` y
// `applyUpdate` exigen una transacción en curso en vez de abrir la suya.
import * as sql from 'mssql'
import { getPool } from '../shared/db'

export type Origen          = 'preventivo' | 'incidencia'
export type StatusPendiente = 'activo' | 'completado' | 'pausado' | 'cancelado'

export interface PendienteBase {
  id:          number
  vehiculo_id: number
  origen:      Origen
  nombre:      string
  descripcion: string | null
  categoria:   string | null
  status:      StatusPendiente
  created_at:  string
  updated_at:  string
}

export interface PendienteCreate {
  vehiculo_id:  number
  origen:       Origen
  nombre:       string
  descripcion?: string | null
  categoria?:   string | null
  status?:      StatusPendiente
}

export interface PendienteUpdate {
  nombre?:      string
  descripcion?: string | null
  categoria?:   string | null
  status?:      StatusPendiente
}

// Con alias `p`, para componer con el SELECT de cada hijo.
export const PENDIENTE_COLS = `p.id, p.vehiculo_id, p.origen, p.nombre, p.descripcion,
  p.categoria, p.status, p.created_at, p.updated_at`

export async function insert(tx: sql.Transaction, data: PendienteCreate): Promise<number> {
  const r = await tx.request()
    .input('vid',         sql.Int,               data.vehiculo_id)
    .input('origen',      sql.NVarChar(20),      data.origen)
    .input('nombre',      sql.NVarChar(120),     data.nombre)
    .input('descripcion', sql.NVarChar(sql.MAX), data.descripcion ?? null)
    .input('categoria',   sql.NVarChar(80),      data.categoria   ?? null)
    .input('status',      sql.NVarChar(20),      data.status      ?? 'activo')
    .query(`
      INSERT INTO pendientes (vehiculo_id, origen, nombre, descripcion, categoria, status)
      OUTPUT INSERTED.id
      VALUES (@vid, @origen, @nombre, @descripcion, @categoria, @status)
    `)
  return r.recordset[0].id
}

// Solo toca los campos presentes en `data`. `updated_at` se refresca siempre
// que se llame, aunque no venga ningún campo del padre: el hijo cambió.
export async function applyUpdate(
  tx: sql.Transaction, id: number, data: PendienteUpdate
): Promise<void> {
  const sets: string[] = ['updated_at=SYSDATETIME()']
  const req = tx.request().input('id', sql.Int, id)

  if (data.nombre  !== undefined) { req.input('nombre',      sql.NVarChar(120),     data.nombre);              sets.push('nombre=@nombre')           }
  if ('descripcion' in data)      { req.input('descripcion', sql.NVarChar(sql.MAX), data.descripcion ?? null); sets.push('descripcion=@descripcion') }
  if ('categoria'   in data)      { req.input('categoria',   sql.NVarChar(80),      data.categoria   ?? null); sets.push('categoria=@categoria')     }
  if (data.status  !== undefined) { req.input('status',      sql.NVarChar(20),      data.status);              sets.push('status=@status')           }

  await req.query(`UPDATE pendientes SET ${sets.join(',')} WHERE id=@id`)
}

// Los vínculos con mantenimientos y agendas son NO ACTION: hay que soltarlos a
// mano o el FK aborta el DELETE. El hijo, en cambio, se va solo por CASCADE.
export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM mantenimiento_pendientes WHERE pendiente_id=@id')
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM agenda_pendientes WHERE pendiente_id=@id')
    const r = await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM pendientes OUTPUT DELETED.id WHERE id=@id')
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// Una incidencia se cierra sola en cuanto un mantenimiento que la atiende ya
// ocurrió, y se reabre si ese vínculo desaparece. Un mantenimiento programado a
// futuro todavía no cuenta: solo cierra cuando su fecha llega.
//
// Solo mueve entre 'activo' y 'completado'. 'cancelado' y 'pausado' los puso una
// persona a propósito y no se tocan: cancelar es justamente decir "ya no me
// alertes", y reabrirla por un vínculo sería ignorar esa decisión.
//
// Los preventivos quedan fuera: no se "completan", se les reinicia el ciclo, y
// eso ya lo resuelve el snapshot de fecha/km del vínculo.
export async function syncIncidenciaStatuses(
  exec: sql.ConnectionPool | sql.Transaction, ids?: number[]
): Promise<void> {
  if (ids && ids.length === 0) return

  const filtro = (req: sql.Request) => ids
    ? `AND p.id IN (${ids.map((id, i) => { req.input(`p${i}`, sql.Int, id); return `@p${i}` }).join(',')})`
    : ''

  const atendida = `
    EXISTS (
      SELECT 1 FROM mantenimiento_pendientes mp
      WHERE mp.pendiente_id = p.id AND mp.fecha <= CAST(GETDATE() AS DATE)
    )`

  const cerrar = exec.request()
  await cerrar.query(`
    UPDATE p SET p.status = 'completado', p.updated_at = SYSDATETIME()
    FROM pendientes p
    WHERE p.origen = 'incidencia' AND p.status = 'activo' ${filtro(cerrar)}
      AND ${atendida}
  `)

  const reabrir = exec.request()
  await reabrir.query(`
    UPDATE p SET p.status = 'activo', p.updated_at = SYSDATETIME()
    FROM pendientes p
    WHERE p.origen = 'incidencia' AND p.status = 'completado' ${filtro(reabrir)}
      AND NOT ${atendida}
  `)
}

// Todo lo que un vehículo tiene abierto, de los dos tipos: alimenta el selector
// de "qué atiende este mantenimiento" y el de las agendas.
export async function findActivosByVehiculo(vehiculoId: number): Promise<PendienteBase[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`
      SELECT ${PENDIENTE_COLS}
      FROM pendientes p
      WHERE p.vehiculo_id = @vid AND p.status = 'activo'
      ORDER BY p.origen, p.nombre
    `)
  return r.recordset
}

// Categorías ya usadas en la flota (padre) o en las plantillas de modelo, para
// que una categoría escrita una vez quede disponible en todos los formularios.
export async function findCategorias(): Promise<string[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT categoria FROM (
      SELECT DISTINCT categoria FROM pendientes
      WHERE categoria IS NOT NULL AND LTRIM(RTRIM(categoria)) <> ''
      UNION
      SELECT DISTINCT categoria FROM plantilla_requerimientos_modelo
      WHERE categoria IS NOT NULL AND LTRIM(RTRIM(categoria)) <> ''
    ) AS c
    ORDER BY categoria
  `)
  return r.recordset.map((row: { categoria: string }) => row.categoria)
}
