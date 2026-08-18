// Inventario por sucursal: qué hay en cada una, los traspasos entre ellas y los
// mínimos que cada una debe mantener.
//
// La existencia vive en `existencias_lote (lote_id, sucursal_id, cantidad)`.
// Que la llave incluya el lote es lo que permite saber de qué compra salió cada
// pieza de una sucursal — proveedor, factura y costo — sin llegar todavía a
// identificar la pieza una por una.
import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface ExistenciaEnSucursal {
  lote_id:        number
  sucursal_id:    number
  sucursal:       string
  cantidad:       number
  pieza_id:       number
  numero_serie:   string
  descripcion:    string
  tipo_pieza_id:  number | null
  tipo_pieza:     string | null
  proveedor:      string
  num_factura:    string | null
  costo_unitario: number
  fecha_compra:   string
}

/** Qué hay en una sucursal, renglón por lote. Sin sucursal, toda la flota. */
export async function findExistencias(sucursalId?: number): Promise<ExistenciaEnSucursal[]> {
  const pool = await getPool()
  const req = pool.request()
  let where = 'WHERE ex.cantidad > 0'
  if (sucursalId !== undefined) {
    req.input('suc', sql.Int, sucursalId)
    where += ' AND ex.sucursal_id = @suc'
  }
  const r = await req.query(`
    SELECT ex.lote_id, ex.sucursal_id, s.nombre AS sucursal, ex.cantidad,
           p.id AS pieza_id, p.numero_serie, p.descripcion,
           p.tipo_pieza_id, t.nombre AS tipo_pieza,
           pr.nombre AS proveedor, l.num_factura, l.costo_unitario, l.fecha_compra
    FROM existencias_lote ex
    JOIN sucursales s      ON s.id  = ex.sucursal_id
    JOIN lotes_pieza l     ON l.id  = ex.lote_id
    JOIN piezas p          ON p.id  = l.pieza_id
    JOIN proveedores pr    ON pr.id = l.proveedor_id
    LEFT JOIN tipos_pieza t ON t.id = p.tipo_pieza_id
    ${where}
    ORDER BY s.nombre, p.numero_serie, l.fecha_compra`)
  return r.recordset
}

/** Total por refacción en una sucursal, sin desglosar el lote. */
export async function findResumen(sucursalId: number): Promise<{
  pieza_id: number; numero_serie: string; descripcion: string
  tipo_pieza: string | null; cantidad: number
}[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('suc', sql.Int, sucursalId)
    .query(`
      SELECT p.id AS pieza_id, p.numero_serie, p.descripcion,
             t.nombre AS tipo_pieza, SUM(ex.cantidad) AS cantidad
      FROM existencias_lote ex
      JOIN lotes_pieza l      ON l.id = ex.lote_id
      JOIN piezas p           ON p.id = l.pieza_id
      LEFT JOIN tipos_pieza t ON t.id = p.tipo_pieza_id
      WHERE ex.sucursal_id = @suc AND ex.cantidad > 0
      GROUP BY p.id, p.numero_serie, p.descripcion, t.nombre
      ORDER BY p.numero_serie`)
  return r.recordset
}

// ---------------------------------------------------------------------------
// Traspasos
// ---------------------------------------------------------------------------

export interface Traspaso {
  id:                  number
  lote_id:             number
  origen_sucursal_id:  number
  origen:              string
  destino_sucursal_id: number
  destino:             string
  cantidad:            number
  fecha:               string
  usuario_email:       string | null
  observaciones:       string | null
  pieza_id:            number
  numero_serie:        string
  descripcion:         string
}

const SELECT_TRASPASO = `
  SELECT tr.id, tr.lote_id, tr.origen_sucursal_id, so.nombre AS origen,
         tr.destino_sucursal_id, sd.nombre AS destino,
         tr.cantidad, tr.fecha, tr.usuario_email, tr.observaciones,
         p.id AS pieza_id, p.numero_serie, p.descripcion
  FROM traspasos_pieza tr
  JOIN sucursales so ON so.id = tr.origen_sucursal_id
  JOIN sucursales sd ON sd.id = tr.destino_sucursal_id
  JOIN lotes_pieza l ON l.id = tr.lote_id
  JOIN piezas p      ON p.id = l.pieza_id
`

export async function findTraspasos(sucursalId?: number): Promise<Traspaso[]> {
  const pool = await getPool()
  const req = pool.request()
  let where = ''
  if (sucursalId !== undefined) {
    req.input('suc', sql.Int, sucursalId)
    // Las dos puntas: para una sucursal importa tanto lo que recibió como lo
    // que entregó.
    where = 'WHERE tr.origen_sucursal_id = @suc OR tr.destino_sucursal_id = @suc'
  }
  const r = await req.query(`${SELECT_TRASPASO} ${where} ORDER BY tr.fecha DESC, tr.id DESC`)
  return r.recordset
}

/** Existencia de un lote en una sucursal. 0 si no hay fila. */
export async function getExistencia(loteId: number, sucursalId: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('lid', sql.Int, loteId)
    .input('suc', sql.Int, sucursalId)
    .query('SELECT cantidad FROM existencias_lote WHERE lote_id=@lid AND sucursal_id=@suc')
  return r.recordset[0]?.cantidad ?? 0
}

export interface TraspasoCreate {
  lote_id:             number
  origen_sucursal_id:  number
  destino_sucursal_id: number
  cantidad:            number
  fecha:               string
  observaciones?:      string | null
}

// Restar del origen y sumar al destino tiene que ser atómico: a medias, el
// inventario pierde o inventa piezas. El CHECK de cantidad >= 0 es la red por
// si la validación previa se quedó corta por una captura concurrente.
export async function createTraspaso(data: TraspasoCreate, usuarioEmail: string): Promise<Traspaso> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request()
      .input('lid',  sql.Int, data.lote_id)
      .input('suc',  sql.Int, data.origen_sucursal_id)
      .input('cant', sql.Int, data.cantidad)
      .query(`
        UPDATE existencias_lote SET cantidad = cantidad - @cant
        WHERE lote_id = @lid AND sucursal_id = @suc`)

    await tx.request()
      .input('lid',  sql.Int, data.lote_id)
      .input('suc',  sql.Int, data.destino_sucursal_id)
      .input('cant', sql.Int, data.cantidad)
      .query(`
        UPDATE existencias_lote SET cantidad = cantidad + @cant
        WHERE lote_id = @lid AND sucursal_id = @suc;

        IF @@ROWCOUNT = 0
          INSERT INTO existencias_lote (lote_id, sucursal_id, cantidad)
          VALUES (@lid, @suc, @cant);`)

    const ins = await tx.request()
      .input('lid',    sql.Int,           data.lote_id)
      .input('origen', sql.Int,           data.origen_sucursal_id)
      .input('dest',   sql.Int,           data.destino_sucursal_id)
      .input('cant',   sql.Int,           data.cantidad)
      .input('fecha',  sql.Date,          data.fecha)
      .input('user',   sql.NVarChar(255), usuarioEmail)
      .input('obs',    sql.NVarChar(300), data.observaciones ?? null)
      .query(`
        INSERT INTO traspasos_pieza
          (lote_id, origen_sucursal_id, destino_sucursal_id, cantidad, fecha, usuario_email, observaciones)
        OUTPUT INSERTED.id
        VALUES (@lid, @origen, @dest, @cant, @fecha, @user, @obs)`)

    await tx.commit()

    const pool2 = await getPool()
    const r = await pool2.request()
      .input('id', sql.Int, ins.recordset[0].id)
      .query(`${SELECT_TRASPASO} WHERE tr.id = @id`)
    return r.recordset[0]
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// ---------------------------------------------------------------------------
// Mínimos por sucursal
// ---------------------------------------------------------------------------

export interface MinimoSucursal {
  id:            number
  sucursal_id:   number
  sucursal:      string
  pieza_id:      number
  numero_serie:  string
  descripcion:   string
  tipo_pieza:    string | null
  minimo:        number
  observaciones: string | null
  /** Lo que hay hoy en esa sucursal, para comparar contra el mínimo. */
  existencia:    number
}

const SELECT_MINIMO = `
  SELECT m.id, m.sucursal_id, s.nombre AS sucursal,
         m.pieza_id, p.numero_serie, p.descripcion, t.nombre AS tipo_pieza,
         m.minimo, m.observaciones,
         COALESCE((SELECT SUM(ex.cantidad)
                   FROM existencias_lote ex
                   JOIN lotes_pieza l ON l.id = ex.lote_id
                   WHERE l.pieza_id = m.pieza_id AND ex.sucursal_id = m.sucursal_id), 0) AS existencia
  FROM minimos_sucursal m
  JOIN sucursales s       ON s.id = m.sucursal_id
  JOIN piezas p           ON p.id = m.pieza_id
  LEFT JOIN tipos_pieza t ON t.id = p.tipo_pieza_id
`

export async function findMinimos(sucursalId?: number): Promise<MinimoSucursal[]> {
  const pool = await getPool()
  const req = pool.request()
  let where = ''
  if (sucursalId !== undefined) {
    req.input('suc', sql.Int, sucursalId)
    where = 'WHERE m.sucursal_id = @suc'
  }
  const r = await req.query(`${SELECT_MINIMO} ${where} ORDER BY s.nombre, p.numero_serie`)
  return r.recordset
}

export async function findMinimoById(id: number): Promise<MinimoSucursal | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_MINIMO} WHERE m.id = @id`)
  return r.recordset[0] ?? null
}

/** Solo los que están por debajo: es la lista que hay que salir a surtir. */
export async function findFaltantes(sucursalId?: number): Promise<MinimoSucursal[]> {
  const todos = await findMinimos(sucursalId)
  return todos.filter((m) => m.existencia < m.minimo)
}

export async function createMinimo(
  sucursalId: number, piezaId: number, minimo: number, observaciones?: string | null,
): Promise<MinimoSucursal> {
  const pool = await getPool()
  const r = await pool.request()
    .input('suc', sql.Int,           sucursalId)
    .input('pza', sql.Int,           piezaId)
    .input('min', sql.Int,           minimo)
    .input('obs', sql.NVarChar(300), observaciones ?? null)
    .query(`
      INSERT INTO minimos_sucursal (sucursal_id, pieza_id, minimo, observaciones)
      OUTPUT INSERTED.id
      VALUES (@suc, @pza, @min, @obs)`)
  return (await findMinimoById(r.recordset[0].id))!
}

export async function updateMinimo(
  id: number, minimo?: number, observaciones?: string | null,
): Promise<MinimoSucursal | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (minimo !== undefined)        { req.input('min', sql.Int, minimo); sets.push('minimo=@min') }
  if (observaciones !== undefined) { req.input('obs', sql.NVarChar(300), observaciones ?? null); sets.push('observaciones=@obs') }
  if (sets.length === 0) return findMinimoById(id)

  const r = await req.query(`UPDATE minimos_sucursal SET ${sets.join(',')} OUTPUT INSERTED.id WHERE id=@id`)
  if (r.recordset.length === 0) return null
  return findMinimoById(id)
}

export async function removeMinimo(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM minimos_sucursal OUTPUT DELETED.id WHERE id=@id')
  return r.recordset.length > 0
}

/** ¿Ya hay un mínimo para esta refacción en esta sucursal? Solo puede haber uno. */
export async function findMinimoDe(sucursalId: number, piezaId: number): Promise<{ id: number } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('suc', sql.Int, sucursalId)
    .input('pza', sql.Int, piezaId)
    .query('SELECT id FROM minimos_sucursal WHERE sucursal_id=@suc AND pieza_id=@pza')
  return r.recordset[0] ?? null
}
