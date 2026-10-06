import * as sql from 'mssql'
import { getPool } from '../shared/db'
import type { Cruce, FacturaCasetasImport } from '../schemas/facturaCasetasSchema'

// Las facturas de casetas de PASE, sus cruces y el catálogo de tags.
//
// Aquí no hay nada capturado contra qué casar: el cruce no existe en el sistema
// hasta que llega la factura. Lo que se revisa sale del documento mismo y de lo
// que el sistema sabe de cada unidad; eso lo decide `facturasCasetasService`.
//
// Ver `db/migrations/064_facturas_de_casetas.sql`.

const VEHICULO = `CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie)`

export interface FacturaCasetas {
  id: number
  uuid: string
  serie: string | null
  folio: string
  fecha_emision: string
  fecha_limite_pago: string | null
  periodo: string | null
  periodo_desde: string | null
  periodo_hasta: string | null
  subtotal: number
  iva: number
  total: number
  capturado_por: string
  revisada_en: string | null
  revisada_por: string | null
  nota: string | null
  cruces: number
  /** Cuántos cruces son de un tag que nadie ha ligado a una unidad. */
  sin_unidad: number
  /** Cuántas unidades distintas cruzaron. */
  unidades: number
}

export interface CruceRow {
  id: number
  renglon: number
  tag: string
  vehiculo_id: number | null
  vehiculo: string | null
  tipo_vehiculo: string | null
  fecha_hora: string
  evento: string | null
  carril: string | null
  caseta: string
  descripcion: string
  clase: number
  importe: number
  iva: number
  total: number
}

const SELECT_FACTURA = `
  SELECT f.id, f.uuid, f.serie, f.folio,
         CONVERT(varchar(19), f.fecha_emision, 126) AS fecha_emision,
         CONVERT(char(10), f.fecha_limite_pago, 23) AS fecha_limite_pago,
         f.periodo,
         CONVERT(char(10), f.periodo_desde, 23) AS periodo_desde,
         CONVERT(char(10), f.periodo_hasta, 23) AS periodo_hasta,
         f.subtotal, f.iva, f.total, f.capturado_por,
         CONVERT(varchar(19), f.revisada_en, 126) AS revisada_en,
         f.revisada_por, f.nota,
         (SELECT COUNT(*) FROM facturas_casetas_cruces c
           WHERE c.factura_id = f.id) AS cruces,
         (SELECT COUNT(*) FROM facturas_casetas_cruces c
           WHERE c.factura_id = f.id AND c.vehiculo_id IS NULL) AS sin_unidad,
         (SELECT COUNT(DISTINCT c.vehiculo_id) FROM facturas_casetas_cruces c
           WHERE c.factura_id = f.id) AS unidades
  FROM facturas_casetas f
`

export async function findAll(p: {
  page: number; pageSize: number; search?: string; por_revisar?: boolean
}): Promise<{ data: FacturaCasetas[]; total: number }> {
  const pool = await getPool()
  const req = pool.request()
    .input('offset', sql.Int, (p.page - 1) * p.pageSize)
    .input('pageSize', sql.Int, p.pageSize)

  const where: string[] = []
  if (p.search) {
    req.input('search', `%${p.search}%`)
    where.push('(f.folio LIKE @search OR f.periodo LIKE @search OR f.uuid LIKE @search)')
  }
  if (p.por_revisar) where.push('f.revisada_en IS NULL')
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const r = await req.query(`
    ${SELECT_FACTURA}
    ${filtro}
    ORDER BY f.fecha_emision DESC, f.id DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(*) AS total FROM facturas_casetas f ${filtro};
  `)
  const recordsets = r.recordsets as sql.IRecordSet<unknown>[]
  return {
    data: recordsets[0] as unknown as FacturaCasetas[],
    total: (recordsets[1][0] as { total: number }).total,
  }
}

export async function findById(id: number): Promise<FacturaCasetas | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_FACTURA} WHERE f.id = @id`)
  return (r.recordset[0] as FacturaCasetas) ?? null
}

export async function findByUuid(uuid: string): Promise<{ id: number; folio: string } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('uuid', sql.Char(36), uuid)
    .query('SELECT id, folio FROM facturas_casetas WHERE uuid = @uuid')
  return (r.recordset[0] as { id: number; folio: string }) ?? null
}

/**
 * Cuántos renglones van en cada INSERT. SQL Server admite 2,100 parámetros por
 * consulta y cada cruce lleva 12; 150 deja margen. Uno por consulta serían 400
 * viajes a la base por factura.
 */
const LOTE = 150

/**
 * La factura, sus cruces y los tags nuevos, en una transacción: media factura
 * importada sería peor que ninguna, porque el total ya no cuadraría con nada.
 *
 * Los tags que no estaban en el catálogo se dan de alta sin unidad, y cada cruce
 * toma la unidad que su tag tiene HOY. Ver la cabecera de la migración.
 */
export async function crear(data: FacturaCasetasImport, capturadoPor: string): Promise<number> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const cab = await tx.request()
      .input('uuid',     sql.Char(36),        data.uuid)
      .input('serie',    sql.NVarChar(25),    data.serie)
      .input('folio',    sql.NVarChar(40),    data.folio)
      .input('emision',  sql.NVarChar(19),    data.fecha_emision)
      .input('limite',   sql.Date,            data.fecha_limite_pago)
      .input('periodo',  sql.NVarChar(100),   data.periodo)
      .input('desde',    sql.Date,            data.periodo_desde)
      .input('hasta',    sql.Date,            data.periodo_hasta)
      .input('subtotal', sql.Decimal(18, 2),  data.subtotal)
      .input('iva',      sql.Decimal(18, 2),  data.iva)
      .input('total',    sql.Decimal(18, 2),  data.total)
      .input('capturo',  sql.NVarChar(120),   capturadoPor)
      .query(`
        INSERT INTO facturas_casetas
          (uuid, serie, folio, fecha_emision, fecha_limite_pago, periodo,
           periodo_desde, periodo_hasta, subtotal, iva, total, capturado_por)
        OUTPUT INSERTED.id
        VALUES (@uuid, @serie, @folio, CONVERT(datetime2, @emision, 126), @limite, @periodo,
                @desde, @hasta, @subtotal, @iva, @total, @capturo)`)
    const facturaId = cab.recordset[0].id as number

    for (let i = 0; i < data.cruces.length; i += LOTE) {
      await insertarLote(tx, facturaId, data.cruces.slice(i, i + LOTE))
    }

    // Los tags que no estaban, sin unidad: así salen en el catálogo para que
    // alguien diga de quién son.
    await tx.request()
      .input('fid', sql.Int, facturaId)
      .query(`
        INSERT INTO tags_casetas (tag)
        SELECT DISTINCT c.tag
        FROM facturas_casetas_cruces c
        WHERE c.factura_id = @fid
          AND NOT EXISTS (SELECT 1 FROM tags_casetas t WHERE t.tag = c.tag)`)

    await tx.request()
      .input('fid', sql.Int, facturaId)
      .query(`
        UPDATE c SET vehiculo_id = t.vehiculo_id
        FROM facturas_casetas_cruces c
        JOIN tags_casetas t ON t.tag = c.tag
        WHERE c.factura_id = @fid`)

    await tx.commit()
    return facturaId
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

async function insertarLote(tx: sql.Transaction, facturaId: number, cruces: Cruce[]) {
  const req = tx.request().input('fid', sql.Int, facturaId)
  const valores = cruces.map((c, i) => {
    req.input(`r${i}`,  sql.Int,             c.renglon)
    req.input(`t${i}`,  sql.NVarChar(30),    c.tag)
    req.input(`f${i}`,  sql.NVarChar(19),    c.fecha_hora)
    req.input(`e${i}`,  sql.NVarChar(20),    c.evento)
    req.input(`ca${i}`, sql.NVarChar(10),    c.carril)
    req.input(`k${i}`,  sql.NVarChar(10),    c.caseta)
    req.input(`d${i}`,  sql.NVarChar(100),   c.descripcion)
    req.input(`cl${i}`, sql.TinyInt,         c.clase)
    req.input(`im${i}`, sql.Decimal(18, 6),  c.importe)
    req.input(`iv${i}`, sql.Decimal(18, 6),  c.iva)
    req.input(`to${i}`, sql.Decimal(18, 2),  c.total)
    // La hora llega como texto y la convierte SQL Server: un `DateTime2` de
    // mssql pasaría por la zona horaria de la máquina y correría la hora fuera
    // de Azure. Es la hora de la caseta, sin zona.
    return `(@fid, @r${i}, @t${i}, CONVERT(datetime2(0), @f${i}, 126), @e${i}, @ca${i}, @k${i}, @d${i}, @cl${i}, @im${i}, @iv${i}, @to${i})`
  })
  await req.query(`
    INSERT INTO facturas_casetas_cruces
      (factura_id, renglon, tag, fecha_hora, evento, carril, caseta, descripcion,
       clase, importe, iva, total)
    VALUES ${valores.join(',\n')}`)
}

export async function cruces(facturaId: number): Promise<CruceRow[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT c.id, c.renglon, c.tag, c.vehiculo_id,
             CASE WHEN v.id IS NULL THEN NULL ELSE ${VEHICULO} END AS vehiculo,
             v.tipo AS tipo_vehiculo,
             CONVERT(varchar(19), c.fecha_hora, 126) AS fecha_hora,
             c.evento, c.carril, c.caseta, c.descripcion, c.clase,
             c.importe, c.iva, c.total
      FROM facturas_casetas_cruces c
      LEFT JOIN vehiculos v ON v.id = c.vehiculo_id
      LEFT JOIN modelos mo  ON mo.id = v.modelo_id
      WHERE c.factura_id = @id
      ORDER BY c.renglon`)
  return r.recordset as CruceRow[]
}

/** Cuántas veces cruzó un tag una caseta con una clase, en esta factura y en las demás. */
export interface HistorialTag {
  tag: string
  caseta: string
  clase: number
  /** Todas las facturas, esta incluida. */
  n: number
  /** Solo las otras facturas: lo que ya se sabía antes de esta. */
  n_otras: number
  /**
   * Lo más que ese tag ha pagado ahí con esa clase. Es contra lo que se mide un
   * cobro de otra clase: el promedio señalaba de más cuando dos clases cuestan lo
   * mismo en una caseta.
   */
  total_maximo: number
}

/**
 * La historia de los tags de esta factura, agrupada por caseta y clase.
 *
 * Es de lo que salen la clase habitual de cada tag en cada caseta y las casetas
 * que un tag no suele cruzar. Se agrupa en la base para no traer años de cruces.
 */
export async function historialDeTags(facturaId: number): Promise<HistorialTag[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT c.tag, c.caseta, c.clase,
             COUNT(*) AS n,
             SUM(CASE WHEN c.factura_id <> @id THEN 1 ELSE 0 END) AS n_otras,
             MAX(c.total) AS total_maximo
      FROM facturas_casetas_cruces c
      WHERE c.tag IN (SELECT DISTINCT tag FROM facturas_casetas_cruces WHERE factura_id = @id)
      GROUP BY c.tag, c.caseta, c.clase`)
  return r.recordset as HistorialTag[]
}

/** Un cruce de esta factura que otra factura ya había cobrado. */
export interface CobradoAntes {
  renglon: number
  factura_id: number
  folio: string
  renglon_otra: number
}

/**
 * Los cruces de esta factura que ya estaban en otra: mismo tag, misma caseta y
 * misma hora al segundo. No hay dos cruces así; si aparece, PASE lo cobró dos
 * veces.
 */
export async function cobradosAntes(facturaId: number): Promise<CobradoAntes[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT c.renglon, o.factura_id, f.folio, o.renglon AS renglon_otra
      FROM facturas_casetas_cruces c
      JOIN facturas_casetas_cruces o
        ON o.tag = c.tag AND o.caseta = c.caseta AND o.fecha_hora = c.fecha_hora
       AND o.factura_id <> c.factura_id
      JOIN facturas_casetas f ON f.id = o.factura_id
      WHERE c.factura_id = @id`)
  return r.recordset as CobradoAntes[]
}

export async function revisar(id: number, quien: string, nota: string | null): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',    sql.Int,           id)
    .input('quien', sql.NVarChar(120), quien)
    .input('nota',  sql.NVarChar(255), nota)
    .query(`
      UPDATE facturas_casetas
      SET revisada_en = SYSUTCDATETIME(), revisada_por = @quien, nota = @nota
      WHERE id = @id AND revisada_en IS NULL`)
  return (r.rowsAffected[0] ?? 0) > 0
}

export async function reabrir(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      UPDATE facturas_casetas
      SET revisada_en = NULL, revisada_por = NULL
      WHERE id = @id AND revisada_en IS NOT NULL`)
  return (r.rowsAffected[0] ?? 0) > 0
}

// ── Los tags ─────────────────────────────────────────────────────────────────

export interface TagRow {
  id: number
  tag: string
  vehiculo_id: number | null
  vehiculo: string | null
  tipo_vehiculo: string | null
  nota: string | null
  cruces: number
  total: number
  ultimo_cruce: string | null
}

const SELECT_TAG = `
  SELECT t.id, t.tag, t.vehiculo_id,
         CASE WHEN v.id IS NULL THEN NULL ELSE ${VEHICULO} END AS vehiculo,
         v.tipo AS tipo_vehiculo, t.nota,
         COALESCE(s.cruces, 0) AS cruces,
         COALESCE(s.total, 0) AS total,
         CONVERT(varchar(19), s.ultimo, 126) AS ultimo_cruce
  FROM tags_casetas t
  LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
  LEFT JOIN modelos mo  ON mo.id = v.modelo_id
  OUTER APPLY (
    SELECT COUNT(*) AS cruces, SUM(c.total) AS total, MAX(c.fecha_hora) AS ultimo
    FROM facturas_casetas_cruces c WHERE c.tag = t.tag
  ) s
`

export async function tags(): Promise<TagRow[]> {
  const pool = await getPool()
  // Los que no tienen unidad, primero: son lo que hay que resolver.
  const r = await pool.request().query(`
    ${SELECT_TAG}
    ORDER BY CASE WHEN t.vehiculo_id IS NULL THEN 0 ELSE 1 END, t.tag`)
  return r.recordset as TagRow[]
}

export async function findTag(id: number): Promise<TagRow | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_TAG} WHERE t.id = @id`)
  return (r.recordset[0] as TagRow) ?? null
}

export async function findTagPorNombre(tag: string): Promise<{ id: number } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('tag', sql.NVarChar(30), tag)
    .query('SELECT id FROM tags_casetas WHERE tag = @tag')
  return (r.recordset[0] as { id: number }) ?? null
}

export async function crearTag(
  tag: string, vehiculoId: number | null, nota: string | null,
): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('tag',  sql.NVarChar(30),  tag)
    .input('vid',  sql.Int,           vehiculoId)
    .input('nota', sql.NVarChar(255), nota)
    .query(`
      INSERT INTO tags_casetas (tag, vehiculo_id, nota)
      OUTPUT INSERTED.id
      VALUES (@tag, @vid, @nota)`)
  return r.recordset[0].id as number
}

/**
 * Cambia la unidad del tag y le pone esa unidad a sus cruces que no tenían
 * ninguna. Los que ya tenían una se quedan con ella: eran de la unidad que
 * traía el tag entonces.
 *
 * Devuelve cuántos cruces se ligaron.
 */
export async function actualizarTag(
  id: number, vehiculoId: number | null, nota: string | null,
): Promise<number> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request()
      .input('id',   sql.Int,           id)
      .input('vid',  sql.Int,           vehiculoId)
      .input('nota', sql.NVarChar(255), nota)
      .query('UPDATE tags_casetas SET vehiculo_id = @vid, nota = @nota WHERE id = @id')

    let ligados = 0
    if (vehiculoId !== null) {
      const r = await tx.request()
        .input('id',  sql.Int, id)
        .input('vid', sql.Int, vehiculoId)
        .query(`
          UPDATE c SET vehiculo_id = @vid
          FROM facturas_casetas_cruces c
          JOIN tags_casetas t ON t.tag = c.tag
          WHERE t.id = @id AND c.vehiculo_id IS NULL`)
      ligados = r.rowsAffected[0] ?? 0
    }

    await tx.commit()
    return ligados
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

export async function existeVehiculo(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS si FROM vehiculos WHERE id = @id')
  return r.recordset.length > 0
}
