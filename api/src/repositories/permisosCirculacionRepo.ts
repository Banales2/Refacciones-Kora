import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { TABLAS_CON_PERMISO, vehiculosConDocumento } from './vehiculosSql'

export interface PermisoCirculacion {
  id:               number
  zona_circulacion: string
  fecha_emision:    string | null
  fecha_expiracion: string
  /**
   * Cuándo se dio por terminado. Null = sigue contando (avisa al vencer). Con
   * fecha = archivado: ya lo reemplazó otro, o es tan viejo que reclamarlo no
   * lleva a ninguna parte. No borra nada ni autoriza a nadie a circular: solo
   * calla el aviso del documento. Mismo nombre y misma idea que `seguros`
   * (migración 029); la columna la agrega la 033.
   */
  terminado_en:     string | null
}

const COLS = `id, zona_circulacion,
  CONVERT(char(10), fecha_emision, 23)    AS fecha_emision,
  CONVERT(char(10), fecha_expiracion, 23) AS fecha_expiracion,
  CONVERT(char(10), terminado_en, 23)     AS terminado_en`

export async function findAll(): Promise<PermisoCirculacion[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM permisos_circulacion ORDER BY fecha_expiracion`)
  return r.recordset
}

export async function findById(id: number): Promise<PermisoCirculacion | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM permisos_circulacion WHERE id = @id`)
  return r.recordset[0] ?? null
}

const OUTPUT_COLS = `INSERTED.id, INSERTED.zona_circulacion,
  CONVERT(char(10), INSERTED.fecha_emision, 23)    AS fecha_emision,
  CONVERT(char(10), INSERTED.fecha_expiracion, 23) AS fecha_expiracion,
  CONVERT(char(10), INSERTED.terminado_en, 23)     AS terminado_en`

// Archivar el permiso o revivirlo. Espejo de `segurosRepo.setTerminado`.
export async function setTerminado(
  id: number, terminado: boolean,
): Promise<PermisoCirculacion | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      UPDATE permisos_circulacion
      SET terminado_en = ${terminado ? 'CAST(GETDATE() AS date)' : 'NULL'}
      OUTPUT ${OUTPUT_COLS}
      WHERE id=@id`)
  return r.recordset[0] ?? null
}

export async function create(
  zonaCirculacion: string, fechaEmision: string, fechaExpiracion: string
): Promise<PermisoCirculacion> {
  const pool = await getPool()
  const r = await pool.request()
    .input('zona',      sql.NVarChar(120), zonaCirculacion)
    .input('emision',   sql.Date,          fechaEmision)
    .input('expira',    sql.Date,          fechaExpiracion)
    .query(`
      INSERT INTO permisos_circulacion (zona_circulacion, fecha_emision, fecha_expiracion)
      OUTPUT ${OUTPUT_COLS}
      VALUES (@zona, @emision, @expira)`)
  return r.recordset[0]
}

export async function update(
  id: number, zonaCirculacion?: string, fechaEmision?: string, fechaExpiracion?: string
): Promise<PermisoCirculacion | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (zonaCirculacion !== undefined) { req.input('zona',    sql.NVarChar(120), zonaCirculacion); sets.push('zona_circulacion=@zona') }
  if (fechaEmision    !== undefined) { req.input('emision', sql.Date,          fechaEmision);    sets.push('fecha_emision=@emision') }
  if (fechaExpiracion !== undefined) { req.input('expira',  sql.Date,          fechaExpiracion); sets.push('fecha_expiracion=@expira') }
  if (!sets.length) return findById(id)
  const r = await req.query(`
    UPDATE permisos_circulacion SET ${sets.join(',')}
    OUTPUT ${OUTPUT_COLS}
    WHERE id=@id`)
  return r.recordset[0] ?? null
}

// ¿Ya existe un permiso de la misma zona emitido en la misma fecha? exceptId
// excluye el propio registro al editar.
export async function existsMismaZonaYFecha(
  zonaCirculacion: string, fechaEmision: string, exceptId?: number
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('zona',    sql.NVarChar(120), zonaCirculacion)
    .input('emision', sql.Date,          fechaEmision)
    .input('except',  sql.Int,           exceptId ?? null)
    .query(`
      SELECT TOP 1 id FROM permisos_circulacion
      WHERE zona_circulacion = @zona AND fecha_emision = @emision
        AND (@except IS NULL OR id <> @except)`)
  return r.recordset.length > 0
}

// Asigna este permiso a los vehículos indicados (los mueve desde cualquier
// permiso previo). La FK garantiza que solo se aceptan permisos existentes.
//
// El permiso solo lo llevan reparto y utilitarios, así que se recorren esas dos
// tablas: un tracto, una caja o un montacargas en la lista no coincide con
// ninguna y se queda sin permiso, que es lo correcto.
export async function assignVehiculos(permisoId: number, vehiculoIds: number[]): Promise<void> {
  if (vehiculoIds.length === 0) return
  const pool = await getPool()
  const req = pool.request().input('pid', sql.Int, permisoId)
  const params = vehiculoIds.map((vid, i) => {
    req.input(`v${i}`, sql.Int, vid)
    return `@v${i}`
  })
  await req.query(
    TABLAS_CON_PERMISO
      .map((tabla) => `UPDATE ${tabla} SET permiso_id=@pid WHERE vehiculo_id IN (${params.join(',')});`)
      .join('\n')
  )
}

// Quita un vehículo de este permiso (solo si realmente lo tenía asignado). El
// vehículo está en una sola tabla hija, así que basta con que alguno de los
// UPDATE haya tocado un renglón.
export async function unassignVehiculo(permisoId: number, vehiculoId: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('pid', sql.Int, permisoId)
    .input('vid', sql.Int, vehiculoId)
    .query(
      TABLAS_CON_PERMISO
        .map((tabla) => `UPDATE ${tabla} SET permiso_id=NULL WHERE vehiculo_id=@vid AND permiso_id=@pid;`)
        .join('\n')
    )
  return r.rowsAffected.some((n) => n > 0)
}
