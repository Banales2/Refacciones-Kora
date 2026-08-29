// Garantías: el catálogo por modelo, la garantía real de cada unidad y el
// vínculo con los requerimientos preventivos que existen por ellas.
//
// Está calcado de `plantillaRepo`: el catálogo del modelo se copia a cada
// vehículo (`garantia_origen_id`), editarlo sincroniza las copias y borrarlo se
// las lleva. La diferencia es que la copia guarda además cuándo arranca en esa
// unidad —`fecha_inicio` y `km_inicio`—, que es lo único que el modelo no puede
// saber.
//
// El estado (vigente/vencida) no vive aquí: se calcula en `shared/garantias`.
import * as sql from 'mssql'
import { getPool } from '../shared/db'

export type TriggerMode = 'km' | 'meses' | 'ambos'

// ─── Catálogo del modelo ────────────────────────────────────────────────────

export interface GarantiaModelo {
  id:             number
  modelo_id:      number
  nombre:         string
  descripcion:    string | null
  trigger_mode:   TriggerMode
  duracion_meses: number | null
  limite_km:      number | null
  activo:         boolean
  created_at:     string
  updated_at:     string
}

export interface GarantiaModeloCreate {
  modelo_id:       number
  nombre:          string
  descripcion?:    string | null
  trigger_mode:    TriggerMode
  duracion_meses?: number | null
  limite_km?:      number | null
  activo?:         boolean
}

export interface GarantiaModeloUpdate {
  nombre?:         string
  descripcion?:    string | null
  trigger_mode?:   TriggerMode
  duracion_meses?: number | null
  limite_km?:      number | null
  activo?:         boolean
}

const COLS_MODELO = `id, modelo_id, nombre, descripcion, trigger_mode,
  duracion_meses, limite_km, activo, created_at, updated_at`

export async function findByModelo(modeloId: number): Promise<GarantiaModelo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .query(`SELECT ${COLS_MODELO} FROM garantias_modelo WHERE modelo_id=@modeloId ORDER BY nombre`)
  return r.recordset
}

export async function findModeloById(id: number): Promise<GarantiaModelo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS_MODELO} FROM garantias_modelo WHERE id=@id`)
  return r.recordset[0] ?? null
}

export async function createModelo(data: GarantiaModeloCreate): Promise<GarantiaModelo> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId',    sql.Int,               data.modelo_id)
    .input('nombre',      sql.NVarChar(120),     data.nombre)
    .input('descripcion', sql.NVarChar(sql.MAX), data.descripcion    ?? null)
    .input('trigger',     sql.NVarChar(20),      data.trigger_mode)
    .input('meses',       sql.Int,               data.duracion_meses ?? null)
    .input('km',          sql.Int,               data.limite_km      ?? null)
    .input('activo',      sql.Bit,               data.activo ?? true)
    .query(`
      INSERT INTO garantias_modelo
        (modelo_id, nombre, descripcion, trigger_mode, duracion_meses, limite_km, activo)
      OUTPUT INSERTED.*
      VALUES (@modeloId, @nombre, @descripcion, @trigger, @meses, @km, @activo)
    `)
  return r.recordset[0]
}

export async function updateModelo(
  id: number, data: GarantiaModeloUpdate
): Promise<GarantiaModelo | null> {
  const pool = await getPool()
  const sets: string[] = ['updated_at=SYSDATETIME()']
  const req = pool.request().input('id', sql.Int, id)

  if (data.nombre       !== undefined) { req.input('nombre',      sql.NVarChar(120),     data.nombre);              sets.push('nombre=@nombre')           }
  if ('descripcion' in data)           { req.input('descripcion', sql.NVarChar(sql.MAX), data.descripcion ?? null); sets.push('descripcion=@descripcion') }
  if (data.trigger_mode !== undefined) { req.input('trigger',     sql.NVarChar(20),      data.trigger_mode);        sets.push('trigger_mode=@trigger')    }
  if ('duracion_meses' in data)        { req.input('meses',       sql.Int,               data.duracion_meses ?? null); sets.push('duracion_meses=@meses') }
  if ('limite_km'      in data)        { req.input('km',          sql.Int,               data.limite_km      ?? null); sets.push('limite_km=@km')         }
  if (data.activo       !== undefined) { req.input('activo',      sql.Bit,               data.activo);              sets.push('activo=@activo')           }

  const r = await req.query(`UPDATE garantias_modelo SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=@id`)
  return r.recordset[0] ?? null
}

// Borrar una garantía del catálogo se lleva las copias de las unidades, igual
// que borrar un renglón de la plantilla se lleva sus requerimientos. Si lo que
// se quiere es dejar de darla en las unidades nuevas sin tocar las viejas, se
// desactiva (`activo = 0`).
export async function removeModelo(id: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    // Los vínculos son NO ACTION (ver la migración 010): hay que soltarlos a
    // mano o el FK aborta el DELETE.
    await tx.request().input('id', sql.Int, id).query(`
      DELETE rg FROM requerimiento_garantias rg
      JOIN garantias_vehiculo gv ON gv.id = rg.garantia_vehiculo_id
      WHERE gv.garantia_origen_id = @id
    `)
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM plantilla_garantias WHERE garantia_modelo_id=@id')
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM garantias_vehiculo WHERE garantia_origen_id=@id')
    const r = await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM garantias_modelo OUTPUT DELETED.id WHERE id=@id')
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// ─── Copia del catálogo a las unidades ──────────────────────────────────────

// La garantía arranca el día que se compró la unidad. `km_inicio` se deja en
// null a propósito: null se lee como "desde cero", que es lo correcto para una
// unidad nueva, y quien compre una usada corrige el arranque en su ficha.
const SELECT_INICIO = `v.fecha_compra`

/** Todas las garantías activas de un modelo a un vehículo recién dado de alta. */
export async function copyModelToVehicle(vehiculoId: number, modeloId: number): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('modeloId',   sql.Int, modeloId)
    .query(`
      INSERT INTO garantias_vehiculo
        (vehiculo_id, garantia_origen_id, nombre, descripcion, trigger_mode,
         duracion_meses, limite_km, fecha_inicio)
      SELECT v.id, g.id, g.nombre, g.descripcion, g.trigger_mode,
             g.duracion_meses, g.limite_km, ${SELECT_INICIO}
      FROM garantias_modelo g
      CROSS JOIN vehiculos v
      WHERE v.id = @vehiculoId
        AND g.modelo_id = @modeloId
        AND g.activo = 1
        AND NOT EXISTS (
          SELECT 1 FROM garantias_vehiculo gv
          WHERE gv.vehiculo_id = v.id AND gv.garantia_origen_id = g.id
        )
    `)
}

/** Una garantía nueva del catálogo a todas las unidades del modelo. */
export async function copyToVehicles(garantia: GarantiaModelo): Promise<void> {
  if (!garantia.activo) return
  const pool = await getPool()
  await pool.request()
    .input('id',       sql.Int, garantia.id)
    .input('modeloId', sql.Int, garantia.modelo_id)
    .query(`
      INSERT INTO garantias_vehiculo
        (vehiculo_id, garantia_origen_id, nombre, descripcion, trigger_mode,
         duracion_meses, limite_km, fecha_inicio)
      SELECT v.id, g.id, g.nombre, g.descripcion, g.trigger_mode,
             g.duracion_meses, g.limite_km, ${SELECT_INICIO}
      FROM vehiculos v
      CROSS JOIN garantias_modelo g
      WHERE g.id = @id
        AND v.modelo_id = @modeloId
        AND NOT EXISTS (
          SELECT 1 FROM garantias_vehiculo gv
          WHERE gv.vehiculo_id = v.id AND gv.garantia_origen_id = g.id
        )
    `)
}

// Corregir la garantía del catálogo corrige la de todas las unidades. Lo que no
// se toca es el arranque (`fecha_inicio`, `km_inicio`) ni la cancelación: son
// de cada unidad, no del modelo.
export async function syncLinked(garantia: GarantiaModelo): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('id',          sql.Int,               garantia.id)
    .input('nombre',      sql.NVarChar(120),     garantia.nombre)
    .input('descripcion', sql.NVarChar(sql.MAX), garantia.descripcion    ?? null)
    .input('trigger',     sql.NVarChar(20),      garantia.trigger_mode)
    .input('meses',       sql.Int,               garantia.duracion_meses ?? null)
    .input('km',          sql.Int,               garantia.limite_km      ?? null)
    .query(`
      UPDATE garantias_vehiculo SET
        nombre = @nombre, descripcion = @descripcion, trigger_mode = @trigger,
        duracion_meses = @meses, limite_km = @km, updated_at = SYSDATETIME()
      WHERE garantia_origen_id = @id
    `)
}

// ─── Garantías de una unidad ────────────────────────────────────────────────

export interface GarantiaVehiculo {
  id:                 number
  vehiculo_id:        number
  garantia_origen_id: number | null
  nombre:             string
  descripcion:        string | null
  trigger_mode:       TriggerMode
  duracion_meses:     number | null
  limite_km:          number | null
  fecha_inicio:       string | null
  km_inicio:          number | null
  folio:              string | null
  observaciones:      string | null
  cancelada_en:       string | null
  motivo_cancelacion: string | null
  created_at:         string
  updated_at:         string
  /** Odómetro actual de la unidad; null en los tipos que no llevan km. */
  kilometraje:        number | null
  /** Cuántos requerimientos preventivos dependen de esta garantía. */
  requerimientos:     number
}

export interface GarantiaVehiculoCreate {
  vehiculo_id:         number
  garantia_origen_id?: number | null
  nombre:              string
  descripcion?:        string | null
  trigger_mode:        TriggerMode
  duracion_meses?:     number | null
  limite_km?:          number | null
  fecha_inicio?:       string | null
  km_inicio?:          number | null
  folio?:              string | null
  observaciones?:      string | null
}

export interface GarantiaVehiculoUpdate {
  nombre?:             string
  descripcion?:        string | null
  trigger_mode?:       TriggerMode
  duracion_meses?:     number | null
  limite_km?:          number | null
  fecha_inicio?:       string | null
  km_inicio?:          number | null
  folio?:              string | null
  observaciones?:      string | null
  cancelada_en?:       string | null
  motivo_cancelacion?: string | null
}

// El odómetro vive en la tabla de cada tipo (no todos llevan), así que la
// garantía lo trae ya resuelto: sin él no se puede saber si venció por km.
const SELECT_GARANTIA = `
  SELECT g.id, g.vehiculo_id, g.garantia_origen_id, g.nombre, g.descripcion,
         g.trigger_mode, g.duracion_meses, g.limite_km,
         CONVERT(char(10), g.fecha_inicio, 23) AS fecha_inicio, g.km_inicio,
         g.folio, g.observaciones,
         CONVERT(char(10), g.cancelada_en, 23) AS cancelada_en, g.motivo_cancelacion,
         g.created_at, g.updated_at,
         CASE WHEN v.tipo='camion'       THEN c.kilometraje
              WHEN v.tipo='tractocamion' THEN t.kilometraje
              WHEN v.tipo='utilitario'   THEN u.kilometraje
              ELSE NULL END AS kilometraje,
         (SELECT COUNT(*) FROM requerimiento_garantias rg
          WHERE rg.garantia_vehiculo_id = g.id) AS requerimientos
  FROM garantias_vehiculo g
  JOIN vehiculos v ON v.id = g.vehiculo_id
  LEFT JOIN camiones              c ON c.vehiculo_id = v.id
  LEFT JOIN tractocamiones        t ON t.vehiculo_id = v.id
  LEFT JOIN vehiculos_utilitarios u ON u.vehiculo_id = v.id`

export async function findByVehiculo(vehiculoId: number): Promise<GarantiaVehiculo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`${SELECT_GARANTIA} WHERE g.vehiculo_id=@vid ORDER BY g.nombre`)
  return r.recordset
}

export async function findVehiculoGarantiaById(id: number): Promise<GarantiaVehiculo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_GARANTIA} WHERE g.id=@id`)
  return r.recordset[0] ?? null
}

export async function createVehiculo(data: GarantiaVehiculoCreate): Promise<GarantiaVehiculo> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid',           sql.Int,               data.vehiculo_id)
    .input('origen',        sql.Int,               data.garantia_origen_id ?? null)
    .input('nombre',        sql.NVarChar(120),     data.nombre)
    .input('descripcion',   sql.NVarChar(sql.MAX), data.descripcion    ?? null)
    .input('trigger',       sql.NVarChar(20),      data.trigger_mode)
    .input('meses',         sql.Int,               data.duracion_meses ?? null)
    .input('km',            sql.Int,               data.limite_km      ?? null)
    .input('fechaInicio',   sql.Date,              data.fecha_inicio   ?? null)
    .input('kmInicio',      sql.Int,               data.km_inicio      ?? null)
    .input('folio',         sql.NVarChar(60),      data.folio          ?? null)
    .input('observaciones', sql.NVarChar(255),     data.observaciones  ?? null)
    .query(`
      INSERT INTO garantias_vehiculo
        (vehiculo_id, garantia_origen_id, nombre, descripcion, trigger_mode,
         duracion_meses, limite_km, fecha_inicio, km_inicio, folio, observaciones)
      OUTPUT INSERTED.id
      VALUES (@vid, @origen, @nombre, @descripcion, @trigger,
              @meses, @km, @fechaInicio, @kmInicio, @folio, @observaciones)
    `)
  return (await findVehiculoGarantiaById(r.recordset[0].id))!
}

export async function updateVehiculo(
  id: number, data: GarantiaVehiculoUpdate
): Promise<GarantiaVehiculo | null> {
  const pool = await getPool()
  const sets: string[] = ['updated_at=SYSDATETIME()']
  const req = pool.request().input('id', sql.Int, id)

  if (data.nombre       !== undefined) { req.input('nombre',      sql.NVarChar(120),     data.nombre);              sets.push('nombre=@nombre')           }
  if ('descripcion' in data)           { req.input('descripcion', sql.NVarChar(sql.MAX), data.descripcion ?? null); sets.push('descripcion=@descripcion') }
  if (data.trigger_mode !== undefined) { req.input('trigger',     sql.NVarChar(20),      data.trigger_mode);        sets.push('trigger_mode=@trigger')    }
  if ('duracion_meses' in data)        { req.input('meses',       sql.Int,   data.duracion_meses ?? null); sets.push('duracion_meses=@meses')     }
  if ('limite_km'      in data)        { req.input('km',          sql.Int,   data.limite_km      ?? null); sets.push('limite_km=@km')             }
  if ('fecha_inicio'   in data)        { req.input('fechaInicio', sql.Date,  data.fecha_inicio   ?? null); sets.push('fecha_inicio=@fechaInicio') }
  if ('km_inicio'      in data)        { req.input('kmInicio',    sql.Int,   data.km_inicio      ?? null); sets.push('km_inicio=@kmInicio')       }
  if ('folio'          in data)        { req.input('folio',       sql.NVarChar(60),  data.folio         ?? null); sets.push('folio=@folio')                 }
  if ('observaciones'  in data)        { req.input('observaciones', sql.NVarChar(255), data.observaciones ?? null); sets.push('observaciones=@observaciones') }
  if ('cancelada_en'   in data)        { req.input('cancelada',   sql.Date,  data.cancelada_en ?? null); sets.push('cancelada_en=@cancelada')     }
  if ('motivo_cancelacion' in data)    { req.input('motivo',      sql.NVarChar(255), data.motivo_cancelacion ?? null); sets.push('motivo_cancelacion=@motivo') }

  const r = await req.query(
    `UPDATE garantias_vehiculo SET ${sets.join(',')} OUTPUT INSERTED.id WHERE id=@id`
  )
  if (!r.recordset.length) return null
  return findVehiculoGarantiaById(id)
}

export async function removeVehiculo(id: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM requerimiento_garantias WHERE garantia_vehiculo_id=@id')
    const r = await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM garantias_vehiculo OUTPUT DELETED.id WHERE id=@id')
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// ─── Vínculo con los requerimientos ─────────────────────────────────────────

/** Ids de las garantías que sostienen a cada requerimiento de un vehículo. */
export async function findVinculosPorVehiculo(
  vehiculoId: number
): Promise<{ requerimiento_id: number; garantia_vehiculo_id: number }[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`
      SELECT rg.requerimiento_id, rg.garantia_vehiculo_id
      FROM requerimiento_garantias rg
      JOIN pendientes p ON p.id = rg.requerimiento_id
      WHERE p.vehiculo_id = @vid
    `)
  return r.recordset
}

/** La garantía y su vigencia, para cada requerimiento de toda la flota. */
export interface VinculoFleet {
  requerimiento_id:   number
  garantia_id:        number
  nombre:             string
  trigger_mode:       TriggerMode
  duracion_meses:     number | null
  limite_km:          number | null
  fecha_inicio:       string | null
  km_inicio:          number | null
  cancelada_en:       string | null
  kilometraje:        number | null
}

// Una sola consulta para todo el tablero: preguntar garantía por garantía
// dentro del bucle de requerimientos multiplicaría los viajes a la base.
export async function findVinculosFleet(): Promise<VinculoFleet[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT rg.requerimiento_id, g.id AS garantia_id, g.nombre, g.trigger_mode,
           g.duracion_meses, g.limite_km,
           CONVERT(char(10), g.fecha_inicio, 23) AS fecha_inicio, g.km_inicio,
           CONVERT(char(10), g.cancelada_en, 23) AS cancelada_en,
           CASE WHEN v.tipo='camion'       THEN c.kilometraje
                WHEN v.tipo='tractocamion' THEN t.kilometraje
                WHEN v.tipo='utilitario'   THEN u.kilometraje
                ELSE NULL END AS kilometraje
    FROM requerimiento_garantias rg
    JOIN garantias_vehiculo g ON g.id = rg.garantia_vehiculo_id
    JOIN vehiculos v ON v.id = g.vehiculo_id
    LEFT JOIN camiones              c ON c.vehiculo_id = v.id
    LEFT JOIN tractocamiones        t ON t.vehiculo_id = v.id
    LEFT JOIN vehiculos_utilitarios u ON u.vehiculo_id = v.id
  `)
  return r.recordset
}

/** Deja el requerimiento atado exactamente a esas garantías, ni una más. */
export async function setVinculosRequerimiento(
  requerimientoId: number, garantiaIds: number[]
): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('id', sql.Int, requerimientoId)
      .query('DELETE FROM requerimiento_garantias WHERE requerimiento_id=@id')
    for (const gid of garantiaIds) {
      await tx.request()
        .input('id',  sql.Int, requerimientoId)
        .input('gid', sql.Int, gid)
        .query(`
          INSERT INTO requerimiento_garantias (requerimiento_id, garantia_vehiculo_id)
          VALUES (@id, @gid)
        `)
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/** Que las garantías indicadas sean todas de ese vehículo. */
export async function contarGarantiasDeVehiculo(
  vehiculoId: number, ids: number[]
): Promise<number> {
  if (!ids.length) return 0
  const pool = await getPool()
  const req = pool.request().input('vid', sql.Int, vehiculoId)
  const params = ids.map((id, i) => { req.input(`g${i}`, sql.Int, id); return `@g${i}` })
  const r = await req.query(`
    SELECT COUNT(*) AS n FROM garantias_vehiculo
    WHERE vehiculo_id=@vid AND id IN (${params.join(',')})
  `)
  return r.recordset[0].n
}

// ─── Vínculo a nivel plantilla ──────────────────────────────────────────────

export async function findGarantiasDePlantilla(plantillaId: number): Promise<number[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, plantillaId)
    .query('SELECT garantia_modelo_id FROM plantilla_garantias WHERE plantilla_id=@id')
  return r.recordset.map((x) => x.garantia_modelo_id)
}

/** Los vínculos de todas las plantillas de un modelo, para pintarlos de un jalón. */
export async function findGarantiasDePlantillasDeModelo(
  modeloId: number
): Promise<{ plantilla_id: number; garantia_modelo_id: number }[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .query(`
      SELECT pg.plantilla_id, pg.garantia_modelo_id
      FROM plantilla_garantias pg
      JOIN plantilla_requerimientos_modelo p ON p.id = pg.plantilla_id
      WHERE p.modelo_id = @modeloId
    `)
  return r.recordset
}

export async function setGarantiasDePlantilla(
  plantillaId: number, garantiaModeloIds: number[]
): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('id', sql.Int, plantillaId)
      .query('DELETE FROM plantilla_garantias WHERE plantilla_id=@id')
    for (const gid of garantiaModeloIds) {
      await tx.request()
        .input('id',  sql.Int, plantillaId)
        .input('gid', sql.Int, gid)
        .query(`
          INSERT INTO plantilla_garantias (plantilla_id, garantia_modelo_id)
          VALUES (@id, @gid)
        `)
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/** Que las garantías indicadas sean todas del mismo modelo que la plantilla. */
export async function contarGarantiasDeModelo(modeloId: number, ids: number[]): Promise<number> {
  if (!ids.length) return 0
  const pool = await getPool()
  const req = pool.request().input('modeloId', sql.Int, modeloId)
  const params = ids.map((id, i) => { req.input(`g${i}`, sql.Int, id); return `@g${i}` })
  const r = await req.query(`
    SELECT COUNT(*) AS n FROM garantias_modelo
    WHERE modelo_id=@modeloId AND id IN (${params.join(',')})
  `)
  return r.recordset[0].n
}

// Baja los vínculos del catálogo a las unidades: por cada plantilla que dice
// "este servicio existe por esta garantía", ata el requerimiento copiado a la
// garantía copiada del mismo vehículo. Es idempotente y se llama en los cuatro
// momentos en que el mapa puede cambiar: alta de vehículo, alta de plantilla,
// alta de garantía del modelo y edición de los vínculos de una plantilla.
//
// Los filtros son opcionales y se combinan: sin ninguno recorre toda la flota.
export async function sincronizarVinculosDesdePlantilla(filtros: {
  vehiculoId?:        number
  plantillaId?:       number
  garantiaModeloId?:  number
} = {}): Promise<void> {
  const pool = await getPool()
  const req = pool.request()
    .input('vehiculoId', sql.Int, filtros.vehiculoId       ?? null)
    .input('plantillaId', sql.Int, filtros.plantillaId     ?? null)
    .input('garantiaId', sql.Int, filtros.garantiaModeloId ?? null)

  await req.query(`
    INSERT INTO requerimiento_garantias (requerimiento_id, garantia_vehiculo_id)
    SELECT re.id, gv.id
    FROM plantilla_garantias pg
    JOIN requerimientos_exclusivos re ON re.plantilla_origen_id = pg.plantilla_id
    JOIN pendientes p                 ON p.id = re.id
    JOIN garantias_vehiculo gv        ON gv.vehiculo_id = p.vehiculo_id
                                     AND gv.garantia_origen_id = pg.garantia_modelo_id
    WHERE (@vehiculoId  IS NULL OR p.vehiculo_id = @vehiculoId)
      AND (@plantillaId IS NULL OR pg.plantilla_id = @plantillaId)
      AND (@garantiaId  IS NULL OR pg.garantia_modelo_id = @garantiaId)
      AND NOT EXISTS (
        SELECT 1 FROM requerimiento_garantias rg
        WHERE rg.requerimiento_id = re.id AND rg.garantia_vehiculo_id = gv.id
      )
  `)
}

// El reverso: quitar un vínculo en la plantilla lo quita en las unidades. Solo
// toca los que vienen del catálogo (la garantía tiene `garantia_origen_id`);
// lo que alguien ató a mano en una unidad se queda.
export async function limpiarVinculosHuerfanos(plantillaId: number): Promise<void> {
  const pool = await getPool()
  await pool.request().input('id', sql.Int, plantillaId).query(`
    DELETE rg
    FROM requerimiento_garantias rg
    JOIN requerimientos_exclusivos re ON re.id = rg.requerimiento_id
    JOIN garantias_vehiculo gv        ON gv.id = rg.garantia_vehiculo_id
    WHERE re.plantilla_origen_id = @id
      AND gv.garantia_origen_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM plantilla_garantias pg
        WHERE pg.plantilla_id = re.plantilla_origen_id
          AND pg.garantia_modelo_id = gv.garantia_origen_id
      )
  `)
}
