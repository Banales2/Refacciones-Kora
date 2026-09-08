import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { RecargaCreate, RecargaUpdate } from '../schemas/recargaSchema'

export interface RecargaConGasolinera {
  id:            number
  vehiculo_id:   number
  gasolinera_id: number
  conductor_id:  number
  vale_id:       number | null
  fecha:         string
  litros:        number
  costo:         number
  kilometraje:   number | null
  gasolinera:    string
  ubicacion:     string
  conductor:     string
  vale_folio:    string | null
  vale_fecha:    string | null
}

// El vale entra con LEFT JOIN: las recargas registradas antes de que el vale
// fuera obligatorio no tienen ninguno y deben seguir apareciendo en el listado.
const SELECT_RECARGA = `
  SELECT r.id, r.vehiculo_id, r.gasolinera_id, r.conductor_id, r.vale_id, r.fecha,
         r.litros, r.costo, r.kilometraje,
         g.nombre AS gasolinera, g.ubicacion,
         c.nombre AS conductor,
         vg.folio AS vale_folio,
         CONVERT(char(10), vg.fecha, 23) AS vale_fecha
  FROM recargas_combustible r
  JOIN gasolineras g       ON g.id = r.gasolinera_id
  JOIN conductores c       ON c.id = r.conductor_id
  LEFT JOIN vales_gasolina vg ON vg.id = r.vale_id
`

export async function findByVehiculo(vehiculoId: number): Promise<RecargaConGasolinera[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`${SELECT_RECARGA} WHERE r.vehiculo_id = @vid ORDER BY r.fecha DESC, r.id DESC`)
  return r.recordset
}

export async function findById(id: number): Promise<RecargaConGasolinera | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_RECARGA} WHERE r.id = @id`)
  return r.recordset[0] ?? null
}

export async function create(vehiculoId: number, data: RecargaCreate): Promise<RecargaConGasolinera> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculo_id',   sql.Int, vehiculoId)
    .input('gasolinera_id', sql.Int, data.gasolinera_id)
    .input('conductor_id',  sql.Int, data.conductor_id)
    .input('vale_id',       sql.Int, data.vale_id)
    .input('fecha',         sql.Date, data.fecha)
    .input('litros',        sql.Decimal(10, 3), data.litros)
    .input('costo',         sql.Decimal(18, 2), data.costo)
    .input('kilometraje',   sql.Int, data.kilometraje)
    .query(`
      INSERT INTO recargas_combustible (vehiculo_id, gasolinera_id, conductor_id, vale_id, fecha, litros, costo, kilometraje)
      OUTPUT INSERTED.id
      VALUES (@vehiculo_id, @gasolinera_id, @conductor_id, @vale_id, @fecha, @litros, @costo, @kilometraje)
    `)
  return findById(r.recordset[0].id) as Promise<RecargaConGasolinera>
}

export async function update(id: number, data: RecargaUpdate): Promise<RecargaConGasolinera | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)

  if (data.gasolinera_id !== undefined) {
    req.input('gasolinera_id', sql.Int, data.gasolinera_id)
    sets.push('gasolinera_id = @gasolinera_id')
  }
  if (data.conductor_id !== undefined) {
    req.input('conductor_id', sql.Int, data.conductor_id)
    sets.push('conductor_id = @conductor_id')
  }
  if (data.vale_id !== undefined) {
    req.input('vale_id', sql.Int, data.vale_id)
    sets.push('vale_id = @vale_id')
  }
  if (data.fecha !== undefined) {
    req.input('fecha', sql.Date, data.fecha)
    sets.push('fecha = @fecha')
  }
  if (data.litros !== undefined) {
    req.input('litros', sql.Decimal(10, 3), data.litros)
    sets.push('litros = @litros')
  }
  if (data.costo !== undefined) {
    req.input('costo', sql.Decimal(18, 2), data.costo)
    sets.push('costo = @costo')
  }
  if (data.kilometraje !== undefined) {
    req.input('kilometraje', sql.Int, data.kilometraje)
    sets.push('kilometraje = @kilometraje')
  }

  if (!sets.length) return findById(id)

  await req.query(`UPDATE recargas_combustible SET ${sets.join(', ')} WHERE id = @id`)
  return findById(id)
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM recargas_combustible OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}

// ¿El vale ya se usó en otra recarga? exceptId excluye la propia al editar.
// Duplica lo que garantiza el índice único UQ_recargas_vale, pero permite
// responder con un mensaje claro en vez de un error del motor.
export async function valeUsado(valeId: number, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vale_id', sql.Int, valeId)
    .input('except',  sql.Int, exceptId ?? null)
    .query(`SELECT TOP 1 id FROM recargas_combustible
            WHERE vale_id = @vale_id AND (@except IS NULL OR id <> @except)`)
  return r.recordset.length > 0
}

// Vehículo al que pertenece un vale, o null si el vale no existe. Sirve para
// rechazar un vale emitido para otra unidad.
export async function valeVehiculo(id: number): Promise<number | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT vehiculo_id FROM vales_gasolina WHERE id = @id')
  return r.recordset[0]?.vehiculo_id ?? null
}

export async function vehiculoExists(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM vehiculos WHERE id = @id')
  return r.recordset.length > 0
}

/**
 * Todo lo que se ha gastado en una gasolinera.
 *
 * El dinero vive en la recarga y solo ahí: el vale de gasolina no guarda costo
 * ni gasolinera —es el papel que autoriza a cargar, con su folio, su chofer y
 * su unidad—, así que sumar vales daría un gasto que no existe. Lo que sí hace
 * el vale es identificar la carga, y por eso su folio viaja en cada renglón.
 *
 * Se devuelve plano y de lo más reciente a lo más viejo; los totales y el
 * agrupado por año los arma la pantalla.
 */
export interface ConsumoGasolinera {
  id:           number
  fecha:        string
  vehiculo_id:  number
  vehiculo:     string
  conductor:    string
  vale_folio:   string | null
  litros:       number
  costo:        number
  kilometraje:  number | null
}

export async function findConsumosDeGasolinera(
  gasolineraId: number,
): Promise<ConsumoGasolinera[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('gid', sql.Int, gasolineraId)
    .query(`
      SELECT r.id, CONVERT(char(10), r.fecha, 23) AS fecha,
             r.vehiculo_id,
             CONCAT(m.marca, ' ', m.nombre, ' — ', v.numero_serie) AS vehiculo,
             c.nombre AS conductor, vg.folio AS vale_folio,
             r.litros, r.costo, r.kilometraje
      FROM recargas_combustible r
      JOIN vehiculos   v  ON v.id = r.vehiculo_id
      JOIN modelos     m  ON m.id = v.modelo_id
      JOIN conductores c  ON c.id = r.conductor_id
      LEFT JOIN vales_gasolina vg ON vg.id = r.vale_id
      WHERE r.gasolinera_id = @gid
      ORDER BY r.fecha DESC, r.id DESC`)
  // mssql devuelve DECIMAL como string cuando no cabe en un number seguro.
  return r.recordset.map((row) => ({
    ...row,
    litros: Number(row.litros),
    costo:  Number(row.costo),
  }))
}
