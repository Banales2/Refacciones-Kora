// Incidencia: algo que alguien reportó de un vehículo y hay que atender una vez
// (a diferencia del preventivo, que se repite cada ciclo). Es el segundo hijo de
// `pendientes` (ver pendientesRepo) y comparte su id con el padre.
//
// Se cierra con un mantenimiento —uno solo, la base lo impone con un índice
// único filtrado sobre mantenimiento_pendientes— o se cancela, en cuyo caso
// queda el registro pero deja de alertar.
import * as sql from 'mssql'
import { getPool } from '../shared/db'
import * as pendientes from './pendientesRepo'
import { PENDIENTE_COLS, type StatusPendiente } from './pendientesRepo'

export type Severidad     = 'superficial' | 'moderada' | 'grave'
export type StatusIncidencia = StatusPendiente

export interface Incidencia {
  id:            number
  vehiculo_id:   number
  origen:        'incidencia'
  nombre:        string
  descripcion:   string | null
  categoria:     string | null
  status:        StatusIncidencia
  created_at:    string
  updated_at:    string
  reportado_por: string | null
  severidad:     Severidad
  fecha:         string
  hora:          string | null
  ubicacion:     string | null
}

export interface IncidenciaConVehiculo extends Incidencia {
  vehiculo_nombre: string
  vehiculo_tipo:   string
}

export interface IncidenciaCreate {
  vehiculo_id:    number
  nombre:         string
  descripcion?:   string | null
  categoria?:     string | null
  status?:        StatusIncidencia
  reportado_por?: string | null
  severidad:      Severidad
  fecha:          string
  hora?:          string | null
  ubicacion?:     string | null
}

export interface IncidenciaUpdate {
  nombre?:        string
  descripcion?:   string | null
  categoria?:     string | null
  status?:        StatusIncidencia
  reportado_por?: string | null
  severidad?:     Severidad
  fecha?:         string
  hora?:          string | null
  ubicacion?:     string | null
}

// `hora` se convierte a texto "HH:MM" aquí: el driver devuelve las columnas TIME
// como Date, que al serializarse a JSON sale como "1970-01-01T14:30:00.000Z" y
// obliga al front a desenredar una fecha que no existe.
const HORA_TXT = `CONVERT(varchar(5), i.hora, 108) AS hora`

const SELECT_INC = `
  SELECT ${PENDIENTE_COLS},
         i.reportado_por, i.severidad, i.fecha, ${HORA_TXT}, i.ubicacion
  FROM pendientes p
  JOIN incidencias i ON i.id = p.id`

export async function findByVehiculo(vehiculoId: number): Promise<Incidencia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`${SELECT_INC} WHERE p.vehiculo_id=@vid ORDER BY i.fecha DESC, i.hora DESC`)
  return r.recordset
}

// Para la pantalla de Incidencias, que las lista de toda la flota.
export async function findAllConVehiculo(): Promise<IncidenciaConVehiculo[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT ${PENDIENTE_COLS},
           i.reportado_por, i.severidad, i.fecha, ${HORA_TXT}, i.ubicacion,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
           v.tipo AS vehiculo_tipo
    FROM pendientes p
    JOIN incidencias i ON i.id = p.id
    JOIN vehiculos v   ON v.id = p.vehiculo_id
    JOIN modelos mo    ON mo.id = v.modelo_id
    ORDER BY i.fecha DESC, i.hora DESC
  `)
  return r.recordset
}

export async function findById(id: number): Promise<Incidencia | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_INC} WHERE p.id=@id`)
  return r.recordset[0] ?? null
}

export async function create(data: IncidenciaCreate): Promise<Incidencia> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  let id: number
  try {
    id = await pendientes.insert(tx, {
      vehiculo_id: data.vehiculo_id,
      origen:      'incidencia',
      nombre:      data.nombre,
      descripcion: data.descripcion,
      categoria:   data.categoria,
      status:      data.status,
    })
    await tx.request()
      .input('id',        sql.Int,           id)
      .input('reportado', sql.NVarChar(120), data.reportado_por ?? null)
      .input('severidad', sql.NVarChar(20),  data.severidad)
      .input('fecha',     sql.Date,          data.fecha)
      .input('hora',      sql.VarChar(8),    data.hora      ?? null)
      .input('ubicacion', sql.NVarChar(160), data.ubicacion ?? null)
      .query(`
        INSERT INTO incidencias (id, reportado_por, severidad, fecha, hora, ubicacion)
        VALUES (@id, @reportado, @severidad, @fecha, @hora, @ubicacion)
      `)
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return (await findById(id))!
}

export async function update(id: number, data: IncidenciaUpdate): Promise<Incidencia | null> {
  const existe = await findById(id)
  if (!existe) return null

  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await pendientes.applyUpdate(tx, id, {
      ...('nombre'      in data ? { nombre:      data.nombre }      : {}),
      ...('descripcion' in data ? { descripcion: data.descripcion } : {}),
      ...('categoria'   in data ? { categoria:   data.categoria }   : {}),
      ...('status'      in data ? { status:      data.status }      : {}),
    })

    const sets: string[] = []
    const req = tx.request().input('id', sql.Int, id)
    if ('reportado_por' in data)      { req.input('reportado', sql.NVarChar(120), data.reportado_por ?? null); sets.push('reportado_por=@reportado') }
    if (data.severidad !== undefined) { req.input('severidad', sql.NVarChar(20),  data.severidad);             sets.push('severidad=@severidad')     }
    if (data.fecha     !== undefined) { req.input('fecha',     sql.Date,          data.fecha);                 sets.push('fecha=@fecha')             }
    if ('hora'      in data)          { req.input('hora',      sql.VarChar(8),    data.hora      ?? null);     sets.push('hora=@hora')               }
    if ('ubicacion' in data)          { req.input('ubicacion', sql.NVarChar(160), data.ubicacion ?? null);     sets.push('ubicacion=@ubicacion')     }
    if (sets.length) {
      await req.query(`UPDATE incidencias SET ${sets.join(',')} WHERE id=@id`)
    }

    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return findById(id)
}

export const remove = pendientes.remove
