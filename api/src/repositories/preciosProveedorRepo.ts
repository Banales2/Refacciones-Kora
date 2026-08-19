import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { PrecioProveedorCreate, PrecioProveedorUpdate } from '../schemas/precioProveedorSchema'

export interface PrecioProveedor {
  id:             number
  proveedor_id:   number
  pieza_id:       number
  precio:         number
  fecha:          string
  observaciones:  string | null
  registrado_por: string
  // Datos de la refacción, para no tener que cruzarlos en el cliente.
  pieza_serie:    string
  pieza:          string
  tipo_pieza:     string | null
  /** El precio más reciente que este proveedor tiene para esta refacción. */
  vigente:        boolean
  /** El más barato entre los precios vigentes de todos los proveedores. */
  mejor_precio:        number | null
  mejor_proveedor_id:  number | null
  mejor_proveedor:     string | null
  /** Cuántos proveedores tienen precio registrado para esta refacción. */
  proveedores_con_precio: number
}

// El precio "vigente" de un proveedor para una refacción es el de fecha más
// reciente (y a igual fecha, el capturado después). Sobre esos vigentes se
// calcula el más barato del mercado, que es con lo que se compara.
const CTE_COMPARATIVA = `
  WITH vigentes AS (
    SELECT pp.id, pp.proveedor_id, pp.pieza_id, pp.precio,
           ROW_NUMBER() OVER (PARTITION BY pp.proveedor_id, pp.pieza_id
                              ORDER BY pp.fecha DESC, pp.id DESC) AS rn
    FROM precios_proveedor pp
  ),
  mejores AS (
    SELECT pieza_id, precio AS mejor_precio, proveedor_id AS mejor_proveedor_id,
           ROW_NUMBER() OVER (PARTITION BY pieza_id
                              ORDER BY precio ASC, proveedor_id ASC) AS rn
    FROM vigentes WHERE rn = 1
  ),
  conteo AS (
    SELECT pieza_id, COUNT(*) AS proveedores_con_precio
    FROM vigentes WHERE rn = 1 GROUP BY pieza_id
  )
`

const SELECT_PRECIO = `
  SELECT pp.id, pp.proveedor_id, pp.pieza_id, pp.precio,
         CONVERT(char(10), pp.fecha, 23) AS fecha,
         pp.observaciones, pp.registrado_por,
         p.numero_serie AS pieza_serie, p.descripcion AS pieza,
         tp.nombre AS tipo_pieza,
         CAST(CASE WHEN v.rn = 1 THEN 1 ELSE 0 END AS BIT) AS vigente,
         m.mejor_precio, m.mejor_proveedor_id, pm.nombre AS mejor_proveedor,
         c.proveedores_con_precio
  FROM precios_proveedor pp
  JOIN piezas p            ON p.id = pp.pieza_id
  LEFT JOIN tipos_pieza tp ON tp.id = p.tipo_pieza_id
  JOIN vigentes v          ON v.id = pp.id
  LEFT JOIN mejores m      ON m.pieza_id = pp.pieza_id AND m.rn = 1
  LEFT JOIN proveedores pm ON pm.id = m.mejor_proveedor_id
  LEFT JOIN conteo c       ON c.pieza_id = pp.pieza_id
`

// Todos los precios que este proveedor tiene registrados, del más reciente al
// más viejo dentro de cada refacción: el primero de cada grupo es el vigente.
export async function findByProveedor(proveedorId: number): Promise<PrecioProveedor[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('pid', sql.Int, proveedorId)
    .query(`
      ${CTE_COMPARATIVA}
      ${SELECT_PRECIO}
      WHERE pp.proveedor_id = @pid
      ORDER BY p.descripcion, p.numero_serie, pp.fecha DESC, pp.id DESC
    `)
  return r.recordset
}

export async function findById(id: number): Promise<PrecioProveedor | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      ${CTE_COMPARATIVA}
      ${SELECT_PRECIO}
      WHERE pp.id = @id
    `)
  return r.recordset[0] ?? null
}

export async function create(
  proveedorId: number, data: PrecioProveedorCreate, registradoPor: string
): Promise<PrecioProveedor> {
  const pool = await getPool()
  const r = await pool.request()
    .input('proveedor_id',   sql.Int,             proveedorId)
    .input('pieza_id',       sql.Int,             data.pieza_id)
    .input('precio',         sql.Decimal(18, 2),  data.precio)
    .input('fecha',          sql.Date,            data.fecha)
    .input('observaciones',  sql.NVarChar(255),   data.observaciones ?? null)
    .input('registrado_por', sql.NVarChar(120),   registradoPor)
    .query(`
      INSERT INTO precios_proveedor
        (proveedor_id, pieza_id, precio, fecha, observaciones, registrado_por)
      OUTPUT INSERTED.id
      VALUES (@proveedor_id, @pieza_id, @precio, @fecha, @observaciones, @registrado_por)
    `)
  return findById(r.recordset[0].id) as Promise<PrecioProveedor>
}

// Ni el proveedor ni la refacción se editan: cambiarlos convertiría el registro
// en otro. Se corrige lo que se pudo capturar mal.
export async function update(id: number, data: PrecioProveedorUpdate): Promise<PrecioProveedor | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)

  if (data.precio !== undefined) {
    req.input('precio', sql.Decimal(18, 2), data.precio)
    sets.push('precio = @precio')
  }
  if (data.fecha !== undefined) {
    req.input('fecha', sql.Date, data.fecha)
    sets.push('fecha = @fecha')
  }
  if (data.observaciones !== undefined) {
    req.input('observaciones', sql.NVarChar(255), data.observaciones ?? null)
    sets.push('observaciones = @observaciones')
  }
  if (!sets.length) return findById(id)

  const r = await req.query(
    `UPDATE precios_proveedor SET ${sets.join(', ')} OUTPUT INSERTED.id WHERE id = @id`
  )
  if (!r.recordset.length) return null
  return findById(id)
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM precios_proveedor OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}

export async function proveedorExists(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT TOP 1 id FROM proveedores WHERE id = @id')
  return r.recordset.length > 0
}

export async function piezaExists(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT TOP 1 id FROM piezas WHERE id = @id')
  return r.recordset.length > 0
}

// Una cotización por proveedor, refacción y día: lo mismo que impide el índice
// único, comprobado aquí para poder contestar con un mensaje entendible.
// `exceptId` deja fuera el registro que se está editando.
export async function existsMismoDia(
  proveedorId: number, piezaId: number, fecha: string, exceptId?: number
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('pid',    sql.Int,  proveedorId)
    .input('pieza',  sql.Int,  piezaId)
    .input('fecha',  sql.Date, fecha)
    .input('except', sql.Int,  exceptId ?? null)
    .query(`
      SELECT TOP 1 id FROM precios_proveedor
      WHERE proveedor_id = @pid AND pieza_id = @pieza AND fecha = @fecha
        AND (@except IS NULL OR id <> @except)
    `)
  return r.recordset.length > 0
}

// ─── Comparativa global ─────────────────────────────────────────────────────

/** El precio vigente de una refacción con un proveedor, para cruzar a lo ancho. */
export interface PrecioVigente {
  pieza_id:      number
  numero_serie:  string
  descripcion:   string
  tipo_pieza:    string | null
  proveedor_id:  number
  proveedor:     string
  precio:        number
  fecha:         string
  observaciones: string | null
  /** Lo que se pagó la última vez que se compró esa refacción, venga de quien venga. */
  ultimo_pagado:      number | null
  ultimo_proveedor:   string | null
  ultima_compra:      string | null
}

// La comparativa de un proveedor contra los demás ya existe (findByProveedor);
// esto es la tabla completa: una fila por (refacción, proveedor) con el precio
// que está vigente hoy. Se devuelve larga y no pivoteada porque el número de
// proveedores no se sabe de antemano — pivotearla es trabajo del servicio.
//
// Se trae además la última compra real de cada refacción: el precio cotizado
// dice a cuánto la venden, pero la decisión se toma comparándolo contra lo que
// de hecho se pagó la última vez.
export async function findVigentesGlobal(): Promise<PrecioVigente[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    WITH vigentes AS (
      SELECT pp.id, pp.proveedor_id, pp.pieza_id, pp.precio, pp.fecha, pp.observaciones,
             ROW_NUMBER() OVER (PARTITION BY pp.proveedor_id, pp.pieza_id
                                ORDER BY pp.fecha DESC, pp.id DESC) AS rn
      FROM precios_proveedor pp
    ),
    ultima_compra AS (
      SELECT l.pieza_id, l.costo_unitario, l.fecha_compra, l.proveedor_id,
             ROW_NUMBER() OVER (PARTITION BY l.pieza_id
                                ORDER BY l.fecha_compra DESC, l.id DESC) AS rn
      FROM lotes_pieza l
    )
    SELECT v.pieza_id, p.numero_serie, p.descripcion, tp.nombre AS tipo_pieza,
           v.proveedor_id, pr.nombre AS proveedor,
           v.precio, CONVERT(char(10), v.fecha, 23) AS fecha, v.observaciones,
           uc.costo_unitario                        AS ultimo_pagado,
           pru.nombre                               AS ultimo_proveedor,
           CONVERT(char(10), uc.fecha_compra, 23)   AS ultima_compra
    FROM vigentes v
    JOIN piezas      p  ON p.id  = v.pieza_id
    JOIN proveedores pr ON pr.id = v.proveedor_id
    LEFT JOIN tipos_pieza  tp  ON tp.id = p.tipo_pieza_id
    LEFT JOIN ultima_compra uc ON uc.pieza_id = v.pieza_id AND uc.rn = 1
    LEFT JOIN proveedores  pru ON pru.id = uc.proveedor_id
    WHERE v.rn = 1
    ORDER BY p.descripcion, p.numero_serie, v.precio
  `)
  return r.recordset
}
