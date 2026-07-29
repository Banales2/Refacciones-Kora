import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { ValeGasolinaCreate, ValeGasolinaUpdate } from '../schemas/valeGasolinaSchema'

export interface ValeGasolina {
  id:           number
  creado_por:   string
  conductor_id: number
  vehiculo_id:  number
  fecha:        string
  conductor:    string
  marca:        string
  modelo:       string
  serie:        string
  placas:       string | null
}

const SELECT_VALE = `
  SELECT vg.id, vg.creado_por, vg.conductor_id, vg.vehiculo_id,
         CONVERT(char(10), vg.fecha, 23) AS fecha,
         c.nombre AS conductor,
         m.marca, m.nombre AS modelo, v.numero_serie AS serie, v.placas
  FROM vales_gasolina vg
  JOIN conductores c ON c.id = vg.conductor_id
  JOIN vehiculos   v ON v.id = vg.vehiculo_id
  JOIN modelos     m ON m.id = v.modelo_id
`

export async function findAll(): Promise<ValeGasolina[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query(`${SELECT_VALE} ORDER BY vg.fecha DESC, vg.id DESC`)
  return r.recordset
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
    .input('creado_por',   sql.NVarChar(120), creadoPor)
    .input('conductor_id', sql.Int,  data.conductor_id)
    .input('vehiculo_id',  sql.Int,  data.vehiculo_id)
    .input('fecha',        sql.Date, data.fecha)
    .query(`
      INSERT INTO vales_gasolina (creado_por, conductor_id, vehiculo_id, fecha)
      OUTPUT INSERTED.id
      VALUES (@creado_por, @conductor_id, @vehiculo_id, @fecha)
    `)
  return findById(r.recordset[0].id) as Promise<ValeGasolina>
}

// `creado_por` no se edita: registra quién dio de alta el vale.
export async function update(id: number, data: ValeGasolinaUpdate): Promise<ValeGasolina | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)

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

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM vales_gasolina OUTPUT DELETED.id WHERE id = @id')
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
