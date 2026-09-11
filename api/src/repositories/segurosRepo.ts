import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { TABLAS_CON_SEGURO, vehiculosConDocumento } from './vehiculosSql'

export interface Seguro {
  id:               number
  poliza:           string
  compania:         string
  fecha_expiracion: string
  /** Lo que se pagó por la póliza. Null = no se capturó, que no es lo mismo que gratis. */
  costo:            number | null
  /**
   * Cuándo se dio por terminada. Null = sigue contando (avisa al vencer). Con
   * fecha = archivada: ya la reemplazó otra, o es tan vieja que reclamarla no
   * lleva a ninguna parte. No borra nada ni asegura a nadie: solo calla el
   * aviso del documento (ver la migración 029).
   */
  terminado_en:     string | null
}

const COLS = `id, poliza, compania,
  CONVERT(char(10), fecha_expiracion, 23) AS fecha_expiracion, costo,
  CONVERT(char(10), terminado_en, 23) AS terminado_en`

// mssql devuelve DECIMAL como string cuando no cabe en un number seguro; aquí
// siempre cabe, pero se normaliza para que el consumidor no tenga que
// preguntarse de qué tipo le llegó el dinero.
function mapSeguro(row: Record<string, unknown>): Seguro {
  return {
    ...(row as unknown as Seguro),
    costo: row.costo == null ? null : Number(row.costo),
  }
}

export async function findAll(): Promise<Seguro[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM seguros ORDER BY fecha_expiracion`)
  return r.recordset.map(mapSeguro)
}

export async function findById(id: number): Promise<Seguro | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM seguros WHERE id = @id`)
  return r.recordset[0] ? mapSeguro(r.recordset[0]) : null
}

export async function create(
  poliza: string, compania: string, fechaExpiracion: string, costo?: number | null
): Promise<Seguro> {
  const pool = await getPool()
  const r = await pool.request()
    .input('poliza',   sql.NVarChar(60),  poliza)
    .input('compania', sql.NVarChar(120), compania)
    .input('fecha',    sql.Date,          fechaExpiracion)
    .input('costo',    sql.Decimal(18, 2), costo ?? null)
    .query(`
      INSERT INTO seguros (poliza, compania, fecha_expiracion, costo)
      OUTPUT INSERTED.id, INSERTED.poliza, INSERTED.compania,
             CONVERT(char(10), INSERTED.fecha_expiracion, 23) AS fecha_expiracion,
             INSERTED.costo,
             CONVERT(char(10), INSERTED.terminado_en, 23) AS terminado_en
      VALUES (@poliza, @compania, @fecha, @costo)`)
  return mapSeguro(r.recordset[0])
}

// `costo` se distingue por presencia y no por valor: mandar null es borrarlo, y
// no mandarlo es dejarlo como estaba.
export async function update(
  id: number, poliza?: string, compania?: string, fechaExpiracion?: string,
  costo?: number | null,
): Promise<Seguro | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (poliza          !== undefined) { req.input('poliza',   sql.NVarChar(60),  poliza);          sets.push('poliza=@poliza')             }
  if (compania        !== undefined) { req.input('compania', sql.NVarChar(120), compania);        sets.push('compania=@compania')         }
  if (fechaExpiracion !== undefined) { req.input('fecha',    sql.Date,          fechaExpiracion); sets.push('fecha_expiracion=@fecha')    }
  if (costo           !== undefined) { req.input('costo',    sql.Decimal(18, 2), costo ?? null);  sets.push('costo=@costo')               }
  if (!sets.length) return findById(id)
  const r = await req.query(`
    UPDATE seguros SET ${sets.join(',')}
    OUTPUT INSERTED.id, INSERTED.poliza, INSERTED.compania,
           CONVERT(char(10), INSERTED.fecha_expiracion, 23) AS fecha_expiracion,
           INSERTED.costo,
           CONVERT(char(10), INSERTED.terminado_en, 23) AS terminado_en
    WHERE id=@id`)
  return r.recordset[0] ? mapSeguro(r.recordset[0]) : null
}

/**
 * Da por terminada la póliza (o la reactiva). `terminado_en` se pone con la
 * fecha del servidor y no con una que mande el cliente: lo que se archiva es
 * hoy, y aceptar la fecha de fuera solo abriría la puerta a archivar "el mes
 * pasado" sin que eso signifique nada.
 */
export async function setTerminado(id: number, terminado: boolean): Promise<Seguro | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      UPDATE seguros
      SET terminado_en = ${terminado ? 'CAST(GETDATE() AS date)' : 'NULL'}
      OUTPUT INSERTED.id, INSERTED.poliza, INSERTED.compania,
             CONVERT(char(10), INSERTED.fecha_expiracion, 23) AS fecha_expiracion,
             INSERTED.costo,
             CONVERT(char(10), INSERTED.terminado_en, 23) AS terminado_en
      WHERE id=@id`)
  return r.recordset[0] ? mapSeguro(r.recordset[0]) : null
}

// Las unidades que cubre la póliza. `countVehiculos` responde cuántas son;
// esto responde cuáles, que es lo que hace falta para pasarlas a la póliza
// nueva al renovar.
export async function findVehiculoIds(id: number): Promise<number[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT vehiculo_id FROM (${vehiculosConDocumento('seguro_id', '@id')}) x`)
  return r.recordset.map((row: { vehiculo_id: number }) => row.vehiculo_id)
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
