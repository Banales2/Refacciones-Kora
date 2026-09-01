// Mantenimiento preventivo de un vehículo: vence por kilometraje, por tiempo o
// por ambos, y se vuelve a vencer cada ciclo. Es uno de los dos hijos de
// `pendientes` (ver pendientesRepo): comparte su id con el padre, que guarda
// nombre, descripción, categoría, status y vehículo.
import * as sql from 'mssql'
import { getPool } from '../shared/db'
import * as pendientes from './pendientesRepo'
import { PENDIENTE_COLS, type StatusPendiente } from './pendientesRepo'
import { parseIntervalosIniciales, serializeIntervalosIniciales } from '../shared/intervalos'

export type TriggerMode = 'km' | 'meses' | 'ambos'
export type StatusReq   = StatusPendiente

// Plano: el consumidor no distingue qué campo vino del padre y cuál del hijo.
export interface RequerimientoExclusivo {
  id:                  number
  vehiculo_id:         number
  origen:              'preventivo'
  nombre:              string
  descripcion:         string | null
  categoria:           string | null
  status:              StatusReq
  created_at:          string
  updated_at:          string
  trigger_mode:        TriggerMode
  intervalo_km:        number | null
  intervalo_meses:     number | null
  // Los primeros servicios con intervalo distinto al de ciclo, en orden y como
  // distancias entre servicios. null = todos al mismo (ver shared/intervalos).
  intervalos_iniciales_km: number[] | null
  fecha_inicio:        string | null
  km_inicio:           number | null
  fecha_reporte:       string | null
  plantilla_origen_id: number | null
}

export interface RequerimientoCreate {
  vehiculo_id:          number
  nombre:               string
  descripcion?:         string | null
  categoria?:           string | null
  status?:              StatusReq
  trigger_mode:         TriggerMode
  intervalo_km?:        number | null
  intervalo_meses?:     number | null
  intervalos_iniciales_km?: number[] | null
  fecha_inicio?:        string | null
  km_inicio?:           number | null
  fecha_reporte?:       string | null
  plantilla_origen_id?: number | null
}

export interface RequerimientoUpdate {
  nombre?:          string
  descripcion?:     string | null
  categoria?:       string | null
  status?:          StatusReq
  trigger_mode?:    TriggerMode
  intervalo_km?:    number | null
  intervalo_meses?: number | null
  intervalos_iniciales_km?: number[] | null
  fecha_inicio?:    string | null
  km_inicio?:       number | null
  fecha_reporte?:   string | null
}

const SELECT_REQ = `
  SELECT ${PENDIENTE_COLS},
         r.trigger_mode, r.intervalo_km, r.intervalo_meses, r.intervalos_iniciales_km,
         r.fecha_inicio, r.km_inicio, r.fecha_reporte, r.plantilla_origen_id
  FROM pendientes p
  JOIN requerimientos_exclusivos r ON r.id = p.id`

// La columna llega como texto; el resto del sistema solo la conoce como lista.
function mapRow(row: Record<string, unknown>): RequerimientoExclusivo {
  return {
    ...(row as unknown as RequerimientoExclusivo),
    intervalos_iniciales_km: parseIntervalosIniciales(row.intervalos_iniciales_km as string | null),
  }
}

export async function findByVehiculo(vehiculoId: number): Promise<RequerimientoExclusivo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`${SELECT_REQ} WHERE p.vehiculo_id=@vid ORDER BY p.nombre`)
  return r.recordset.map(mapRow)
}

export async function findById(id: number): Promise<RequerimientoExclusivo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_REQ} WHERE p.id=@id`)
  return r.recordset[0] ? mapRow(r.recordset[0]) : null
}

// Se reexporta para no obligar a los servicios a conocer la tabla padre.
export const findCategorias = pendientes.findCategorias

export async function create(data: RequerimientoCreate): Promise<RequerimientoExclusivo> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  let id: number
  try {
    id = await pendientes.insert(tx, {
      vehiculo_id: data.vehiculo_id,
      origen:      'preventivo',
      nombre:      data.nombre,
      descripcion: data.descripcion,
      categoria:   data.categoria,
      status:      data.status,
    })
    await tx.request()
      .input('id',           sql.Int,          id)
      .input('triggerMode',  sql.NVarChar(20), data.trigger_mode)
      .input('intervaloKm',  sql.Int,          data.intervalo_km        ?? null)
      .input('intervaloMes', sql.Int,          data.intervalo_meses     ?? null)
      .input('iniciales',    sql.NVarChar(200), serializeIntervalosIniciales(data.intervalos_iniciales_km))
      .input('fechaInicio',  sql.Date,         data.fecha_inicio        ?? null)
      .input('kmInicio',     sql.Int,          data.km_inicio           ?? null)
      .input('fechaReporte', sql.Date,         data.fecha_reporte       ?? null)
      .input('origenId',     sql.Int,          data.plantilla_origen_id ?? null)
      .query(`
        INSERT INTO requerimientos_exclusivos
          (id, trigger_mode, intervalo_km, intervalo_meses, intervalos_iniciales_km,
           fecha_inicio, km_inicio, fecha_reporte, plantilla_origen_id)
        VALUES (@id, @triggerMode, @intervaloKm, @intervaloMes, @iniciales,
                @fechaInicio, @kmInicio, @fechaReporte, @origenId)
      `)
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return (await findById(id))!
}

export async function update(id: number, data: RequerimientoUpdate): Promise<RequerimientoExclusivo | null> {
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
    if (data.trigger_mode !== undefined) { req.input('triggerMode',  sql.NVarChar(20), data.trigger_mode);            sets.push('trigger_mode=@triggerMode')       }
    if ('intervalo_km'    in data)       { req.input('intervaloKm',  sql.Int,  data.intervalo_km    ?? null);         sets.push('intervalo_km=@intervaloKm')       }
    if ('intervalo_meses' in data)       { req.input('intervaloMes', sql.Int,  data.intervalo_meses ?? null);         sets.push('intervalo_meses=@intervaloMes')   }
    if ('intervalos_iniciales_km' in data) { req.input('iniciales',  sql.NVarChar(200), serializeIntervalosIniciales(data.intervalos_iniciales_km)); sets.push('intervalos_iniciales_km=@iniciales') }
    if ('fecha_inicio'    in data)       { req.input('fechaInicio',  sql.Date, data.fecha_inicio    ?? null);         sets.push('fecha_inicio=@fechaInicio')       }
    if ('km_inicio'       in data)       { req.input('kmInicio',     sql.Int,  data.km_inicio       ?? null);         sets.push('km_inicio=@kmInicio')             }
    if ('fecha_reporte'   in data)       { req.input('fechaReporte', sql.Date, data.fecha_reporte   ?? null);         sets.push('fecha_reporte=@fechaReporte')     }
    if (sets.length) {
      await req.query(`UPDATE requerimientos_exclusivos SET ${sets.join(',')} WHERE id=@id`)
    }

    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return findById(id)
}

// Borra el padre; el hijo se va por ON DELETE CASCADE.
export const remove = pendientes.remove
