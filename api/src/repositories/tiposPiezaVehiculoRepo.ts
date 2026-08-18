import * as sql from 'mssql'
import { getPool } from '../shared/db'
import type { RenglonTipo } from './tiposPiezaModeloRepo'

// Tipos de pieza que pide un vehículo en concreto, además de los que ya pide su
// modelo. La lista que se muestra en el vehículo (piezasVehiculoRepo) es la
// unión de ambos; esto es solo la parte propia.
//
// Como en el modelo, la etiqueta ("delantero", "trasero") es lo que permite
// repetir el mismo tipo: sin etiqueta solo cabe un renglón por tipo.

// Asocia renglones al vehículo, ignorando los que ya estaban (evita chocar con
// la restricción única). "Ya estaba" es el par tipo+etiqueta.
export async function addTipos(vehiculoId: number, renglones: RenglonTipo[]): Promise<void> {
  if (renglones.length === 0) return
  const pool = await getPool()
  const req = pool.request().input('vehiculoId', sql.Int, vehiculoId)
  const values = renglones.map((r, i) => {
    req.input(`t${i}`, sql.Int, r.tipo_pieza_id)
    req.input(`e${i}`, sql.NVarChar(40), r.etiqueta)
    return `(@t${i}, @e${i})`
  })
  await req.query(`
    INSERT INTO tipos_pieza_vehiculo (vehiculo_id, tipo_pieza_id, etiqueta)
    SELECT @vehiculoId, v.tipo_pieza_id, v.etiqueta
    FROM (VALUES ${values.join(',')}) AS v(tipo_pieza_id, etiqueta)
    WHERE NOT EXISTS (
      SELECT 1 FROM tipos_pieza_vehiculo tpv
      WHERE tpv.vehiculo_id = @vehiculoId
        AND tpv.tipo_pieza_id = v.tipo_pieza_id
        AND tpv.etiqueta      = v.etiqueta
    )`)
}

// Renombra la etiqueta de un renglón propio del vehículo, arrastrando consigo la
// refacción montada y la bitácora: es la misma posición con otro nombre, no una
// posición nueva. Solo toca renglones propios; los que vienen del modelo se
// renombran allá y desde aquí ni se ven.
//
// Va en transacción por lo mismo que en el modelo: renombrar el renglón sin
// mover la pieza dejaría la asignación colgando de una etiqueta que ya no pide
// nadie.
export async function renameEtiqueta(
  vehiculoId: number, tipoId: number, actual: string, nueva: string,
): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const args = (r: sql.Request) => r
      .input('vehiculoId', sql.Int, vehiculoId)
      .input('tipoId',     sql.Int, tipoId)
      .input('actual',     sql.NVarChar(40), actual)
      .input('nueva',      sql.NVarChar(40), nueva)

    const r = await args(tx.request()).query(`
      UPDATE tipos_pieza_vehiculo SET etiqueta = @nueva
      WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId AND etiqueta = @actual`)

    if (r.rowsAffected[0] === 0) {
      await tx.rollback()
      return false
    }

    await args(tx.request()).query(`
      UPDATE piezas_vehiculo SET etiqueta = @nueva
      WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId AND etiqueta = @actual`)

    await args(tx.request()).query(`
      UPDATE instalaciones_pieza SET etiqueta = @nueva
      WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId AND etiqueta = @actual`)

    await tx.commit()
    return true
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// Al quitar el renglón del vehículo se borra también la pieza que había elegido
// para él. Solo si el modelo tampoco lo pide con esa etiqueta: si lo pide, el
// renglón sigue en la lista y la elección debe conservarse.
export async function removeTipo(
  vehiculoId: number, tipoId: number, etiqueta: string,
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('tipoId',     sql.Int, tipoId)
    .input('etiqueta',   sql.NVarChar(40), etiqueta)
    .query(`
      DELETE pv
      FROM piezas_vehiculo pv
      WHERE pv.vehiculo_id = @vehiculoId
        AND pv.tipo_pieza_id = @tipoId
        AND pv.etiqueta      = @etiqueta
        AND NOT EXISTS (
          SELECT 1
          FROM vehiculos v
          JOIN tipos_pieza_modelo tpm ON tpm.modelo_id = v.modelo_id
          WHERE v.id = @vehiculoId
            AND tpm.tipo_pieza_id = @tipoId
            AND tpm.etiqueta      = @etiqueta
        );

      DELETE FROM tipos_pieza_vehiculo
      OUTPUT DELETED.id
      WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId AND etiqueta = @etiqueta;`)
  return r.recordset.length > 0
}
