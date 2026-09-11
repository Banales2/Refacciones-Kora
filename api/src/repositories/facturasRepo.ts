import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { FacturaQuery } from '../schemas/facturaSchema'

// Las facturas de compra de refacciones.
//
// Desde la migración 026 son una tabla. Antes eran el conjunto de lotes que
// compartían folio y proveedor, con la cabecera copiada en cada renglón, y esa
// copia era la que producía las tasas disparejas, el "aplicar a los N
// renglones" y el folio que había que reescribir en todos los lotes. Con
// cabecera única esos tres problemas dejan de existir: no hay dos valores que
// puedan discrepar.
//
// El índice UNIQUE (proveedor_id, folio) es el que impone la otra mitad: el
// mismo proveedor no puede emitir dos veces el mismo folio. Dos proveedores sí
// pueden tener cada uno su "A-100" — por eso la llave lleva los dos.

export interface FacturaRenglon {
  lote_id: number
  pieza_id: number
  numero_serie: string
  descripcion: string
  cantidad_inicial: number
  cantidad_disponible: number
  costo_unitario: number
  sucursal: string | null
}

export interface Factura {
  id: number
  num_factura: string
  proveedor_id: number
  proveedor: string
  fecha_compra: string
  renglones: number
  /** Suma de costo_unitario * cantidad_inicial, sin IVA ni descuento. */
  subtotal: number
  /** `null` = los precios ya incluyen IVA (o es exenta). Migración 020. */
  tasa_iva: number | null
  /** `null` = sin descuento. Se resta al subtotal ANTES del IVA. Migración 021. */
  descuento_pct: number | null
  comprado_por: string
  autorizado_por: string
  /**
   * Se cargó de un histórico: la compra es real y su gasto cuenta, pero las
   * piezas ya se habían usado cuando se capturó y sus renglones nacieron con
   * existencia cero. Ver `db/migrations/028_facturas_historicas.sql`.
   */
  historica: boolean
  detalle: FacturaRenglon[]
}

export interface FacturaCabecera {
  proveedor_id: number
  folio: string
  fecha_compra: string
  tasa_iva?: number | null
  descuento_pct?: number | null
  comprado_por: string
  autorizado_por: string
}

/**
 * La factura de esa compra, creándola si es la primera vez que se ve.
 *
 * Reusar la existente es lo correcto y ya no necesita permiso: capturar el mismo
 * papel en dos tandas es normal, y el UNIQUE garantiza que las dos tandas caen
 * en la MISMA factura en vez de producir dos que hay que fusionar después. Lo
 * que antes era un 409 y una pregunta, ahora es el comportamiento por omisión.
 *
 * Los totales de la cabecera NO se pisan al reusarla: la segunda tanda no tiene
 * por qué saber mejor que la primera cuál era el IVA, y si hay que corregirlo
 * está la pantalla de facturas. Se fijan solo al crearla.
 */
export async function findOrCreate(tx: sql.Transaction, c: FacturaCabecera): Promise<number> {
  const existente = await tx.request()
    .input('pv',    sql.Int,          c.proveedor_id)
    .input('folio', sql.NVarChar(30), c.folio)
    .query('SELECT id FROM facturas WHERE proveedor_id = @pv AND folio = @folio')
  if (existente.recordset[0]) return existente.recordset[0].id as number

  const creada = await tx.request()
    .input('pv',        sql.Int,           c.proveedor_id)
    .input('folio',     sql.NVarChar(30),  c.folio)
    .input('fecha',     sql.Date,          c.fecha_compra)
    .input('tasa',      sql.Decimal(5, 2), c.tasa_iva ?? null)
    .input('descuento', sql.Decimal(5, 2), c.descuento_pct ?? null)
    .input('comprado',  sql.NVarChar(120), c.comprado_por)
    .input('autoriza',  sql.NVarChar(120), c.autorizado_por)
    .query(`
      INSERT INTO facturas
        (proveedor_id, folio, fecha_compra, tasa_iva, descuento_pct,
         comprado_por, autorizado_por)
      OUTPUT INSERTED.id
      VALUES (@pv, @folio, @fecha, @tasa, @descuento, @comprado, @autoriza)`)
  return creada.recordset[0].id as number
}

function filtros(req: sql.Request, p: FacturaQuery): string {
  const where: string[] = []
  if (p.search) {
    req.input('search', `%${p.search}%`)
    where.push('(f.folio LIKE @search OR pr.nombre LIKE @search)')
  }
  if (p.desde) { req.input('desde', sql.Date, p.desde); where.push('f.fecha_compra >= @desde') }
  if (p.hasta) { req.input('hasta', sql.Date, p.hasta); where.push('f.fecha_compra <= @hasta') }
  return where.length ? `WHERE ${where.join(' AND ')}` : ''
}

export async function findAll(
  p: FacturaQuery,
): Promise<{ data: Factura[]; total: number }> {
  const pool = await getPool()
  const req = pool.request()
    .input('offset', sql.Int, (p.page - 1) * p.pageSize)
    .input('pageSize', sql.Int, p.pageSize)
  const where = filtros(req, p)

  // El subtotal y el número de renglones salen de los lotes; todo lo demás, de
  // la cabecera. Ya no hace falta agrupar para reconstruirla.
  const result = await req.query(`
    SELECT f.id, f.folio AS num_factura, f.proveedor_id, pr.nombre AS proveedor,
           CONVERT(char(10), f.fecha_compra, 23) AS fecha_compra,
           f.tasa_iva, f.descuento_pct, f.comprado_por, f.autorizado_por,
           f.historica,
           (SELECT COUNT(*) FROM lotes_pieza l WHERE l.factura_id = f.id) AS renglones,
           COALESCE((SELECT SUM(l.costo_unitario * l.cantidad_inicial)
                     FROM lotes_pieza l WHERE l.factura_id = f.id), 0) AS subtotal
    FROM facturas f
    JOIN proveedores pr ON pr.id = f.proveedor_id
    ${where}
    ORDER BY f.fecha_compra DESC, f.id DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(*) AS total
    FROM facturas f
    JOIN proveedores pr ON pr.id = f.proveedor_id
    ${where};
  `)

  const facturas: Factura[] = result.recordsets[0].map((f: Record<string, unknown>) => ({
    ...f, detalle: [],
  })) as Factura[]
  const total = (result.recordsets[1] as unknown as { total: number }[])[0].total

  if (facturas.length === 0) return { data: [], total }

  // Los renglones de las facturas de esta página, en una sola consulta. Un
  // SELECT por factura sería una consulta por fila de la tabla.
  const detReq = pool.request()
  const ids = facturas.map((f, i) => {
    detReq.input(`f${i}`, sql.Int, f.id)
    return `@f${i}`
  })
  const det = await detReq.query(`
    SELECT l.id AS lote_id, l.factura_id,
           p.id AS pieza_id, p.numero_serie, p.descripcion,
           l.cantidad_inicial, l.costo_unitario,
           COALESCE((SELECT SUM(ex.cantidad) FROM existencias_lote ex
                     WHERE ex.lote_id = l.id), 0) AS cantidad_disponible,
           s.nombre AS sucursal
    FROM lotes_pieza l
    JOIN piezas p ON p.id = l.pieza_id
    LEFT JOIN sucursales s ON s.id = l.sucursal_id
    WHERE l.factura_id IN (${ids.join(', ')})
    ORDER BY p.numero_serie`)

  const porFactura = new Map<number, FacturaRenglon[]>()
  for (const r of det.recordset) {
    if (!porFactura.has(r.factura_id)) porFactura.set(r.factura_id, [])
    porFactura.get(r.factura_id)!.push({
      lote_id: r.lote_id,
      pieza_id: r.pieza_id,
      numero_serie: r.numero_serie,
      descripcion: r.descripcion,
      cantidad_inicial: r.cantidad_inicial,
      cantidad_disponible: r.cantidad_disponible,
      costo_unitario: r.costo_unitario,
      sucursal: r.sucursal,
    })
  }
  for (const f of facturas) f.detalle = porFactura.get(f.id) ?? []

  return { data: facturas, total }
}

/** La factura de ese proveedor con ese folio, si existe. */
export async function findByFolio(
  folio: string, proveedorId: number,
): Promise<{ id: number } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('folio', sql.NVarChar(30), folio)
    .input('pv',    sql.Int,          proveedorId)
    .query('SELECT id FROM facturas WHERE folio = @folio AND proveedor_id = @pv')
  return r.recordset[0] ?? null
}

/** Los lotes de una factura, para la bitácora: hay que capturarlos antes y después. */
export async function idsDeLotes(facturaId: number): Promise<number[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query('SELECT id FROM lotes_pieza WHERE factura_id = @id')
  return r.recordset.map((x: { id: number }) => x.id)
}

/**
 * Fija el IVA y el descuento de la factura.
 *
 * Antes esto escribía en los N lotes y por eso podía dejarlos disparejos. Ahora
 * es un UPDATE de una fila, y la pantalla ya no necesita el botón de "aplicar a
 * todos" ni la bandera de totales dispares.
 */
export async function setTotales(
  facturaId: number, tasa: number | null, descuento: number | null,
): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('id',        sql.Int,           facturaId)
    .input('tasa',      sql.Decimal(5, 2), tasa)
    .input('descuento', sql.Decimal(5, 2), descuento)
    .query('UPDATE facturas SET tasa_iva = @tasa, descuento_pct = @descuento WHERE id = @id')
}

/** Corrige el folio mal tecleado. Una fila, no N. */
export async function setFolio(facturaId: number, nuevo: string): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('id',    sql.Int,          facturaId)
    .input('folio', sql.NVarChar(30), nuevo)
    .query('UPDATE facturas SET folio = @folio WHERE id = @id')
}

/**
 * Mueve todos los renglones de una factura a otra y borra la que queda vacía.
 *
 * Es lo que pasa cuando alguien corrige un folio y resulta que ese proveedor ya
 * tenía una factura así: el mismo papel capturado en dos tandas. Antes esto se
 * lograba reescribiendo el folio en los lotes y las dos "facturas" se volvían
 * una sola por el hecho de compartir texto; ahora es explícito.
 */
export async function fusionar(origenId: number, destinoId: number): Promise<number> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const movidos = await tx.request()
      .input('origen',  sql.Int, origenId)
      .input('destino', sql.Int, destinoId)
      .query('UPDATE lotes_pieza SET factura_id = @destino WHERE factura_id = @origen')
    await tx.request()
      .input('origen', sql.Int, origenId)
      .query('DELETE FROM facturas WHERE id = @origen')
    await tx.commit()
    return movidos.rowsAffected[0] ?? 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * Saca un renglón de su factura y lo mete en la del folio que se le ponga,
 * creándola si no existe. Es lo contrario de fusionar: separar el lote que no
 * era de esa compra.
 *
 * Devuelve `null` si el lote no existe o no tiene factura —el de recuperación no
 * la tiene y no se puede mover a ninguna—.
 */
export async function moverLoteAFolio(
  loteId: number, folio: string,
): Promise<{ factura_id: number } | null> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const actual = await tx.request()
      .input('id', sql.Int, loteId)
      .query(`
        SELECT f.id AS factura_id, f.proveedor_id, f.fecha_compra, f.tasa_iva,
               f.descuento_pct, f.comprado_por, f.autorizado_por
        FROM lotes_pieza l
        JOIN facturas f ON f.id = l.factura_id
        WHERE l.id = @id`)
    const f = actual.recordset[0]
    if (!f) { await tx.rollback(); return null }

    // La factura destino hereda la cabecera de la de origen: es la misma compra
    // partida, no una nueva que haya que capturar desde cero.
    const destinoId = await findOrCreate(tx, {
      proveedor_id:   f.proveedor_id,
      folio,
      fecha_compra:   f.fecha_compra,
      tasa_iva:       f.tasa_iva,
      descuento_pct:  f.descuento_pct,
      comprado_por:   f.comprado_por,
      autorizado_por: f.autorizado_por,
    })

    await tx.request()
      .input('id',      sql.Int, loteId)
      .input('destino', sql.Int, destinoId)
      .query('UPDATE lotes_pieza SET factura_id = @destino WHERE id = @id')

    // La de origen pudo quedarse sin renglones. Una factura vacía no es nada.
    await tx.request()
      .input('origen', sql.Int, f.factura_id)
      .query(`
        DELETE FROM facturas
        WHERE id = @origen
          AND NOT EXISTS (SELECT 1 FROM lotes_pieza l WHERE l.factura_id = @origen)`)

    await tx.commit()
    return { factura_id: destinoId }
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
