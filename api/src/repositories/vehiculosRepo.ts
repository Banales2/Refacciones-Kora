import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { TipoVehiculo, VehiculoCreate, VehiculoUpdate } from '../schemas/vehiculoSchema'

export interface VehiculoRow {
  id:           number
  vehiculo:     string
  tipo:         TipoVehiculo
  modelo_id:    number
  marca:        string
  modelo:       string
  serie:        string
  status:       string | null
  kilometraje:  number | null
  combustible:  string | null
  ubicacion:    string | null
  sucursal_id:  number | null
  sucursal:     string | null
  tonelaje:     number | null
  tenencia:     string | null
  ruta_id:      number | null
  ruta:         string | null
  pies:         number | null
  fecha_compra: string | null
}

// ── Shared SQL fragments ──────────────────────────────────────────────────────

const SELECT_COLS = `
  v.id, v.vehiculo, v.tipo, v.modelo_id, v.fecha_compra,
  m.marca, m.nombre AS modelo,
  COALESCE(c.serie, t.serie, ct.serie, u.serie) AS serie,
  CASE WHEN v.tipo='camion'       THEN c.status       WHEN v.tipo='tractocamion' THEN t.status
       WHEN v.tipo='caja_trailer' THEN ct.status      WHEN v.tipo='utilitario'   THEN u.status   END AS status,
  CASE WHEN v.tipo='camion'       THEN c.kilometraje   WHEN v.tipo='tractocamion' THEN t.kilometraje
       WHEN v.tipo='utilitario'   THEN u.kilometraje   ELSE NULL END AS kilometraje,
  CASE WHEN v.tipo='camion'       THEN c.combustible   WHEN v.tipo='tractocamion' THEN t.combustible
       WHEN v.tipo='utilitario'   THEN u.combustible   ELSE NULL END AS combustible,
  CASE WHEN v.tipo='camion'       THEN c.ubicacion     WHEN v.tipo='utilitario'   THEN u.ubicacion     ELSE NULL END AS ubicacion,
  c.sucursal_id, s.nombre AS sucursal,
  t.tonelaje, t.tenencia, t.ruta_id, r.nombre AS ruta,
  ct.pies
`

const JOINS = `
  FROM vehiculos v
  JOIN modelos m ON m.id = v.modelo_id
  LEFT JOIN camiones             c  ON c.vehiculo_id  = v.id
  LEFT JOIN tractocamiones       t  ON t.vehiculo_id  = v.id
  LEFT JOIN cajas_trailer        ct ON ct.vehiculo_id = v.id
  LEFT JOIN vehiculos_utilitarios u  ON u.vehiculo_id  = v.id
  LEFT JOIN sucursales           s  ON s.id = c.sucursal_id
  LEFT JOIN rutas                r  ON r.id = t.ruta_id
`

const WHERE_FILTER = `
  WHERE (@tipo     IS NULL OR v.tipo      = @tipo)
    AND (@modeloId IS NULL OR v.modelo_id = @modeloId)
    AND (@search IS NULL
         OR v.vehiculo LIKE @search OR m.marca LIKE @search OR m.nombre LIKE @search
         OR COALESCE(c.serie, t.serie, ct.serie, u.serie) LIKE @search)
`

// ── Read ──────────────────────────────────────────────────────────────────────

export async function findAll(params: {
  offset: number; pageSize: number; search?: string; tipo?: TipoVehiculo; modelo_id?: number
}): Promise<{ data: VehiculoRow[]; total: number }> {
  const pool = await getPool()
  const req = pool.request()
    .input('search',   sql.NVarChar(100), params.search ? `%${params.search}%` : null)
    .input('tipo',     sql.NVarChar(20),  params.tipo     ?? null)
    .input('modeloId', sql.Int,           params.modelo_id ?? null)
    .input('offset',   sql.Int,           params.offset)
    .input('pageSize', sql.Int,           params.pageSize)

  const result = await req.query(`
    SELECT ${SELECT_COLS} ${JOINS} ${WHERE_FILTER}
    ORDER BY v.tipo, v.vehiculo
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(*) AS total ${JOINS} ${WHERE_FILTER};
  `)
  return { data: result.recordsets[0], total: result.recordsets[1][0].total }
}

export async function findById(id: number): Promise<VehiculoRow | null> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${SELECT_COLS} ${JOINS} WHERE v.id = @id`)
  return result.recordset[0] ?? null
}

export async function countDependencies(id: number): Promise<number> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS total FROM mantenimiento WHERE vehiculo_id = @id')
  return result.recordset[0].total
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function create(data: VehiculoCreate): Promise<VehiculoRow> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const vRes = await tx.request()
      .input('vehiculo',     sql.NVarChar(120), data.vehiculo)
      .input('modelo_id',    sql.Int,           data.modelo_id)
      .input('tipo',         sql.NVarChar(20),  data.tipo)
      .input('fechaCompra',  sql.Date,          data.fecha_compra ?? null)
      .query('INSERT INTO vehiculos (vehiculo, modelo_id, tipo, fecha_compra) OUTPUT INSERTED.id VALUES (@vehiculo, @modelo_id, @tipo, @fechaCompra)')
    const vid = vRes.recordset[0].id

    const sub = tx.request().input('vid', sql.Int, vid)
    if (data.tipo === 'camion') {
      await sub
        .input('serie',       sql.NVarChar(80),  data.serie)
        .input('combustible', sql.NVarChar(30),  data.combustible!)
        .input('km',          sql.Int,           data.kilometraje ?? 0)
        .input('status',      sql.NVarChar(30),  data.status!)
        .input('ubicacion',   sql.NVarChar(200), data.ubicacion ?? null)
        .input('sucursal',    sql.Int,           data.sucursal_id!)
        .query('INSERT INTO camiones (vehiculo_id,serie,combustible,kilometraje,status,ubicacion,sucursal_id) VALUES (@vid,@serie,@combustible,@km,@status,@ubicacion,@sucursal)')
    } else if (data.tipo === 'tractocamion') {
      await sub
        .input('serie',       sql.NVarChar(80), data.serie)
        .input('tonelaje',    sql.Int,          data.tonelaje!)
        .input('combustible', sql.NVarChar(30), data.combustible!)
        .input('tenencia',    sql.NVarChar(50), data.tenencia ?? null)
        .input('km',          sql.Int,          data.kilometraje ?? 0)
        .input('status',      sql.NVarChar(30), data.status!)
        .input('ruta',        sql.Int,          data.ruta_id!)
        .query('INSERT INTO tractocamiones (vehiculo_id,serie,tonelaje,combustible,tenencia,kilometraje,status,ruta_id) VALUES (@vid,@serie,@tonelaje,@combustible,@tenencia,@km,@status,@ruta)')
    } else if (data.tipo === 'caja_trailer') {
      await sub
        .input('serie',  sql.NVarChar(80), data.serie)
        .input('pies',   sql.Int,          data.pies!)
        .input('status', sql.NVarChar(30), data.status!)
        .query('INSERT INTO cajas_trailer (vehiculo_id,serie,pies,status) VALUES (@vid,@serie,@pies,@status)')
    } else {
      await sub
        .input('serie',       sql.NVarChar(80),  data.serie)
        .input('combustible', sql.NVarChar(30),  data.combustible!)
        .input('ubicacion',   sql.NVarChar(200), data.ubicacion ?? null)
        .input('status',      sql.NVarChar(30),  data.status!)
        .input('km',          sql.Int,           data.kilometraje ?? 0)
        .query('INSERT INTO vehiculos_utilitarios (vehiculo_id,serie,combustible,ubicacion,status,kilometraje) VALUES (@vid,@serie,@combustible,@ubicacion,@status,@km)')
    }

    await tx.commit()
    return (await findById(vid))!
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

export async function update(id: number, tipo: TipoVehiculo, data: VehiculoUpdate): Promise<VehiculoRow | null> {
  const pool = await getPool()

  // Update base table
  const baseReq = pool.request().input('id', sql.Int, id)
  const baseSets: string[] = []
  if (data.vehiculo    !== undefined) { baseReq.input('vehiculo',    sql.NVarChar(120), data.vehiculo);    baseSets.push('vehiculo=@vehiculo') }
  if (data.modelo_id   !== undefined) { baseReq.input('modelo_id',   sql.Int,           data.modelo_id);   baseSets.push('modelo_id=@modelo_id') }
  if ('fecha_compra' in data)         { baseReq.input('fechaCompra', sql.Date,          data.fecha_compra ?? null); baseSets.push('fecha_compra=@fechaCompra') }
  if (baseSets.length) await baseReq.query(`UPDATE vehiculos SET ${baseSets.join(',')} WHERE id=@id`)

  // Update subtable
  const sub = pool.request().input('vid', sql.Int, id)
  const subSets: string[] = []
  if (data.serie !== undefined) { sub.input('serie', sql.NVarChar(80), data.serie); subSets.push('serie=@serie') }

  if (tipo === 'camion') {
    if (data.combustible  !== undefined) { sub.input('combustible', sql.NVarChar(30),  data.combustible);  subSets.push('combustible=@combustible') }
    if (data.kilometraje  !== undefined) { sub.input('km',          sql.Int,           data.kilometraje);  subSets.push('kilometraje=@km') }
    if (data.status       !== undefined) { sub.input('status',      sql.NVarChar(30),  data.status);       subSets.push('status=@status') }
    if ('ubicacion' in data)             { sub.input('ubicacion',   sql.NVarChar(200), data.ubicacion ?? null); subSets.push('ubicacion=@ubicacion') }
    if (data.sucursal_id  !== undefined) { sub.input('sucursal',    sql.Int,           data.sucursal_id);  subSets.push('sucursal_id=@sucursal') }
    if (subSets.length) await sub.query(`UPDATE camiones SET ${subSets.join(',')} WHERE vehiculo_id=@vid`)
  } else if (tipo === 'tractocamion') {
    if (data.tonelaje     !== undefined) { sub.input('tonelaje',    sql.Int,           data.tonelaje);     subSets.push('tonelaje=@tonelaje') }
    if (data.combustible  !== undefined) { sub.input('combustible', sql.NVarChar(30),  data.combustible);  subSets.push('combustible=@combustible') }
    if ('tenencia' in data)              { sub.input('tenencia',    sql.NVarChar(50),  data.tenencia ?? null); subSets.push('tenencia=@tenencia') }
    if (data.kilometraje  !== undefined) { sub.input('km',          sql.Int,           data.kilometraje);  subSets.push('kilometraje=@km') }
    if (data.status       !== undefined) { sub.input('status',      sql.NVarChar(30),  data.status);       subSets.push('status=@status') }
    if (data.ruta_id      !== undefined) { sub.input('ruta',        sql.Int,           data.ruta_id);      subSets.push('ruta_id=@ruta') }
    if (subSets.length) await sub.query(`UPDATE tractocamiones SET ${subSets.join(',')} WHERE vehiculo_id=@vid`)
  } else if (tipo === 'caja_trailer') {
    if (data.pies   !== undefined) { sub.input('pies',   sql.Int,          data.pies);   subSets.push('pies=@pies')     }
    if (data.status !== undefined) { sub.input('status', sql.NVarChar(30), data.status); subSets.push('status=@status') }
    if (subSets.length) await sub.query(`UPDATE cajas_trailer SET ${subSets.join(',')} WHERE vehiculo_id=@vid`)
  } else {
    if (data.combustible  !== undefined) { sub.input('combustible', sql.NVarChar(30),  data.combustible);  subSets.push('combustible=@combustible') }
    if ('ubicacion' in data)             { sub.input('ubicacion',   sql.NVarChar(200), data.ubicacion ?? null); subSets.push('ubicacion=@ubicacion') }
    if (data.status       !== undefined) { sub.input('status',      sql.NVarChar(30),  data.status);       subSets.push('status=@status')       }
    if (data.kilometraje  !== undefined) { sub.input('km',          sql.Int,           data.kilometraje);  subSets.push('kilometraje=@km')      }
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

    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM requerimientos_exclusivos WHERE vehiculo_id=@id')
    const sub = tx.request().input('id', sql.Int, id)
    const table = tipo === 'camion' ? 'camiones' : tipo === 'tractocamion' ? 'tractocamiones'
                : tipo === 'caja_trailer' ? 'cajas_trailer' : 'vehiculos_utilitarios'
    await sub.query(`DELETE FROM ${table} WHERE vehiculo_id=@id`)
    await tx.request().input('id', sql.Int, id).query('DELETE FROM vehiculos WHERE id=@id')
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
