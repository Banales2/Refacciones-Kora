import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Tipo de pieza que requiere un modelo ("filtro de aire"). La relación es
// informativa y no toca el inventario: solo dice qué necesita el modelo, no con
// qué pieza se cubre — eso se decide en cada vehículo (piezasVehiculoRepo).
//
// La etiqueta es la posición que ocupa esa pieza en la unidad ("delantero",
// "trasero"): es lo que permite que el modelo pida el mismo tipo dos veces. Un
// tipo puede repetirse tantas veces como etiquetas distintas tenga, y una sola
// vez sin etiqueta ('').
export interface TipoPiezaDeModelo {
  id:       number
  nombre:   string
  etiqueta: string
}

// Un renglón de la plantilla: qué tipo y en qué posición.
export interface RenglonTipo {
  tipo_pieza_id: number
  etiqueta:      string
}

export async function findByModelo(modeloId: number): Promise<TipoPiezaDeModelo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .query(`
      SELECT t.id, t.nombre, tpm.etiqueta
      FROM tipos_pieza_modelo tpm
      JOIN tipos_pieza t ON t.id = tpm.tipo_pieza_id
      WHERE tpm.modelo_id = @modeloId
      ORDER BY t.nombre, tpm.etiqueta`)
  return r.recordset
}

// Asocia renglones al modelo, ignorando los que ya estaban (evita chocar con la
// restricción única). "Ya estaba" es el par tipo+etiqueta: el mismo tipo con
// otra etiqueta es un renglón nuevo.
export async function addTipos(modeloId: number, renglones: RenglonTipo[]): Promise<void> {
  if (renglones.length === 0) return
  const pool = await getPool()
  const req = pool.request().input('modeloId', sql.Int, modeloId)
  const values = renglones.map((r, i) => {
    req.input(`t${i}`, sql.Int, r.tipo_pieza_id)
    req.input(`e${i}`, sql.NVarChar(40), r.etiqueta)
    return `(@t${i}, @e${i})`
  })
  await req.query(`
    INSERT INTO tipos_pieza_modelo (modelo_id, tipo_pieza_id, etiqueta)
    SELECT @modeloId, v.tipo_pieza_id, v.etiqueta
    FROM (VALUES ${values.join(',')}) AS v(tipo_pieza_id, etiqueta)
    WHERE NOT EXISTS (
      SELECT 1 FROM tipos_pieza_modelo tpm
      WHERE tpm.modelo_id = @modeloId
        AND tpm.tipo_pieza_id = v.tipo_pieza_id
        AND tpm.etiqueta      = v.etiqueta
    )`)
}

// Al quitar el renglón del modelo se borran también las piezas que los vehículos
// de ese modelo habían elegido para él: sin el renglón, la elección queda
// huérfana. Se borra solo la de esa etiqueta; los otros renglones del mismo tipo
// no se tocan.
export async function removeTipo(
  modeloId: number, tipoId: number, etiqueta: string,
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .input('tipoId',   sql.Int, tipoId)
    .input('etiqueta', sql.NVarChar(40), etiqueta)
    .query(`
      DELETE pv
      FROM piezas_vehiculo pv
      JOIN vehiculos v ON v.id = pv.vehiculo_id
      WHERE v.modelo_id = @modeloId
        AND pv.tipo_pieza_id = @tipoId
        AND pv.etiqueta      = @etiqueta;

      DELETE FROM tipos_pieza_modelo
      OUTPUT DELETED.id
      WHERE modelo_id = @modeloId AND tipo_pieza_id = @tipoId AND etiqueta = @etiqueta;`)
  return r.recordset.length > 0
}
