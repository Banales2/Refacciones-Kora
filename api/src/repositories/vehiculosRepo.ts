import * as sql from 'mssql'
import { getPool } from '../shared/db'
import {
  AlertaVehiculo, TipoVehiculo, VehiculoCreate, VehiculoUpdate,
  TIPOS_CON_SEGURO, TIPOS_CON_PERMISO,
} from '../schemas/vehiculoSchema'
import {
  JOINS_HIJAS, NO_DADO_DE_BAJA, PERMISO_ID_SQL, SEGURO_ID_SQL, SIN_SEGURO, SIN_TENENCIA,
} from './vehiculosSql'

export interface VehiculoRow {
  id:           number
  tipo:         TipoVehiculo
  modelo_id:    number
  marca:        string
  modelo:       string
  serie:        string
  placas:       string | null
  status:       string | null
  kilometraje:  number | null
  combustible:  string | null
  ubicacion:    string | null
  sucursal_id:  number | null
  sucursal:     string | null
  tonelaje:     number | null
  // Tenencia: la pagan reparto y utilitarios. Tractocamiones, cajas de trailer y
  // montacargas no, por eso vive en las dos tablas hijas y no en `vehiculos`.
  // Solo la fecha de vencimiento: la tenencia no trae folio.
  tenencia_expiracion: string | null
  ruta_id:      number | null
  ruta:         string | null
  pies:         number | null
  fecha_compra: string | null
  // Seguro y permiso también viven en las hijas: las cajas de trailer no se
  // aseguran, y el permiso de circulación solo lo llevan reparto y utilitarios.
  seguro_id:        number | null
  seguro_poliza:    string | null
  seguro_compania:  string | null
  seguro_expiracion: string | null
  permiso_id:        number | null
  permiso_zona:      string | null
  permiso_expiracion: string | null
  modelo_anio:       string | null
  // Documentos que le faltan a esta unidad, ya resueltos por la API: qué tipos
  // llevan cada documento y qué cuenta como faltante se decide en un solo
  // lugar, y las pantallas solo pintan lo que llega.
  alertas:           AlertaDocumento[]
}

// Subconjunto de AlertaVehiculo que se puede resolver por vehículo con lo que
// ya trae la consulta. Los requerimientos vencidos no entran: dependen del
// kilometraje contra el último mantenimiento y los clasifica el tablero.
export type AlertaDocumento = Extract<AlertaVehiculo, 'sin_seguro' | 'sin_tenencia'>

// La consulta devuelve un bit por aviso; hacia afuera se expone la lista, que
// es lo que las pantallas necesitan para pintar sus badges.
interface VehiculoRowSql extends Omit<VehiculoRow, 'alertas'> {
  alerta_sin_seguro:   boolean
  alerta_sin_tenencia: boolean
}

function conAlertas(row: VehiculoRowSql): VehiculoRow {
  const { alerta_sin_seguro, alerta_sin_tenencia, ...resto } = row
  const alertas: AlertaDocumento[] = []
  if (alerta_sin_seguro)   alertas.push('sin_seguro')
  if (alerta_sin_tenencia) alertas.push('sin_tenencia')
  return { ...resto, alertas }
}

// ── Shared SQL fragments ──────────────────────────────────────────────────────

const SELECT_COLS = `
  v.id, v.tipo, v.modelo_id, v.fecha_compra,
  v.numero_serie AS serie, v.placas,
  m.marca, m.nombre AS modelo,
  CASE WHEN v.tipo='camion'       THEN c.status       WHEN v.tipo='tractocamion' THEN t.status
       WHEN v.tipo='caja_trailer' THEN ct.status      WHEN v.tipo='utilitario'   THEN u.status
       WHEN v.tipo='montacargas'  THEN mc.status      END AS status,
  CASE WHEN v.tipo='camion'       THEN c.kilometraje   WHEN v.tipo='tractocamion' THEN t.kilometraje
       WHEN v.tipo='utilitario'   THEN u.kilometraje   ELSE NULL END AS kilometraje,
  CASE WHEN v.tipo='camion'       THEN c.combustible   WHEN v.tipo='tractocamion' THEN t.combustible
       WHEN v.tipo='utilitario'   THEN u.combustible   WHEN v.tipo='montacargas'  THEN mc.combustible
       ELSE NULL END AS combustible,
  CASE WHEN v.tipo='camion'       THEN c.ubicacion     WHEN v.tipo='utilitario'   THEN u.ubicacion
       WHEN v.tipo='montacargas'  THEN mc.ubicacion    ELSE NULL END AS ubicacion,
  COALESCE(c.sucursal_id, mc.sucursal_id) AS sucursal_id, s.nombre AS sucursal,
  t.tonelaje,
  CONVERT(char(10),
    CASE WHEN v.tipo='camion'     THEN c.tenencia_expiracion
         WHEN v.tipo='utilitario' THEN u.tenencia_expiracion END, 23) AS tenencia_expiracion,
  COALESCE(t.ruta_id, ct.ruta_id) AS ruta_id, r.nombre AS ruta,
  ct.pies,
  ${SEGURO_ID_SQL} AS seguro_id, seg.poliza AS seguro_poliza, seg.compania AS seguro_compania,
  CONVERT(char(10), seg.fecha_expiracion, 23) AS seguro_expiracion,
  ${PERMISO_ID_SQL} AS permiso_id, per.zona_circulacion AS permiso_zona,
  CONVERT(char(10), per.fecha_expiracion, 23) AS permiso_expiracion,
  m.anio AS modelo_anio,
  -- Avisos resueltos aquí, con los mismos fragmentos que usa el filtro
  -- ?alerta=: antes cada pantalla los recalculaba por su cuenta y se le
  -- olvidaba alguna condición (las cajas seguían saliendo "sin seguro").
  CAST(CASE WHEN ${NO_DADO_DE_BAJA} AND ${SIN_SEGURO}   THEN 1 ELSE 0 END AS bit) AS alerta_sin_seguro,
  CAST(CASE WHEN ${NO_DADO_DE_BAJA} AND ${SIN_TENENCIA} THEN 1 ELSE 0 END AS bit) AS alerta_sin_tenencia
`

const JOINS = `
  FROM vehiculos v
  JOIN modelos m ON m.id = v.modelo_id
  ${JOINS_HIJAS}
  LEFT JOIN sucursales           s  ON s.id = COALESCE(c.sucursal_id, mc.sucursal_id)
  LEFT JOIN rutas                r  ON r.id = COALESCE(t.ruta_id, ct.ruta_id)
  LEFT JOIN seguros              seg ON seg.id = ${SEGURO_ID_SQL}
  LEFT JOIN permisos_circulacion per ON per.id = ${PERMISO_ID_SQL}
`

// Los requerimientos vencidos no se pueden resolver aquí: dependen del
// kilometraje contra el último mantenimiento y de intervalos en meses, y esa
// clasificación ya vive en el servicio del tablero. Llegan resueltos, como una
// lista de ids separados por coma.
const WHERE_FILTER = `
  WHERE (@tipo     IS NULL OR v.tipo      = @tipo)
    AND (@modeloId IS NULL OR v.modelo_id = @modeloId)
    AND (@search IS NULL
         OR m.marca LIKE @search OR m.nombre LIKE @search
         OR v.numero_serie LIKE @search OR v.placas LIKE @search)
    AND (@alerta IS NULL
         OR (${NO_DADO_DE_BAJA}
             AND ((@alerta = 'sin_tenencia' AND ${SIN_TENENCIA})
               OR (@alerta = 'sin_seguro'   AND ${SIN_SEGURO})
               OR (@alerta = 'permiso_por_vencer'
                   AND ${PERMISO_ID_SQL} IS NOT NULL AND per.fecha_expiracion <= @limite)
               OR (@alerta = 'requerimientos_vencidos'
                   AND v.id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@idsAlerta, ','))))))
`

// ── Read ──────────────────────────────────────────────────────────────────────

export async function findAll(params: {
  offset: number; pageSize: number; search?: string; tipo?: TipoVehiculo; modelo_id?: number
  // Filtro de atención, con lo que hace falta para resolverlo: la fecha límite
  // de "por vencer" y los ids que el servicio ya clasificó.
  alerta?: AlertaVehiculo; limite?: string; idsAlerta?: number[]
}): Promise<{ data: VehiculoRow[]; total: number }> {
  const pool = await getPool()
  const req = pool.request()
    .input('search',    sql.NVarChar(100), params.search ? `%${params.search}%` : null)
    .input('tipo',      sql.NVarChar(20),  params.tipo     ?? null)
    .input('modeloId',  sql.Int,           params.modelo_id ?? null)
    .input('alerta',    sql.NVarChar(30),  params.alerta   ?? null)
    .input('limite',    sql.Date,          params.limite   ?? null)
    .input('idsAlerta', sql.NVarChar(sql.MAX), params.idsAlerta?.join(',') ?? '')
    .input('offset',   sql.Int,           params.offset)
    .input('pageSize', sql.Int,           params.pageSize)

  const result = await req.query(`
    SELECT ${SELECT_COLS} ${JOINS} ${WHERE_FILTER}
    ORDER BY v.tipo, m.marca, m.nombre, v.numero_serie
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(*) AS total ${JOINS} ${WHERE_FILTER};
  `)
  return {
    data: (result.recordsets[0] as unknown as VehiculoRowSql[]).map(conAlertas),
    total: result.recordsets[1][0].total,
  }
}

// Sin paginar: para reportes que necesitan la flota completa de una sola vez.
export async function findAllParaReporte(): Promise<VehiculoRow[]> {
  const pool = await getPool()
  const result = await pool.request().query(`
    SELECT ${SELECT_COLS} ${JOINS}
    ORDER BY v.tipo, m.marca, m.nombre, v.numero_serie
  `)
  return (result.recordset as VehiculoRowSql[]).map(conAlertas)
}

export async function findById(id: number): Promise<VehiculoRow | null> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${SELECT_COLS} ${JOINS} WHERE v.id = @id`)
  const row = (result.recordset as VehiculoRowSql[])[0]
  return row ? conAlertas(row) : null
}

// ¿Ya hay un vehículo con este número de serie? exceptId excluye el propio al
// editar.
export async function existsSerie(serie: string, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('serie',  sql.NVarChar(80), serie)
    .input('except', sql.Int,          exceptId ?? null)
    .query('SELECT TOP 1 id FROM vehiculos WHERE numero_serie = @serie AND (@except IS NULL OR id <> @except)')
  return r.recordset.length > 0
}

// ¿Ya hay un vehículo con estas placas? (solo aplica a placas no vacías).
export async function existsPlacas(placas: string, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('placas', sql.NVarChar(20), placas)
    .input('except', sql.Int,          exceptId ?? null)
    .query('SELECT TOP 1 id FROM vehiculos WHERE placas = @placas AND (@except IS NULL OR id <> @except)')
  return r.recordset.length > 0
}

export interface DependenciasVehiculo {
  mantenimientos: number
  recargas:       number
  vales:          number
}

// Registros históricos que impiden dar de baja el vehículo. Se cuentan por
// separado para poder decir en el mensaje qué es lo que lo está reteniendo,
// en vez de un "tiene N registros vinculados" que no orienta a nadie.
export async function countDependencies(id: number): Promise<DependenciasVehiculo> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM mantenimiento          WHERE vehiculo_id = @id) AS mantenimientos,
        (SELECT COUNT(*) FROM recargas_combustible   WHERE vehiculo_id = @id) AS recargas,
        (SELECT COUNT(*) FROM vales_gasolina         WHERE vehiculo_id = @id) AS vales
    `)
  return result.recordset[0]
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function create(data: VehiculoCreate): Promise<VehiculoRow> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const vRes = await tx.request()
      .input('modelo_id',    sql.Int,           data.modelo_id)
      .input('tipo',         sql.NVarChar(20),  data.tipo)
      .input('serie',        sql.NVarChar(80),  data.serie)
      .input('placas',       sql.NVarChar(20),  data.placas ?? null)
      .input('fechaCompra',  sql.Date,          data.fecha_compra ?? null)
      .query('INSERT INTO vehiculos (modelo_id, tipo, numero_serie, placas, fecha_compra) OUTPUT INSERTED.id VALUES (@modelo_id, @tipo, @serie, @placas, @fechaCompra)')
    const vid = vRes.recordset[0].id

    // Seguro y permiso van en la tabla hija, y solo en las de los tipos que los
    // llevan: la columna ni existe en las demás. El servicio ya rechazó el
    // payload que traiga uno donde no aplica.
    const sub = tx.request().input('vid', sql.Int, vid)
    if (TIPOS_CON_SEGURO.includes(data.tipo))  sub.input('seguroId',  sql.Int, data.seguro_id ?? null)
    if (TIPOS_CON_PERMISO.includes(data.tipo)) sub.input('permisoId', sql.Int, data.permiso_id ?? null)
    if (data.tipo === 'camion') {
      await sub
        .input('combustible', sql.NVarChar(30),  data.combustible!)
        .input('km',          sql.Int,           data.kilometraje ?? 0)
        .input('status',      sql.NVarChar(30),  data.status!)
        .input('ubicacion',   sql.NVarChar(200), data.ubicacion ?? null)
        .input('sucursal',    sql.Int,           data.sucursal_id!)
        .input('tenenciaExp', sql.Date,          data.tenencia_expiracion ?? null)
        .query('INSERT INTO camiones (vehiculo_id,combustible,kilometraje,status,ubicacion,sucursal_id,tenencia_expiracion,seguro_id,permiso_id) VALUES (@vid,@combustible,@km,@status,@ubicacion,@sucursal,@tenenciaExp,@seguroId,@permisoId)')
    } else if (data.tipo === 'tractocamion') {
      await sub
        .input('tonelaje',    sql.Int,          data.tonelaje!)
        .input('combustible', sql.NVarChar(30), data.combustible!)
        .input('km',          sql.Int,          data.kilometraje ?? 0)
        .input('status',      sql.NVarChar(30), data.status!)
        .input('ruta',        sql.Int,          data.ruta_id!)
        // Sin tenencia: no la pagan. Las columnas siguen en la tabla hasta que
        // la migración 004 las tire, pero ya no se escriben.
        .query('INSERT INTO tractocamiones (vehiculo_id,tonelaje,combustible,kilometraje,status,ruta_id,seguro_id) VALUES (@vid,@tonelaje,@combustible,@km,@status,@ruta,@seguroId)')
    } else if (data.tipo === 'caja_trailer') {
      await sub
        .input('pies',   sql.Int,          data.pies!)
        .input('status', sql.NVarChar(30), data.status!)
        .input('ruta',   sql.Int,          data.ruta_id!)
        .query('INSERT INTO cajas_trailer (vehiculo_id,pies,status,ruta_id) VALUES (@vid,@pies,@status,@ruta)')
    } else if (data.tipo === 'montacargas') {
      await sub
        .input('combustible', sql.NVarChar(30),  data.combustible!)
        .input('ubicacion',   sql.NVarChar(200), data.ubicacion ?? null)
        .input('status',      sql.NVarChar(30),  data.status!)
        .input('sucursal',    sql.Int,           data.sucursal_id!)
        .query('INSERT INTO montacargas (vehiculo_id,combustible,ubicacion,status,sucursal_id,seguro_id) VALUES (@vid,@combustible,@ubicacion,@status,@sucursal,@seguroId)')
    } else {
      await sub
        .input('combustible', sql.NVarChar(30),  data.combustible!)
        .input('ubicacion',   sql.NVarChar(200), data.ubicacion ?? null)
        .input('status',      sql.NVarChar(30),  data.status!)
        .input('km',          sql.Int,           data.kilometraje ?? 0)
        .input('tenenciaExp', sql.Date,          data.tenencia_expiracion ?? null)
        .query('INSERT INTO vehiculos_utilitarios (vehiculo_id,combustible,ubicacion,status,kilometraje,tenencia_expiracion,seguro_id,permiso_id) VALUES (@vid,@combustible,@ubicacion,@status,@km,@tenenciaExp,@seguroId,@permisoId)')
    }

    await tx.commit()
    return (await findById(vid))!
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// Tabla donde vive el kilometraje de cada tipo. Cajas de trailer y montacargas
// no llevan odómetro, por eso no aparecen aquí.
const TABLA_KM: Partial<Record<TipoVehiculo, string>> = {
  camion:       'camiones',
  tractocamion: 'tractocamiones',
  utilitario:   'vehiculos_utilitarios',
}

// Sube el odómetro del vehículo al kilometraje reportado en un mantenimiento.
// Solo avanza: un mantenimiento capturado con fecha vieja (o con un km menor al
// ya registrado) no debe hacer retroceder el odómetro.
export async function avanzarKilometraje(vehiculoId: number, km: number): Promise<void> {
  const pool = await getPool()

  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query('SELECT tipo FROM vehiculos WHERE id=@vid')
  const tipo: TipoVehiculo | undefined = r.recordset[0]?.tipo
  const tabla = tipo ? TABLA_KM[tipo] : undefined
  if (!tabla) return

  await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .input('km',  sql.Int, km)
    .query(`
      UPDATE ${tabla} SET kilometraje=@km
      WHERE vehiculo_id=@vid AND (kilometraje IS NULL OR @km > kilometraje)
    `)
}

export async function update(id: number, tipo: TipoVehiculo, data: VehiculoUpdate): Promise<VehiculoRow | null> {
  const pool = await getPool()

  // Update base table
  const baseReq = pool.request().input('id', sql.Int, id)
  const baseSets: string[] = []
  if (data.modelo_id   !== undefined) { baseReq.input('modelo_id',   sql.Int,           data.modelo_id);   baseSets.push('modelo_id=@modelo_id') }
  if (data.serie       !== undefined) { baseReq.input('serie',       sql.NVarChar(80),  data.serie);       baseSets.push('numero_serie=@serie') }
  if ('placas' in data)               { baseReq.input('placas',     sql.NVarChar(20),  data.placas ?? null); baseSets.push('placas=@placas') }
  if ('fecha_compra' in data)         { baseReq.input('fechaCompra', sql.Date,          data.fecha_compra ?? null); baseSets.push('fecha_compra=@fechaCompra') }
  if (baseSets.length) await baseReq.query(`UPDATE vehiculos SET ${baseSets.join(',')} WHERE id=@id`)

  // Update subtable
  const sub = pool.request().input('vid', sql.Int, id)
  const subSets: string[] = []

  // Seguro y permiso son columnas de la hija, y solo de los tipos que los
  // llevan. Para un tipo que no lo lleva se ignora en silencio: el servicio ya
  // rechaza el payload que lo traiga con valor, así que aquí solo puede quedar
  // el null que manda un formulario donde el campo ni se muestra.
  if ('seguro_id' in data && TIPOS_CON_SEGURO.includes(tipo)) {
    sub.input('seguroId', sql.Int, data.seguro_id ?? null); subSets.push('seguro_id=@seguroId')
  }
  if ('permiso_id' in data && TIPOS_CON_PERMISO.includes(tipo)) {
    sub.input('permisoId', sql.Int, data.permiso_id ?? null); subSets.push('permiso_id=@permisoId')
  }

  if (tipo === 'camion') {
    if (data.combustible  !== undefined) { sub.input('combustible', sql.NVarChar(30),  data.combustible);  subSets.push('combustible=@combustible') }
    if (data.kilometraje  !== undefined) { sub.input('km',          sql.Int,           data.kilometraje);  subSets.push('kilometraje=@km') }
    if (data.status       !== undefined) { sub.input('status',      sql.NVarChar(30),  data.status);       subSets.push('status=@status') }
    if ('ubicacion' in data)             { sub.input('ubicacion',   sql.NVarChar(200), data.ubicacion ?? null); subSets.push('ubicacion=@ubicacion') }
    if (data.sucursal_id  !== undefined) { sub.input('sucursal',    sql.Int,           data.sucursal_id);  subSets.push('sucursal_id=@sucursal') }
    if ('tenencia_expiracion' in data)   { sub.input('tenenciaExp', sql.Date,          data.tenencia_expiracion ?? null); subSets.push('tenencia_expiracion=@tenenciaExp') }
    if (subSets.length) await sub.query(`UPDATE camiones SET ${subSets.join(',')} WHERE vehiculo_id=@vid`)
  } else if (tipo === 'tractocamion') {
    if (data.tonelaje     !== undefined) { sub.input('tonelaje',    sql.Int,           data.tonelaje);     subSets.push('tonelaje=@tonelaje') }
    if (data.combustible  !== undefined) { sub.input('combustible', sql.NVarChar(30),  data.combustible);  subSets.push('combustible=@combustible') }
    if (data.kilometraje  !== undefined) { sub.input('km',          sql.Int,           data.kilometraje);  subSets.push('kilometraje=@km') }
    if (data.status       !== undefined) { sub.input('status',      sql.NVarChar(30),  data.status);       subSets.push('status=@status') }
    if (data.ruta_id      !== undefined) { sub.input('ruta',        sql.Int,           data.ruta_id);      subSets.push('ruta_id=@ruta') }
    // La tenencia no se toca: los tractocamiones no la pagan.
    if (subSets.length) await sub.query(`UPDATE tractocamiones SET ${subSets.join(',')} WHERE vehiculo_id=@vid`)
  } else if (tipo === 'caja_trailer') {
    if (data.pies    !== undefined) { sub.input('pies',   sql.Int,          data.pies);    subSets.push('pies=@pies')     }
    if (data.status  !== undefined) { sub.input('status', sql.NVarChar(30), data.status);  subSets.push('status=@status') }
    if (data.ruta_id !== undefined) { sub.input('ruta',   sql.Int,          data.ruta_id); subSets.push('ruta_id=@ruta')  }
    if (subSets.length) await sub.query(`UPDATE cajas_trailer SET ${subSets.join(',')} WHERE vehiculo_id=@vid`)
  } else if (tipo === 'montacargas') {
    if (data.combustible !== undefined) { sub.input('combustible', sql.NVarChar(30),  data.combustible);  subSets.push('combustible=@combustible') }
    if ('ubicacion' in data)            { sub.input('ubicacion',   sql.NVarChar(200), data.ubicacion ?? null); subSets.push('ubicacion=@ubicacion') }
    if (data.status      !== undefined) { sub.input('status',      sql.NVarChar(30),  data.status);       subSets.push('status=@status')       }
    if (data.sucursal_id !== undefined) { sub.input('sucursal',    sql.Int,           data.sucursal_id);  subSets.push('sucursal_id=@sucursal') }
    if (subSets.length) await sub.query(`UPDATE montacargas SET ${subSets.join(',')} WHERE vehiculo_id=@vid`)
  } else {
    if (data.combustible  !== undefined) { sub.input('combustible', sql.NVarChar(30),  data.combustible);  subSets.push('combustible=@combustible') }
    if ('ubicacion' in data)             { sub.input('ubicacion',   sql.NVarChar(200), data.ubicacion ?? null); subSets.push('ubicacion=@ubicacion') }
    if (data.status       !== undefined) { sub.input('status',      sql.NVarChar(30),  data.status);       subSets.push('status=@status')       }
    if (data.kilometraje  !== undefined) { sub.input('km',          sql.Int,           data.kilometraje);  subSets.push('kilometraje=@km')      }
    if ('tenencia_expiracion' in data)   { sub.input('tenenciaExp', sql.Date,          data.tenencia_expiracion ?? null); subSets.push('tenencia_expiracion=@tenenciaExp') }
    if (subSets.length) await sub.query(`UPDATE vehiculos_utilitarios SET ${subSets.join(',')} WHERE vehiculo_id=@vid`)
  }

  return findById(id)
}

export async function remove(id: number): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const tipoRes = await tx.request().input('id', sql.Int, id)
      .query('SELECT tipo FROM vehiculos WHERE id=@id')
    const tipo: TipoVehiculo = tipoRes.recordset[0]?.tipo
    if (!tipo) { await tx.rollback(); return }

    // Preventivos e incidencias del vehículo: se sueltan sus vínculos con
    // mantenimientos y agendas (FK NO ACTION) y se borran los padres; las tablas
    // hijas se van solas por ON DELETE CASCADE.
    await tx.request().input('id', sql.Int, id).query(`
      DELETE mp FROM mantenimiento_pendientes mp
      JOIN pendientes p ON p.id = mp.pendiente_id
      WHERE p.vehiculo_id = @id
    `)
    await tx.request().input('id', sql.Int, id).query(`
      DELETE ap FROM agenda_pendientes ap
      JOIN pendientes p ON p.id = ap.pendiente_id
      WHERE p.vehiculo_id = @id
    `)
    // El vínculo con las garantías apunta a `garantias_vehiculo` con NO ACTION
    // (ver la migración 010): se suelta antes, para no depender del orden en que
    // el motor resuelva las dos cascadas que bajan de `vehiculos`.
    await tx.request().input('id', sql.Int, id).query(`
      DELETE rg FROM requerimiento_garantias rg
      JOIN garantias_vehiculo gv ON gv.id = rg.garantia_vehiculo_id
      WHERE gv.vehiculo_id = @id
    `)
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM pendientes WHERE vehiculo_id=@id')
    // El avance del programa de mantenimiento (migración 013). Los estados
    // apuntan a las visitas con NO ACTION, así que van primero; se borran a
    // mano por lo mismo que las garantías, para no depender del orden en que el
    // motor resuelva las cascadas que bajan de `vehiculos`.
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM vehiculo_operacion_estado WHERE vehiculo_id=@id')
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM vehiculo_programa_visita WHERE vehiculo_id=@id')
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM vehiculo_programa WHERE vehiculo_id=@id')
    const sub = tx.request().input('id', sql.Int, id)
    const table = tipo === 'camion' ? 'camiones' : tipo === 'tractocamion' ? 'tractocamiones'
                : tipo === 'caja_trailer' ? 'cajas_trailer' : tipo === 'montacargas' ? 'montacargas'
                : 'vehiculos_utilitarios'
    await sub.query(`DELETE FROM ${table} WHERE vehiculo_id=@id`)
    await tx.request().input('id', sql.Int, id).query('DELETE FROM vehiculos WHERE id=@id')
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
