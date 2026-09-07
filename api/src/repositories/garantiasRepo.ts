// Garantías: el catálogo por modelo y la garantía real de cada unidad.
//
// El catálogo del modelo se copia a cada vehículo (`garantia_origen_id`),
// editarlo sincroniza las copias y borrarlo se las lleva. La copia guarda
// además cuándo arranca en esa unidad —`fecha_inicio` y `km_inicio`—, que es lo
// único que el modelo no puede saber.
//
// La garantía marcada como `principal` en el catálogo es la que decide qué
// programa de mantenimiento sigue la unidad: mientras siga viva se sigue el del
// fabricante, y al vencer se pasa al de después de la garantía (migración 016).
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
  /**
   * La que gobierna el programa de mantenimiento de la unidad: mientras siga
   * viva se sigue el del fabricante, y al vencer se pasa al de después de la
   * garantía. Una por modelo (migración 016); ninguna deja a las unidades en el
   * programa del fabricante para siempre, que es lo conservador.
   */
  principal:      boolean
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
  principal?:      boolean
}

export interface GarantiaModeloUpdate {
  nombre?:         string
  descripcion?:    string | null
  trigger_mode?:   TriggerMode
  duracion_meses?: number | null
  limite_km?:      number | null
  activo?:         boolean
  principal?:      boolean
}

const COLS_MODELO = `id, modelo_id, nombre, descripcion, trigger_mode,
  duracion_meses, limite_km, activo, principal, created_at, updated_at`

function mapModelo(row: Record<string, unknown>): GarantiaModelo {
  return {
    ...(row as unknown as GarantiaModelo),
    activo: !!row.activo, principal: !!row.principal,
  }
}

export async function findByModelo(modeloId: number): Promise<GarantiaModelo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .query(`SELECT ${COLS_MODELO} FROM garantias_modelo WHERE modelo_id=@modeloId ORDER BY nombre`)
  return r.recordset.map(mapModelo)
}

export async function findModeloById(id: number): Promise<GarantiaModelo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS_MODELO} FROM garantias_modelo WHERE id=@id`)
  return r.recordset[0] ? mapModelo(r.recordset[0]) : null
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
    .input('principal',   sql.Bit,               data.principal ?? false)
    .query(`
      INSERT INTO garantias_modelo
        (modelo_id, nombre, descripcion, trigger_mode, duracion_meses, limite_km,
         activo, principal)
      OUTPUT INSERTED.*
      VALUES (@modeloId, @nombre, @descripcion, @trigger, @meses, @km, @activo, @principal)
    `)
  return mapModelo(r.recordset[0])
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
  if (data.principal    !== undefined) { req.input('principal',   sql.Bit,               data.principal);           sets.push('principal=@principal')      }

  const r = await req.query(`UPDATE garantias_modelo SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=@id`)
  return r.recordset[0] ? mapModelo(r.recordset[0]) : null
}

/**
 * Deja como principal solo a esta garantía del modelo. El índice único es
 * filtrado (migración 016), así que hay que apagar la anterior antes de
 * encender la nueva o el UPDATE choca a medio camino.
 */
export async function setPrincipal(modeloId: number, garantiaId: number | null): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('mid', sql.Int, modeloId)
      .query('UPDATE garantias_modelo SET principal=0, updated_at=SYSDATETIME() WHERE modelo_id=@mid AND principal=1')
    if (garantiaId != null) {
      await tx.request().input('id', sql.Int, garantiaId).input('mid', sql.Int, modeloId)
        .query('UPDATE garantias_modelo SET principal=1, updated_at=SYSDATETIME() WHERE id=@id AND modelo_id=@mid')
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// Borrar una garantía del catálogo se lleva las copias de las unidades. Si lo
// que se quiere es dejar de darla en las unidades nuevas sin tocar las viejas,
// se desactiva (`activo = 0`).
export async function removeModelo(id: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
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
              ELSE NULL END AS kilometraje
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

// Sin vínculos que soltar: la garantía de una unidad ya no cuelga de nada más.
export async function removeVehiculo(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request().input('id', sql.Int, id)
    .query('DELETE FROM garantias_vehiculo OUTPUT DELETED.id WHERE id=@id')
  return r.recordset.length > 0
}

// ─── La garantía que gobierna el programa ───────────────────────────────────

/**
 * Lo mínimo para saber si a una unidad se le acabó la garantía principal de su
 * modelo: la copia que esa unidad tiene de ella. Sin garantía principal
 * declarada —o sin copia en la unidad— no hay nada que vencer, y el programa de
 * mantenimiento se queda en el del fabricante.
 *
 * Vive aquí y no en el repo del programa porque es una consulta de garantías;
 * quien decide qué hacer con ella es `programaVehiculoService`.
 */
export interface GarantiaPrincipal {
  vehiculo_id:    number
  garantia_id:    number
  nombre:         string
  trigger_mode:   TriggerMode
  duracion_meses: number | null
  limite_km:      number | null
  fecha_inicio:   string | null
  km_inicio:      number | null
  cancelada_en:   string | null
}

const SELECT_PRINCIPAL = `
  SELECT gv.vehiculo_id, gv.id AS garantia_id, gv.nombre, gv.trigger_mode,
         gv.duracion_meses, gv.limite_km,
         CONVERT(char(10), gv.fecha_inicio, 23) AS fecha_inicio, gv.km_inicio,
         CONVERT(char(10), gv.cancelada_en, 23) AS cancelada_en
  FROM garantias_vehiculo gv
  JOIN garantias_modelo gm ON gm.id = gv.garantia_origen_id AND gm.principal = 1`

export async function findPrincipalDeVehiculo(
  vehiculoId: number,
): Promise<GarantiaPrincipal | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`${SELECT_PRINCIPAL} WHERE gv.vehiculo_id = @vid`)
  return r.recordset[0] ?? null
}

/** Las de varias unidades de un jalón, para el tablero. */
export async function findPrincipalesDeVehiculos(
  ids: number[],
): Promise<Map<number, GarantiaPrincipal>> {
  const salida = new Map<number, GarantiaPrincipal>()
  if (!ids.length) return salida
  const pool = await getPool()
  const req = pool.request()
  const params = ids.map((id, i) => { req.input(`v${i}`, sql.Int, id); return `@v${i}` })
  const r = await req.query(`${SELECT_PRINCIPAL} WHERE gv.vehiculo_id IN (${params.join(',')})`)
  for (const row of r.recordset) salida.set(row.vehiculo_id, row)
  return salida
}
