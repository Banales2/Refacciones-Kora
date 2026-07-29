import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Tipo de pieza que requiere un modelo ("filtro de aire"). La relación es
// informativa y no toca el inventario: solo dice qué necesita el modelo, no con
// qué pieza se cubre — eso se decide en cada vehículo (piezasVehiculoRepo).
export interface TipoPiezaDeModelo {
  id:     number
  nombre: string
}

export async function findByModelo(modeloId: number): Promise<TipoPiezaDeModelo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .query(`
      SELECT t.id, t.nombre
      FROM tipos_pieza_modelo tpm
      JOIN tipos_pieza t ON t.id = tpm.tipo_pieza_id
      WHERE tpm.modelo_id = @modeloId
      ORDER BY t.nombre`)
  return r.recordset
}

// Asocia tipos al modelo, ignorando los que ya estaban (evita chocar con la
// restricción única).
export async function addTipos(modeloId: number, tipoIds: number[]): Promise<void> {
  if (tipoIds.length === 0) return
  const pool = await getPool()
  const req = pool.request().input('modeloId', sql.Int, modeloId)
  const values = tipoIds.map((tid, i) => {
    req.input(`t${i}`, sql.Int, tid)
    return `(@t${i})`
  })
  await req.query(`
    INSERT INTO tipos_pieza_modelo (modelo_id, tipo_pieza_id)
    SELECT @modeloId, v.tipo_pieza_id
    FROM (VALUES ${values.join(',')}) AS v(tipo_pieza_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM tipos_pieza_modelo tpm
      WHERE tpm.modelo_id = @modeloId AND tpm.tipo_pieza_id = v.tipo_pieza_id
    )`)
}

// Al quitar el tipo del modelo se borran también las piezas que los vehículos de
// ese modelo habían elegido para él: sin el tipo, la elección queda huérfana.
export async function removeTipo(modeloId: number, tipoId: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .input('tipoId',   sql.Int, tipoId)
    .query(`
      DELETE pv
      FROM piezas_vehiculo pv
      JOIN vehiculos v ON v.id = pv.vehiculo_id
      WHERE v.modelo_id = @modeloId AND pv.tipo_pieza_id = @tipoId;

      DELETE FROM tipos_pieza_modelo
      OUTPUT DELETED.id
      WHERE modelo_id = @modeloId AND tipo_pieza_id = @tipoId;`)
  return r.recordset.length > 0
}
