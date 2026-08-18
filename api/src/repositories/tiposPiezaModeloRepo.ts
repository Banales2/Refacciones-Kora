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

// ¿Algún vehículo de este modelo tiene ya un renglón propio con este tipo y esta
// etiqueta? Es lo que impide renombrar hacia ella: la unidad acabaría con dos
// renglones idénticos y la clave única lo rechazaría a media operación.
export async function unidadesConEtiquetaPropia(
  modeloId: number, tipoId: number, etiqueta: string,
): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .input('tipoId',   sql.Int, tipoId)
    .input('etiqueta', sql.NVarChar(40), etiqueta)
    .query(`
      SELECT COUNT(DISTINCT v.id) AS n
      FROM vehiculos v
      JOIN tipos_pieza_vehiculo tpv ON tpv.vehiculo_id = v.id
      WHERE v.modelo_id = @modeloId
        AND tpv.tipo_pieza_id = @tipoId
        AND tpv.etiqueta      = @etiqueta`)
  return r.recordset[0].n
}

// Renombra la etiqueta de un renglón de la plantilla. Es un cambio de nombre de
// la MISMA posición, no un renglón nuevo: por eso arrastra consigo lo que los
// vehículos del modelo tienen colgado de ella —la refacción montada y la
// bitácora completa, incluidos los renglones ya cerrados— en vez de dejarlo
// huérfano como haría un quitar-y-volver-a-agregar.
//
// Va en transacción porque una plantilla renombrada con las piezas apuntando al
// nombre viejo dejaría a esos vehículos sin refacción en el renglón nuevo y con
// una asignación que ya no corresponde a nada.
export async function renameEtiqueta(
  modeloId: number, tipoId: number, actual: string, nueva: string,
): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const args = (r: sql.Request) => r
      .input('modeloId', sql.Int, modeloId)
      .input('tipoId',   sql.Int, tipoId)
      .input('actual',   sql.NVarChar(40), actual)
      .input('nueva',    sql.NVarChar(40), nueva)

    const r = await args(tx.request()).query(`
      UPDATE tipos_pieza_modelo SET etiqueta = @nueva
      WHERE modelo_id = @modeloId AND tipo_pieza_id = @tipoId AND etiqueta = @actual`)

    if (r.rowsAffected[0] === 0) {
      await tx.rollback()
      return false
    }

    await args(tx.request()).query(`
      UPDATE pv SET pv.etiqueta = @nueva
      FROM piezas_vehiculo pv
      JOIN vehiculos v ON v.id = pv.vehiculo_id
      WHERE v.modelo_id = @modeloId
        AND pv.tipo_pieza_id = @tipoId
        AND pv.etiqueta      = @actual`)

    await args(tx.request()).query(`
      UPDATE i SET i.etiqueta = @nueva
      FROM instalaciones_pieza i
      JOIN vehiculos v ON v.id = i.vehiculo_id
      WHERE v.modelo_id = @modeloId
        AND i.tipo_pieza_id = @tipoId
        AND i.etiqueta      = @actual`)

    await tx.commit()
    return true
  } catch (err) {
    await tx.rollback()
    throw err
  }
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
