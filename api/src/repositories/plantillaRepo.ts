import * as sql from 'mssql'
import { getPool } from '../shared/db'

export type TriggerMode = 'km' | 'meses' | 'ambos'
export type TipoPlantilla = 'recurrente' | 'unica'

export interface PlantillaRequerimiento {
  id:              number
  nombre:          string
  descripcion:     string | null
  categoria:       string | null
  intervalo_km:    number | null
  intervalo_meses: number | null
  trigger_mode:    TriggerMode
  tipo:            TipoPlantilla
  activo:          boolean
  created_at:      string
  updated_at:      string
  modelo_id:       number
}

export interface PlantillaCreate {
  modelo_id:       number
  nombre:          string
  descripcion?:    string | null
  categoria?:      string | null
  trigger_mode:    TriggerMode
  tipo?:           TipoPlantilla
  intervalo_km?:   number | null
  intervalo_meses?: number | null
  activo?:         boolean
}

export interface PlantillaUpdate {
  nombre?:         string
  descripcion?:    string | null
  categoria?:      string | null
  trigger_mode?:   TriggerMode
  tipo?:           TipoPlantilla
  intervalo_km?:   number | null
  intervalo_meses?: number | null
  activo?:         boolean
}

const COLS = `id, nombre, descripcion, categoria, intervalo_km, intervalo_meses,
  trigger_mode, tipo, activo, created_at, updated_at, modelo_id`

export async function findByModelo(modeloId: number): Promise<PlantillaRequerimiento[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .query(`SELECT ${COLS} FROM plantilla_requerimientos_modelo WHERE modelo_id=@modeloId ORDER BY nombre`)
  return r.recordset
}

export async function findById(id: number): Promise<PlantillaRequerimiento | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM plantilla_requerimientos_modelo WHERE id=@id`)
  return r.recordset[0] ?? null
}

export async function create(data: PlantillaCreate): Promise<PlantillaRequerimiento> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId',       sql.Int,          data.modelo_id)
    .input('nombre',         sql.NVarChar(120), data.nombre)
    .input('descripcion',    sql.NVarChar(sql.MAX), data.descripcion    ?? null)
    .input('categoria',      sql.NVarChar(80),  data.categoria          ?? null)
    .input('triggerMode',    sql.NVarChar(20),  data.trigger_mode)
    .input('tipo',           sql.NVarChar(20),  data.tipo ?? 'recurrente')
    .input('intervaloKm',    sql.Int,           data.intervalo_km       ?? null)
    .input('intervaloMeses', sql.Int,           data.intervalo_meses    ?? null)
    .input('activo',         sql.Bit,           data.activo ?? true)
    .query(`
      INSERT INTO plantilla_requerimientos_modelo
        (modelo_id, nombre, descripcion, categoria, trigger_mode, tipo, intervalo_km, intervalo_meses, activo)
      OUTPUT INSERTED.${COLS}
      VALUES (@modeloId, @nombre, @descripcion, @categoria, @triggerMode, @tipo, @intervaloKm, @intervaloMeses, @activo)
    `)
  return r.recordset[0]
}

export async function update(id: number, data: PlantillaUpdate): Promise<PlantillaRequerimiento | null> {
  const pool = await getPool()
  const sets: string[] = ['updated_at=SYSDATETIME()']
  const req = pool.request().input('id', sql.Int, id)

  if (data.nombre        !== undefined) { req.input('nombre',         sql.NVarChar(120),     data.nombre);          sets.push('nombre=@nombre')              }
  if ('descripcion' in data)            { req.input('descripcion',    sql.NVarChar(sql.MAX), data.descripcion ?? null); sets.push('descripcion=@descripcion') }
  if ('categoria'   in data)            { req.input('categoria',      sql.NVarChar(80),      data.categoria   ?? null); sets.push('categoria=@categoria')     }
  if (data.trigger_mode  !== undefined) { req.input('triggerMode',    sql.NVarChar(20),      data.trigger_mode);     sets.push('trigger_mode=@triggerMode')   }
  if (data.tipo          !== undefined) { req.input('tipo',           sql.NVarChar(20),      data.tipo);             sets.push('tipo=@tipo')                  }
  if ('intervalo_km'    in data)        { req.input('intervaloKm',    sql.Int,               data.intervalo_km    ?? null); sets.push('intervalo_km=@intervaloKm') }
  if ('intervalo_meses' in data)        { req.input('intervaloMeses', sql.Int,               data.intervalo_meses ?? null); sets.push('intervalo_meses=@intervaloMeses') }
  if (data.activo        !== undefined) { req.input('activo',         sql.Bit,               data.activo);          sets.push('activo=@activo')              }

  const r = await req.query(
    `UPDATE plantilla_requerimientos_modelo SET ${sets.join(',')} OUTPUT INSERTED.${COLS} WHERE id=@id`
  )
  return r.recordset[0] ?? null
}

export async function countExclusivos(id: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS cnt FROM requerimientos_exclusivos WHERE plantilla_origen_id=@id')
  return r.recordset[0].cnt
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM plantilla_requerimientos_modelo OUTPUT DELETED.id WHERE id=@id')
  return r.recordset.length > 0
}
