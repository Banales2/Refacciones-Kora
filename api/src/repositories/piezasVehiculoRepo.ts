import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Un tipo que necesita el vehículo, junto con la pieza que usa para cubrirlo.
// pieza_id es null mientras nadie la haya elegido: el tipo se sigue listando
// para que se vea que falta capturarla.
export interface PiezaDeVehiculo {
  tipo_pieza_id: number
  tipo_nombre:   string
  pieza_id:      number | null
  numero_serie:  string | null
  descripcion:   string | null
  // 'modelo': lo pide el modelo y se gestiona allá. 'vehiculo': es propio de
  // esta unidad y solo desde aquí se quita.
  origen:        'modelo' | 'vehiculo'
}

// Los tipos del modelo más los propios del vehículo.
export async function findByVehiculo(vehiculoId: number): Promise<PiezaDeVehiculo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .query(`
      WITH requeridos AS (
        SELECT tpm.tipo_pieza_id, 1 AS del_modelo
        FROM vehiculos v
        JOIN tipos_pieza_modelo tpm ON tpm.modelo_id = v.modelo_id
        WHERE v.id = @vehiculoId
        UNION ALL
        SELECT tpv.tipo_pieza_id, 0
        FROM tipos_pieza_vehiculo tpv
        WHERE tpv.vehiculo_id = @vehiculoId
      )
      SELECT
        t.id     AS tipo_pieza_id,
        t.nombre AS tipo_nombre,
        p.id     AS pieza_id,
        p.numero_serie,
        p.descripcion,
        -- Un tipo puede estar en las dos listas; ahí gana 'modelo', porque es
        -- el modelo el que manda y quitarlo del vehículo no lo sacaría.
        CASE WHEN MAX(r.del_modelo) = 1 THEN 'modelo' ELSE 'vehiculo' END AS origen
      FROM requeridos r
      JOIN tipos_pieza t ON t.id = r.tipo_pieza_id
      LEFT JOIN piezas_vehiculo pv ON pv.vehiculo_id = @vehiculoId AND pv.tipo_pieza_id = t.id
      LEFT JOIN piezas p           ON p.id = pv.pieza_id
      GROUP BY t.id, t.nombre, p.id, p.numero_serie, p.descripcion
      ORDER BY t.nombre`)
  return r.recordset
}

// ¿El vehículo necesita este tipo, ya sea por su modelo o por sí mismo? Solo a
// esos tipos se les puede asignar una pieza.
export async function vehiculoRequiereTipo(vehiculoId: number, tipoId: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('tipoId',     sql.Int, tipoId)
    .query(`
      SELECT TOP 1 v.id
      FROM vehiculos v
      WHERE v.id = @vehiculoId
        AND (
          EXISTS (
            SELECT 1 FROM tipos_pieza_modelo tpm
            WHERE tpm.modelo_id = v.modelo_id AND tpm.tipo_pieza_id = @tipoId
          )
          OR EXISTS (
            SELECT 1 FROM tipos_pieza_vehiculo tpv
            WHERE tpv.vehiculo_id = v.id AND tpv.tipo_pieza_id = @tipoId
          )
        )`)
  return r.recordset.length > 0
}

// Una pieza por (vehículo, tipo): volver a asignar reemplaza la anterior.
export async function setPieza(vehiculoId: number, tipoId: number, piezaId: number): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('tipoId',     sql.Int, tipoId)
    .input('piezaId',    sql.Int, piezaId)
    .query(`
      UPDATE piezas_vehiculo SET pieza_id = @piezaId
      WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId;

      IF @@ROWCOUNT = 0
        INSERT INTO piezas_vehiculo (vehiculo_id, tipo_pieza_id, pieza_id)
        VALUES (@vehiculoId, @tipoId, @piezaId);`)
}

export async function countVehiculosConPieza(piezaId: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('piezaId', sql.Int, piezaId)
    .query('SELECT COUNT(*) AS cnt FROM piezas_vehiculo WHERE pieza_id = @piezaId')
  return r.recordset[0].cnt
}

// Al cambiar el tipo de una pieza, los vehículos que la habían elegido para el
// tipo anterior quedan con una asignación que ya no corresponde: se borra.
export async function removeAsignacionesFueraDeTipo(piezaId: number): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('piezaId', sql.Int, piezaId)
    .query(`
      DELETE pv
      FROM piezas_vehiculo pv
      JOIN piezas p ON p.id = pv.pieza_id
      WHERE pv.pieza_id = @piezaId
        AND (p.tipo_pieza_id IS NULL OR pv.tipo_pieza_id <> p.tipo_pieza_id)`)
}

export async function removePieza(vehiculoId: number, tipoId: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('tipoId',     sql.Int, tipoId)
    .query(`
      DELETE FROM piezas_vehiculo
      OUTPUT DELETED.id
      WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId`)
  return r.recordset.length > 0
}
