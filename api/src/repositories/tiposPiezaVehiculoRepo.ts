import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Tipos de pieza que pide un vehículo en concreto, además de los que ya pide su
// modelo. La lista que se muestra en el vehículo (piezasVehiculoRepo) es la
// unión de ambos; esto es solo la parte propia.

// Asocia tipos al vehículo, ignorando los que ya estaban (evita chocar con la
// restricción única).
export async function addTipos(vehiculoId: number, tipoIds: number[]): Promise<void> {
  if (tipoIds.length === 0) return
  const pool = await getPool()
  const req = pool.request().input('vehiculoId', sql.Int, vehiculoId)
  const values = tipoIds.map((tid, i) => {
    req.input(`t${i}`, sql.Int, tid)
    return `(@t${i})`
  })
  await req.query(`
    INSERT INTO tipos_pieza_vehiculo (vehiculo_id, tipo_pieza_id)
    SELECT @vehiculoId, v.tipo_pieza_id
    FROM (VALUES ${values.join(',')}) AS v(tipo_pieza_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM tipos_pieza_vehiculo tpv
      WHERE tpv.vehiculo_id = @vehiculoId AND tpv.tipo_pieza_id = v.tipo_pieza_id
    )`)
}

// Al quitar el tipo del vehículo se borra también la pieza que había elegido
// para él. Solo si el modelo tampoco lo pide: si lo pide, el tipo sigue en la
// lista y la elección debe conservarse.
export async function removeTipo(vehiculoId: number, tipoId: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('tipoId',     sql.Int, tipoId)
    .query(`
      DELETE pv
      FROM piezas_vehiculo pv
      WHERE pv.vehiculo_id = @vehiculoId AND pv.tipo_pieza_id = @tipoId
        AND NOT EXISTS (
          SELECT 1
          FROM vehiculos v
          JOIN tipos_pieza_modelo tpm ON tpm.modelo_id = v.modelo_id
          WHERE v.id = @vehiculoId AND tpm.tipo_pieza_id = @tipoId
        );

      DELETE FROM tipos_pieza_vehiculo
      OUTPUT DELETED.id
      WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId;`)
  return r.recordset.length > 0
}
