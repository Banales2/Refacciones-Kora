import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Pieza asociada a un modelo (datos de la pieza, sin cantidades: esta relación
// es informativa y no toca el inventario).
export interface PiezaDeModelo {
  id:           number
  numero_serie: string
  descripcion:  string
  categoria:    string
}

export async function findByModelo(modeloId: number): Promise<PiezaDeModelo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .query(`
      SELECT p.id, p.numero_serie, p.descripcion, p.categoria
      FROM piezas_modelo pm
      JOIN piezas p ON p.id = pm.pieza_id
      WHERE pm.modelo_id = @modeloId
      ORDER BY p.categoria, p.numero_serie`)
  return r.recordset
}

// Asocia piezas al modelo, ignorando las que ya estaban (evita chocar con la
// restricción única).
export async function addPiezas(modeloId: number, piezaIds: number[]): Promise<void> {
  if (piezaIds.length === 0) return
  const pool = await getPool()
  const req = pool.request().input('modeloId', sql.Int, modeloId)
  const values = piezaIds.map((pid, i) => {
    req.input(`p${i}`, sql.Int, pid)
    return `(@p${i})`
  })
  await req.query(`
    INSERT INTO piezas_modelo (modelo_id, pieza_id)
    SELECT @modeloId, v.pieza_id
    FROM (VALUES ${values.join(',')}) AS v(pieza_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM piezas_modelo pm
      WHERE pm.modelo_id = @modeloId AND pm.pieza_id = v.pieza_id
    )`)
}

export async function removePieza(modeloId: number, piezaId: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .input('piezaId',  sql.Int, piezaId)
    .query('DELETE FROM piezas_modelo OUTPUT DELETED.id WHERE modelo_id = @modeloId AND pieza_id = @piezaId')
  return r.recordset.length > 0
}
