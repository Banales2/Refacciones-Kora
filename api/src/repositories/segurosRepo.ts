import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { TABLAS_CON_SEGURO, vehiculosConDocumento } from './documentosVehiculo'

export interface Seguro {
  id:               number
  poliza:           string
  compania:         string
  fecha_expiracion: string
}

const COLS = 'id, poliza, compania, CONVERT(char(10), fecha_expiracion, 23) AS fecha_expiracion'

export async function findAll(): Promise<Seguro[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM seguros ORDER BY fecha_expiracion`)
  return r.recordset
}

export async function findById(id: number): Promise<Seguro | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM seguros WHERE id = @id`)
  return r.recordset[0] ?? null
}

export async function create(
  poliza: string, compania: string, fechaExpiracion: string
): Promise<Seguro> {
  const pool = await getPool()
  const r = await pool.request()
    .input('poliza',   sql.NVarChar(60),  poliza)
    .input('compania', sql.NVarChar(120), compania)
    .input('fecha',    sql.Date,          fechaExpiracion)
    .query(`
      INSERT INTO seguros (poliza, compania, fecha_expiracion)
      OUTPUT INSERTED.id, INSERTED.poliza, INSERTED.compania,
             CONVERT(char(10), INSERTED.fecha_expiracion, 23) AS fecha_expiracion
      VALUES (@poliza, @compania, @fecha)`)
  return r.recordset[0]
}

export async function update(
  id: number, poliza?: string, compania?: string, fechaExpiracion?: string
): Promise<Seguro | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (poliza          !== undefined) { req.input('poliza',   sql.NVarChar(60),  poliza);          sets.push('poliza=@poliza')             }
  if (compania        !== undefined) { req.input('compania', sql.NVarChar(120), compania);        sets.push('compania=@compania')         }
  if (fechaExpiracion !== undefined) { req.input('fecha',    sql.Date,          fechaExpiracion); sets.push('fecha_expiracion=@fecha')    }
  if (!sets.length) return findById(id)
  const r = await req.query(`
    UPDATE seguros SET ${sets.join(',')}
    OUTPUT INSERTED.id, INSERTED.poliza, INSERTED.compania,
           CONVERT(char(10), INSERTED.fecha_expiracion, 23) AS fecha_expiracion
    WHERE id=@id`)
  return r.recordset[0] ?? null
}

export async function countVehiculos(id: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT COUNT(*) AS cnt FROM (${vehiculosConDocumento('seguro_id', '@id')}) x`)
  return r.recordset[0].cnt
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM seguros OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}

// Asigna este seguro a los vehículos indicados (los mueve desde cualquier
// seguro previo). La FK garantiza que solo se aceptan seguros existentes.
//
// La póliza vive en la tabla hija de cada tipo, así que se recorren las cuatro
// que la tienen; el id que caiga en una caja de trailer no coincide con ninguna
// y simplemente no se asigna, que es justo lo que debe pasar.
export async function assignVehiculos(seguroId: number, vehiculoIds: number[]): Promise<void> {
  if (vehiculoIds.length === 0) return
  const pool = await getPool()
  const req = pool.request().input('sid', sql.Int, seguroId)
  const params = vehiculoIds.map((vid, i) => {
    req.input(`v${i}`, sql.Int, vid)
    return `@v${i}`
  })
  await req.query(
    TABLAS_CON_SEGURO
      .map((tabla) => `UPDATE ${tabla} SET seguro_id=@sid WHERE vehiculo_id IN (${params.join(',')});`)
      .join('\n')
  )
}

// Quita un vehículo de este seguro (solo si realmente lo tenía asignado). El
// vehículo está en una sola tabla hija, así que basta con que alguno de los
// UPDATE haya tocado un renglón.
export async function unassignVehiculo(seguroId: number, vehiculoId: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('sid', sql.Int, seguroId)
    .input('vid', sql.Int, vehiculoId)
    .query(
      TABLAS_CON_SEGURO
        .map((tabla) => `UPDATE ${tabla} SET seguro_id=NULL WHERE vehiculo_id=@vid AND seguro_id=@sid;`)
        .join('\n')
    )
  return r.rowsAffected.some((n) => n > 0)
}
