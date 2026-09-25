import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { ValeGasolinaCreate, ValeGasolinaUpdate } from '../schemas/valeGasolinaSchema'
import { estadoDelVale, type EstadoVale } from '../shared/vales'

export interface ValeGasolina {
  id:           number
  folio:        string
  creado_por:   string
  conductor_id: number
  vehiculo_id:  number
  fecha:        string
  conductor:    string
  marca:        string
  modelo:       string
  serie:        string
  placas:       string | null
  /**
   * Qué le pasó al papel. Derivado salvo el archivado; ver `shared/vales.ts`.
   */
  estado:       EstadoVale
  archivado_en:     string | null
  archivado_motivo: string | null
  /** La recarga que lo gastó. `null` mientras nadie lo use. */
  recarga_id:         number | null
  recarga_fecha:      string | null
  recarga_litros:     number | null
  recarga_gasolinera: string | null
  /** Días que lleva sin gastarse. `null` en cuanto se usó. */
  dias_sin_usar: number | null
}

const SELECT_VALE = `
  SELECT vg.id, vg.folio, vg.creado_por, vg.conductor_id, vg.vehiculo_id,
         CONVERT(char(10), vg.fecha, 23) AS fecha,
         c.nombre AS conductor,
         m.marca, m.nombre AS modelo, v.numero_serie AS serie, v.placas,
         ${estadoDelVale('vg')} AS estado,
         CONVERT(char(10), vg.archivado_en, 23) AS archivado_en,
         vg.archivado_motivo,
         -- La recarga que lo gastó, si alguna. Es lo que convierte el "usado"
         -- en algo que se puede ir a ver, en vez de una etiqueta de color.
         rc.id AS recarga_id,
         CONVERT(char(10), rc.fecha, 23) AS recarga_fecha,
         rc.litros AS recarga_litros,
         g.nombre AS recarga_gasolinera,
         -- Cuántos días lleva el papel sin gastarse. Null en cuanto se usó: ahí
         -- la espera terminó y el número dejaría de significar nada.
         CASE WHEN rc.id IS NULL
              THEN DATEDIFF(day, vg.fecha,
                     CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Central Standard Time (Mexico)' AS date))
         END AS dias_sin_usar
  FROM vales_gasolina vg
  JOIN conductores c ON c.id = vg.conductor_id
  JOIN vehiculos   v ON v.id = vg.vehiculo_id
  JOIN modelos     m ON m.id = v.modelo_id
  -- LEFT y no EXISTS porque además de saber si se usó hay que poder decir
  -- dónde. El índice único UQ_recargas_vale garantiza que hay a lo sumo una,
  -- así que este JOIN no puede multiplicar renglones.
  LEFT JOIN recargas_combustible rc ON rc.vale_id = vg.id
  LEFT JOIN gasolineras g ON g.id = rc.gasolinera_id
`

// mssql devuelve DECIMAL como string; los litros de la recarga se normalizan
// en la frontera para no dejar al cliente comparando "40.000" con 40.
function aVale(row: Record<string, unknown>): ValeGasolina {
  return {
    ...row,
    recarga_litros: row.recarga_litros == null ? null : Number(row.recarga_litros),
  } as ValeGasolina
}

/**
 * Los vales. Por omisión sin los archivados: un vale que se dio por perdido ya
 * no es trabajo de nadie, y dejarlo en la lista de todos los días hace que la
 * lista deje de mirarse.
 */
export async function findAll(incluirArchivados = false): Promise<ValeGasolina[]> {
  const pool = await getPool()
  const filtro = incluirArchivados ? '' : 'WHERE vg.archivado_en IS NULL'
  const r = await pool.request()
    .query(`${SELECT_VALE} ${filtro} ORDER BY vg.fecha DESC, vg.id DESC`)
  return r.recordset.map(aVale)
}

/** ¿Este vale se dio por perdido? Lo pregunta la recarga antes de aceptarlo. */
export async function estaArchivado(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT TOP 1 1 AS si FROM vales_gasolina WHERE id = @id AND archivado_en IS NOT NULL')
  return r.recordset.length > 0
}

export async function findById(id: number): Promise<ValeGasolina | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_VALE} WHERE vg.id = @id`)
  return r.recordset[0] ?? null
}

export async function create(data: ValeGasolinaCreate, creadoPor: string): Promise<ValeGasolina> {
  const pool = await getPool()
  const r = await pool.request()
    .input('folio',        sql.NVarChar(30),  data.folio)
    .input('creado_por',   sql.NVarChar(120), creadoPor)
    .input('conductor_id', sql.Int,  data.conductor_id)
    .input('vehiculo_id',  sql.Int,  data.vehiculo_id)
    .input('fecha',        sql.Date, data.fecha)
    .query(`
      INSERT INTO vales_gasolina (folio, creado_por, conductor_id, vehiculo_id, fecha)
      OUTPUT INSERTED.id
      VALUES (@folio, @creado_por, @conductor_id, @vehiculo_id, @fecha)
    `)
  return findById(r.recordset[0].id) as Promise<ValeGasolina>
}

// `creado_por` no se edita: registra quién dio de alta el vale.
export async function update(id: number, data: ValeGasolinaUpdate): Promise<ValeGasolina | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)

  if (data.folio !== undefined) {
    req.input('folio', sql.NVarChar(30), data.folio)
    sets.push('folio = @folio')
  }
  if (data.conductor_id !== undefined) {
    req.input('conductor_id', sql.Int, data.conductor_id)
    sets.push('conductor_id = @conductor_id')
  }
  if (data.vehiculo_id !== undefined) {
    req.input('vehiculo_id', sql.Int, data.vehiculo_id)
    sets.push('vehiculo_id = @vehiculo_id')
  }
  if (data.fecha !== undefined) {
    req.input('fecha', sql.Date, data.fecha)
    sets.push('fecha = @fecha')
  }
  if (!sets.length) return findById(id)

  const r = await req.query(
    `UPDATE vales_gasolina SET ${sets.join(', ')} OUTPUT INSERTED.id WHERE id = @id`
  )
  if (!r.recordset.length) return null
  return findById(id)
}

// El folio identifica al papel: no se repite entre vales. `exceptId` deja fuera
// al vale que se esta editando, que si conserva el suyo.
export async function existsFolio(folio: string, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('folio',  sql.NVarChar(30), folio)
    .input('except', sql.Int,          exceptId ?? null)
    .query('SELECT TOP 1 id FROM vales_gasolina WHERE folio = @folio AND (@except IS NULL OR id <> @except)')
  return r.recordset.length > 0
}

export async function conductorExists(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT TOP 1 id FROM conductores WHERE id = @id')
  return r.recordset.length > 0
}

export async function vehiculoExists(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT TOP 1 id FROM vehiculos WHERE id = @id')
  return r.recordset.length > 0
}
