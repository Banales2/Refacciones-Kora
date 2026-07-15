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
      OUTPUT INSERTED.*
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
    `UPDATE plantilla_requerimientos_modelo SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=@id`
  )
  return r.recordset[0] ?? null
}

export async function copyModelToVehicle(vehiculoId: number, modeloId: number): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('modeloId',   sql.Int, modeloId)
    .query(`
      INSERT INTO requerimientos_exclusivos
        (vehiculo_id, nombre, descripcion, categoria, trigger_mode, tipo,
         intervalo_km, intervalo_meses, status, plantilla_origen_id)
      SELECT
        @vehiculoId, p.nombre, p.descripcion, p.categoria, p.trigger_mode, p.tipo,
        p.intervalo_km, p.intervalo_meses, 'activo', p.id
      FROM plantilla_requerimientos_modelo p
      WHERE p.modelo_id = @modeloId
        AND p.activo = 1
        AND NOT EXISTS (
          SELECT 1 FROM requerimientos_exclusivos re
          WHERE re.vehiculo_id = @vehiculoId AND re.plantilla_origen_id = p.id
        )
    `)
}

export async function copyToVehicles(plantilla: PlantillaRequerimiento): Promise<void> {
  if (!plantilla.activo) return
  const pool = await getPool()
  await pool.request()
    .input('nombre',        sql.NVarChar(120),     plantilla.nombre)
    .input('descripcion',   sql.NVarChar(sql.MAX), plantilla.descripcion ?? null)
    .input('categoria',     sql.NVarChar(80),      plantilla.categoria   ?? null)
    .input('triggerMode',   sql.NVarChar(20),      plantilla.trigger_mode)
    .input('tipo',          sql.NVarChar(20),      plantilla.tipo)
    .input('intervaloKm',   sql.Int,               plantilla.intervalo_km    ?? null)
    .input('intervaloMes',  sql.Int,               plantilla.intervalo_meses ?? null)
    .input('plantillaId',   sql.Int,               plantilla.id)
    .input('modeloId',      sql.Int,               plantilla.modelo_id)
    .query(`
      INSERT INTO requerimientos_exclusivos
        (vehiculo_id, nombre, descripcion, categoria, trigger_mode, tipo,
         intervalo_km, intervalo_meses, status, plantilla_origen_id)
      SELECT
        v.id, @nombre, @descripcion, @categoria, @triggerMode, @tipo,
        @intervaloKm, @intervaloMes, 'activo', @plantillaId
      FROM vehiculos v
      WHERE v.modelo_id = @modeloId
        AND NOT EXISTS (
          SELECT 1 FROM requerimientos_exclusivos re
          WHERE re.vehiculo_id = v.id AND re.plantilla_origen_id = @plantillaId
        )
    `)
}

export async function syncLinked(plantilla: PlantillaRequerimiento): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('nombre',        sql.NVarChar(120),     plantilla.nombre)
    .input('descripcion',   sql.NVarChar(sql.MAX), plantilla.descripcion ?? null)
    .input('categoria',     sql.NVarChar(80),      plantilla.categoria   ?? null)
    .input('triggerMode',   sql.NVarChar(20),      plantilla.trigger_mode)
    .input('tipo',          sql.NVarChar(20),      plantilla.tipo)
    .input('intervaloKm',   sql.Int,               plantilla.intervalo_km    ?? null)
    .input('intervaloMes',  sql.Int,               plantilla.intervalo_meses ?? null)
    .input('plantillaId',   sql.Int,               plantilla.id)
    .query(`
      UPDATE requerimientos_exclusivos SET
        nombre=@nombre, descripcion=@descripcion, categoria=@categoria,
        trigger_mode=@triggerMode, tipo=@tipo,
        intervalo_km=@intervaloKm, intervalo_meses=@intervaloMes,
        updated_at=SYSDATETIME()
      WHERE plantilla_origen_id=@plantillaId
    `)
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    // Los requerimientos copiados a los vehículos pueden estar vinculados a
    // agendas o mantenimientos; hay que soltar esos vínculos antes de borrarlos
    // o el FK aborta el DELETE (500). Se borra solo el vínculo, no el
    // mantenimiento/agenda en sí.
    await tx.request().input('id', sql.Int, id).query(`
      DELETE ar FROM agenda_requerimientos ar
      JOIN requerimientos_exclusivos re ON re.id = ar.requerimiento_id
      WHERE re.plantilla_origen_id = @id
    `)
    await tx.request().input('id', sql.Int, id).query(`
      DELETE mr FROM mantenimiento_requerimientos mr
      JOIN requerimientos_exclusivos re ON re.id = mr.requerimiento_id
      WHERE re.plantilla_origen_id = @id
    `)
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM requerimientos_exclusivos WHERE plantilla_origen_id=@id')
    const r = await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM plantilla_requerimientos_modelo OUTPUT DELETED.id WHERE id=@id')
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
