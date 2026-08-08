import * as sql from 'mssql'
import { getPool } from '../shared/db'

export type TriggerMode = 'km' | 'meses' | 'ambos'

export interface PlantillaRequerimiento {
  id:              number
  nombre:          string
  descripcion:     string | null
  categoria:       string | null
  intervalo_km:    number | null
  intervalo_meses: number | null
  trigger_mode:    TriggerMode
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
  intervalo_km?:   number | null
  intervalo_meses?: number | null
  activo?:         boolean
}

export interface PlantillaUpdate {
  nombre?:         string
  descripcion?:    string | null
  categoria?:      string | null
  trigger_mode?:   TriggerMode
  intervalo_km?:   number | null
  intervalo_meses?: number | null
  activo?:         boolean
}

const COLS = `id, nombre, descripcion, categoria, intervalo_km, intervalo_meses,
  trigger_mode, activo, created_at, updated_at, modelo_id`

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
    .input('intervaloKm',    sql.Int,           data.intervalo_km       ?? null)
    .input('intervaloMeses', sql.Int,           data.intervalo_meses    ?? null)
    .input('activo',         sql.Bit,           data.activo ?? true)
    .query(`
      INSERT INTO plantilla_requerimientos_modelo
        (modelo_id, nombre, descripcion, categoria, trigger_mode, intervalo_km, intervalo_meses, activo)
      OUTPUT INSERTED.*
      VALUES (@modeloId, @nombre, @descripcion, @categoria, @triggerMode, @intervaloKm, @intervaloMeses, @activo)
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
  if ('intervalo_km'    in data)        { req.input('intervaloKm',    sql.Int,               data.intervalo_km    ?? null); sets.push('intervalo_km=@intervaloKm') }
  if ('intervalo_meses' in data)        { req.input('intervaloMeses', sql.Int,               data.intervalo_meses ?? null); sets.push('intervalo_meses=@intervaloMeses') }
  if (data.activo        !== undefined) { req.input('activo',         sql.Bit,               data.activo);          sets.push('activo=@activo')              }

  const r = await req.query(
    `UPDATE plantilla_requerimientos_modelo SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=@id`
  )
  return r.recordset[0] ?? null
}

// Copia todas las plantillas activas de un modelo a un vehículo recién dado de
// alta. Como cada plantilla produce un requerimiento distinto, hay que saber qué
// pendiente nuevo corresponde a qué plantilla, y un INSERT ... SELECT no puede
// devolver columnas del origen en su OUTPUT: solo ve las de INSERTED. MERGE sí
// puede (`OUTPUT ... src.plantilla_id`), y por eso está aquí con un `ON 1 = 0`
// que nunca empata y convierte cada fila del origen en un INSERT.
export async function copyModelToVehicle(vehiculoId: number, modeloId: number): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('modeloId',   sql.Int, modeloId)
    .query(`
      DECLARE @mapa TABLE (pendiente_id INT, plantilla_id INT);

      MERGE INTO pendientes AS tgt
      USING (
        SELECT p.id AS plantilla_id, p.nombre, p.descripcion, p.categoria
        FROM plantilla_requerimientos_modelo p
        WHERE p.modelo_id = @modeloId
          AND p.activo = 1
          AND NOT EXISTS (
            SELECT 1
            FROM requerimientos_exclusivos re
            JOIN pendientes pe ON pe.id = re.id
            WHERE pe.vehiculo_id = @vehiculoId AND re.plantilla_origen_id = p.id
          )
      ) AS src
      ON 1 = 0
      WHEN NOT MATCHED BY TARGET THEN
        INSERT (vehiculo_id, origen, nombre, descripcion, categoria, status)
        VALUES (@vehiculoId, 'preventivo', src.nombre, src.descripcion, src.categoria, 'activo')
      OUTPUT INSERTED.id, src.plantilla_id INTO @mapa (pendiente_id, plantilla_id);

      INSERT INTO requerimientos_exclusivos
        (id, trigger_mode, intervalo_km, intervalo_meses, plantilla_origen_id)
      SELECT m.pendiente_id, p.trigger_mode, p.intervalo_km, p.intervalo_meses, p.id
      FROM @mapa m
      JOIN plantilla_requerimientos_modelo p ON p.id = m.plantilla_id;
    `)
}

// Copia UNA plantilla nueva a todos los vehículos del modelo. Aquí no hace falta
// MERGE: como el origen es una sola plantilla, todos los hijos comparten los
// mismos intervalos, así que basta con recoger los ids que salgan del INSERT.
export async function copyToVehicles(plantilla: PlantillaRequerimiento): Promise<void> {
  if (!plantilla.activo) return
  const pool = await getPool()
  await pool.request()
    .input('nombre',        sql.NVarChar(120),     plantilla.nombre)
    .input('descripcion',   sql.NVarChar(sql.MAX), plantilla.descripcion ?? null)
    .input('categoria',     sql.NVarChar(80),      plantilla.categoria   ?? null)
    .input('triggerMode',   sql.NVarChar(20),      plantilla.trigger_mode)
    .input('intervaloKm',   sql.Int,               plantilla.intervalo_km    ?? null)
    .input('intervaloMes',  sql.Int,               plantilla.intervalo_meses ?? null)
    .input('plantillaId',   sql.Int,               plantilla.id)
    .input('modeloId',      sql.Int,               plantilla.modelo_id)
    .query(`
      DECLARE @nuevos TABLE (id INT);

      INSERT INTO pendientes (vehiculo_id, origen, nombre, descripcion, categoria, status)
      OUTPUT INSERTED.id INTO @nuevos (id)
      SELECT v.id, 'preventivo', @nombre, @descripcion, @categoria, 'activo'
      FROM vehiculos v
      WHERE v.modelo_id = @modeloId
        AND NOT EXISTS (
          SELECT 1
          FROM requerimientos_exclusivos re
          JOIN pendientes pe ON pe.id = re.id
          WHERE pe.vehiculo_id = v.id AND re.plantilla_origen_id = @plantillaId
        );

      INSERT INTO requerimientos_exclusivos
        (id, trigger_mode, intervalo_km, intervalo_meses, plantilla_origen_id)
      SELECT n.id, @triggerMode, @intervaloKm, @intervaloMes, @plantillaId
      FROM @nuevos n;
    `)
}

export async function syncLinked(plantilla: PlantillaRequerimiento): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('nombre',        sql.NVarChar(120),     plantilla.nombre)
    .input('descripcion',   sql.NVarChar(sql.MAX), plantilla.descripcion ?? null)
    .input('categoria',     sql.NVarChar(80),      plantilla.categoria   ?? null)
    .input('triggerMode',   sql.NVarChar(20),      plantilla.trigger_mode)
    .input('intervaloKm',   sql.Int,               plantilla.intervalo_km    ?? null)
    .input('intervaloMes',  sql.Int,               plantilla.intervalo_meses ?? null)
    .input('plantillaId',   sql.Int,               plantilla.id)
    .query(`
      UPDATE p SET
        p.nombre = @nombre, p.descripcion = @descripcion, p.categoria = @categoria,
        p.updated_at = SYSDATETIME()
      FROM pendientes p
      JOIN requerimientos_exclusivos r ON r.id = p.id
      WHERE r.plantilla_origen_id = @plantillaId;

      UPDATE requerimientos_exclusivos SET
        trigger_mode = @triggerMode,
        intervalo_km = @intervaloKm, intervalo_meses = @intervaloMes
      WHERE plantilla_origen_id = @plantillaId;
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
      DELETE ap FROM agenda_pendientes ap
      JOIN requerimientos_exclusivos re ON re.id = ap.pendiente_id
      WHERE re.plantilla_origen_id = @id
    `)
    await tx.request().input('id', sql.Int, id).query(`
      DELETE mp FROM mantenimiento_pendientes mp
      JOIN requerimientos_exclusivos re ON re.id = mp.pendiente_id
      WHERE re.plantilla_origen_id = @id
    `)
    // Se borra el padre; el hijo se va con él por ON DELETE CASCADE.
    await tx.request().input('id', sql.Int, id).query(`
      DELETE p FROM pendientes p
      JOIN requerimientos_exclusivos re ON re.id = p.id
      WHERE re.plantilla_origen_id = @id
    `)
    const r = await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM plantilla_requerimientos_modelo OUTPUT DELETED.id WHERE id=@id')
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
