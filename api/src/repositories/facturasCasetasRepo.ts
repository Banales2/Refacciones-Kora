import * as sql from 'mssql'
import { getPool } from '../shared/db'
import type {
  Cruce, FacturaCasetasImport, TarifaCreate, TarifaUpdate, TramoCreate,
} from '../schemas/facturaCasetasSchema'

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
  serie: string | null
  folio: string
  periodo: string | null
  fecha_emision: string
  /** Si la otra factura ya se marcó como revisada: quizá ya se reclamó ahí. */
  revisada: boolean
  renglon_otra: number
  fecha_hora_otra: string
  clase_otra: number
  total_otra: number
}

/**
 * Los cruces de esta factura que ya estaban en otra: mismo tag, misma caseta y
 * misma hora al segundo. No hay dos cruces así; si aparece, PASE lo cobró dos
 * veces.
 *
 * Los ajustes no cuentan, de ningún lado: PASE fecha el ajuste con la hora del
 * cruce que corrige, así que se veían como el mismo cruce cobrado dos veces.
 */
export async function cobradosAntes(facturaId: number): Promise<CobradoAntes[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT c.renglon, o.factura_id, f.serie, f.folio, f.periodo,
             CONVERT(varchar(19), f.fecha_emision, 126) AS fecha_emision,
             CAST(CASE WHEN f.revisada_en IS NULL THEN 0 ELSE 1 END AS bit) AS revisada,
             o.renglon AS renglon_otra,
             CONVERT(varchar(19), o.fecha_hora, 126) AS fecha_hora_otra,
             o.clase AS clase_otra, o.total AS total_otra
      FROM facturas_casetas_cruces c
      JOIN facturas_casetas_cruces o
        ON o.tag = c.tag AND o.caseta = c.caseta AND o.fecha_hora = c.fecha_hora
       AND o.factura_id <> c.factura_id
       AND o.clase > 0 AND o.descripcion NOT LIKE 'AJUSTE%'
      JOIN facturas_casetas f ON f.id = o.factura_id
      WHERE c.factura_id = @id
        AND c.clase > 0 AND c.descripcion NOT LIKE 'AJUSTE%'
      ORDER BY c.renglon, f.fecha_emision`)
  return r.recordset as CobradoAntes[]
}

/** Un cruce de otra factura, del mismo tag, cerca de los de esta. */
export interface CruceVecino {
  factura_id: number
  serie: string | null
  folio: string
  renglon: number
  tag: string
  fecha_hora: string
  caseta: string
  descripcion: string
  clase: number
  total: number
}

/**
 * Los cruces de los tags de esta factura que vinieron en otras, hasta `horas`
 * antes del primero o después del último de esta. Un recorrido que empieza el
 * último día del periodo sigue en la factura siguiente. Sin ajustes ni los que
 * repiten un cruce de esta factura (ese es "Ya cobrado en otra factura").
 */
export async function crucesVecinos(facturaId: number, horas: number): Promise<CruceVecino[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .input('horas', sql.Int, horas)
    .query(`
      WITH esta AS (
        SELECT tag, MIN(fecha_hora) AS desde, MAX(fecha_hora) AS hasta
        FROM facturas_casetas_cruces WHERE factura_id = @id GROUP BY tag
      )
      SELECT o.factura_id, f.serie, f.folio, o.renglon, o.tag,
             CONVERT(varchar(19), o.fecha_hora, 126) AS fecha_hora,
             o.caseta, o.descripcion, o.clase, o.total
      FROM facturas_casetas_cruces o
      JOIN esta e ON e.tag = o.tag
      JOIN facturas_casetas f ON f.id = o.factura_id
      WHERE o.factura_id <> @id
        AND o.fecha_hora BETWEEN DATEADD(hour, -@horas, e.desde) AND DATEADD(hour, @horas, e.hasta)
        AND o.clase > 0 AND o.descripcion NOT LIKE 'AJUSTE%'
        AND NOT EXISTS (
          SELECT 1 FROM facturas_casetas_cruces c
          WHERE c.factura_id = @id AND c.tag = o.tag AND c.caseta = o.caseta
            AND c.fecha_hora = o.fecha_hora)
      ORDER BY o.tag, o.fecha_hora, f.fecha_emision`)
  return r.recordset as CruceVecino[]
}

/** Un cruce que un ajuste de esta factura puede estar corrigiendo. */
export interface CandidatoDeAjuste {
  /** La partida del ajuste, en esta factura. */
  renglon: number
  factura_id: number
  serie: string | null
  folio: string
  renglon_original: number
  fecha_hora: string
  clase: number
  total: number
  /** Qué tan lejos está del ajuste: el más cercano es el más probable. */
  segundos: number
}

/**
 * Los cruces que cada ajuste de esta factura puede corregir: del mismo tag, en
 * la misma caseta, en cualquier factura, de los 15 días antes del ajuste (o del
 * día siguiente). PASE fecha el ajuste con la hora del cruce que corrige, así
 * que el de `segundos = 0` es el original; los demás quedan para cuando no hay
 * uno a la misma hora y las tarifas dicen cuál costó la clase baja.
 */
export async function candidatosDeAjustes(facturaId: number): Promise<CandidatoDeAjuste[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT a.renglon, o.factura_id, f.serie, f.folio, o.renglon AS renglon_original,
             CONVERT(varchar(19), o.fecha_hora, 126) AS fecha_hora, o.clase, o.total,
             ABS(DATEDIFF(second, o.fecha_hora, a.fecha_hora)) AS segundos
      FROM facturas_casetas_cruces a
      JOIN facturas_casetas_cruces o
        ON o.tag = a.tag AND o.caseta = a.caseta AND o.clase > 0
       AND o.descripcion NOT LIKE 'AJUSTE%'
       AND o.fecha_hora BETWEEN DATEADD(day, -15, a.fecha_hora) AND DATEADD(day, 1, a.fecha_hora)
      JOIN facturas_casetas f ON f.id = o.factura_id
      WHERE a.factura_id = @id AND (a.clase = 0 OR a.descripcion LIKE 'AJUSTE%')
      ORDER BY a.renglon, segundos`)
  return r.recordset as CandidatoDeAjuste[]
}

/** Un cruce de esta factura que PASE corrigió con un ajuste en otra. */
export interface AjusteDeCruce {
  renglon: number
  factura_id: number
  serie: string | null
  folio: string
  renglon_ajuste: number
  total_ajuste: number
}

/**
 * Los ajustes de OTRAS facturas a cruces de esta: mismo tag, misma caseta y la
 * misma hora al segundo. Es la vuelta del ajuste: en la factura del cruce
 * original no se veía que después llegó la corrección.
 */
export async function ajustesDeCruces(facturaId: number): Promise<AjusteDeCruce[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT c.renglon, a.factura_id, f.serie, f.folio,
             a.renglon AS renglon_ajuste, a.total AS total_ajuste
      FROM facturas_casetas_cruces c
      JOIN facturas_casetas_cruces a
        ON a.tag = c.tag AND a.caseta = c.caseta AND a.fecha_hora = c.fecha_hora
       AND a.factura_id <> c.factura_id
       AND (a.clase = 0 OR a.descripcion LIKE 'AJUSTE%')
      JOIN facturas_casetas f ON f.id = a.factura_id
      WHERE c.factura_id = @id AND c.clase > 0 AND c.descripcion NOT LIKE 'AJUSTE%'
      ORDER BY c.renglon, f.fecha_emision`)
  return r.recordset as AjusteDeCruce[]
}

/**
 * Las clasificaciones, una por número de ejes: cada operador agrupa los ejes a
 * su modo (IDEAL 2-4/5-6/7-9, Jala - Compostela 2-3/4-5/6-9) y por eje cabe
 * cualquiera. Ver `db/migrations/072_tarifas_por_eje.sql`.
 */
export const CATEGORIAS = [
  'moto', 'auto', 'autobus_2', 'autobus_3', 'autobus_4',
  'camion_2', 'camion_3', 'camion_4', 'camion_5', 'camion_6', 'camion_7', 'camion_8', 'camion_9',
  'eje_ligero', 'eje_pesado',
] as const
export type Categoria = typeof CATEGORIAS[number]

/** Las columnas de tarifa con su alias, para los SELECT. */
const COLUMNAS_TARIFA = CATEGORIAS.map((c) => `ta.${c}`).join(', ')

/** Un tramo que una caseta puede cobrar, con una de sus vigencias. */
export type TarifaTramo = {
  caseta: string
  /** La caseta no manda la clase real (EASYTRIP): se compara contra todas. */
  ignora_clase: boolean
  tramo_id: number
  autopista: string
  tramo: string
  vigente_desde: string
} & Record<Categoria, number | null>

/**
 * Las tarifas de los tramos que pueden cobrar las casetas de esta factura,
 * todas las vigencias: la que aplica a cada cruce depende de su fecha, y eso lo
 * decide el service. Ver `db/migrations/071_tarifas_de_casetas.sql`.
 */
export async function tarifasDeFactura(facturaId: number): Promise<TarifaTramo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT ct.caseta, CAST(ISNULL(cp.ignora_clase, 0) AS bit) AS ignora_clase,
             t.id AS tramo_id, t.autopista, t.nombre AS tramo,
             CONVERT(char(10), ta.vigente_desde, 23) AS vigente_desde,
             ${COLUMNAS_TARIFA}
      FROM casetas_tramos ct
      JOIN tramos_casetas t   ON t.id = ct.tramo_id
      JOIN tarifas_casetas ta ON ta.tramo_id = t.id
      LEFT JOIN casetas_pase cp ON cp.caseta = ct.caseta
      WHERE ct.caseta IN (SELECT DISTINCT caseta FROM facturas_casetas_cruces WHERE factura_id = @id)`)
  return r.recordset as TarifaTramo[]
}

/** Una caseta de PASE: las que tienen tarifa y las que han salido en una factura. */
export interface CasetaRow {
  caseta: string
  /** Como la imprime PASE en el cruce más reciente; null si nunca ha salido en una factura. */
  nombre: string | null
  ignora_clase: boolean
  cruces: number
  total: number
}

export async function casetas(): Promise<CasetaRow[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    WITH vistas AS (
      SELECT caseta, COUNT(*) AS cruces, SUM(total) AS total
      FROM facturas_casetas_cruces
      WHERE clase > 0 AND descripcion NOT LIKE 'AJUSTE%'
      GROUP BY caseta
    ), nombres AS (
      SELECT caseta, descripcion,
             ROW_NUMBER() OVER (PARTITION BY caseta ORDER BY fecha_hora DESC) AS n
      FROM facturas_casetas_cruces
      WHERE descripcion NOT LIKE 'AJUSTE%'
    ), codigos AS (
      SELECT caseta FROM vistas UNION SELECT caseta FROM casetas_tramos
    )
    SELECT k.caseta, n.descripcion AS nombre,
           CAST(ISNULL(cp.ignora_clase, 0) AS bit) AS ignora_clase,
           ISNULL(v.cruces, 0) AS cruces, ISNULL(v.total, 0) AS total
    FROM codigos k
    LEFT JOIN vistas v  ON v.caseta = k.caseta
    LEFT JOIN nombres n ON n.caseta = k.caseta AND n.n = 1
    LEFT JOIN casetas_pase cp ON cp.caseta = k.caseta`)
  return r.recordset as CasetaRow[]
}

/** Las casetas que no mandan la clase real (EASYTRIP): su clase no dice nada del vehículo. */
export async function casetasSinClase(): Promise<Set<string>> {
  const pool = await getPool()
  const r = await pool.request().query('SELECT caseta FROM casetas_pase WHERE ignora_clase = 1')
  return new Set((r.recordset as { caseta: string }[]).map((x) => x.caseta))
}

/** Marca (o desmarca) que una caseta no manda la clase real. */
export async function guardarIgnoraClase(caseta: string, ignora: boolean): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('caseta', sql.NVarChar(10), caseta)
    .input('ignora', sql.Bit, ignora)
    .query(`
      UPDATE casetas_pase SET ignora_clase = @ignora WHERE caseta = @caseta;
      IF @@ROWCOUNT = 0
        INSERT INTO casetas_pase (caseta, ignora_clase) VALUES (@caseta, @ignora);`)
}

/** Con el id de la vigencia: es lo que se corrige al editar. */
export type TarifaVigente = Omit<TarifaTramo, 'ignora_clase'> & { tarifa_id: number; vigencias: number }

/**
 * La tarifa de hoy de cada tramo que cada caseta cobra. Si un tramo solo tiene
 * vigencias futuras, sale la más próxima.
 */
export async function tarifasVigentes(): Promise<TarifaVigente[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT ct.caseta, t.id AS tramo_id, t.autopista, t.nombre AS tramo, ta.id AS tarifa_id,
           (SELECT COUNT(*) FROM tarifas_casetas v WHERE v.tramo_id = t.id) AS vigencias,
           CONVERT(char(10), ta.vigente_desde, 23) AS vigente_desde,
           ${COLUMNAS_TARIFA}
    FROM casetas_tramos ct
    JOIN tramos_casetas t ON t.id = ct.tramo_id
    CROSS APPLY (
      SELECT TOP 1 x.*
      FROM tarifas_casetas x
      WHERE x.tramo_id = t.id
      ORDER BY CASE WHEN x.vigente_desde <= CAST(SYSDATETIME() AS date) THEN 0 ELSE 1 END,
               CASE WHEN x.vigente_desde <= CAST(SYSDATETIME() AS date) THEN x.vigente_desde END DESC,
               x.vigente_desde
    ) ta
    ORDER BY ct.caseta, t.autopista, t.nombre`)
  return r.recordset as TarifaVigente[]
}

export type TarifaRow = {
  id: number
  tramo_id: number
  autopista: string
  tramo: string
  vigente_desde: string
} & Record<Categoria, number | null>

export async function findTarifa(id: number): Promise<TarifaRow | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT ta.id, ta.tramo_id, t.autopista, t.nombre AS tramo,
             CONVERT(char(10), ta.vigente_desde, 23) AS vigente_desde,
             ${COLUMNAS_TARIFA}
      FROM tarifas_casetas ta
      JOIN tramos_casetas t ON t.id = ta.tramo_id
      WHERE ta.id = @id`)
  return (r.recordset[0] as TarifaRow) ?? null
}

export async function existeTramo(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS x FROM tramos_casetas WHERE id = @id')
  return r.recordset.length > 0
}

function inputsTarifa(req: sql.Request, d: TarifaUpdate): sql.Request {
  req.input('desde', sql.Date, d.vigente_desde)
  for (const c of CATEGORIAS) req.input(c, sql.Decimal(10, 2), d[c])
  return req
}

const INSERT_TARIFA = `
  INSERT INTO tarifas_casetas (tramo_id, vigente_desde, ${CATEGORIAS.join(', ')})
  OUTPUT INSERTED.id
  VALUES (@tramo, @desde, ${CATEGORIAS.map((c) => `@${c}`).join(', ')})`

export async function actualizarTarifa(id: number, d: TarifaUpdate): Promise<void> {
  const pool = await getPool()
  await inputsTarifa(pool.request().input('id', sql.Int, id), d).query(`
    UPDATE tarifas_casetas
    SET vigente_desde = @desde, ${CATEGORIAS.map((c) => `${c} = @${c}`).join(', ')}
    WHERE id = @id`)
}

export async function crearTarifa(d: TarifaCreate): Promise<number> {
  const pool = await getPool()
  const r = await inputsTarifa(pool.request().input('tramo', sql.Int, d.tramo_id), d)
    .query(INSERT_TARIFA)
  return r.recordset[0].id as number
}

/** Un tramo del catálogo, con las casetas de PASE que lo cobran (puede no tener). */
export interface TramoRow {
  id: number
  autopista: string
  nombre: string
  casetas: string[]
}

export async function tramos(): Promise<TramoRow[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT t.id, t.autopista, t.nombre,
           ISNULL((SELECT STRING_AGG(ct.caseta, ',') FROM casetas_tramos ct WHERE ct.tramo_id = t.id), '') AS casetas
    FROM tramos_casetas t
    ORDER BY t.autopista, t.nombre`)
  return (r.recordset as (Omit<TramoRow, 'casetas'> & { casetas: string })[])
    .map((t) => ({ ...t, casetas: t.casetas ? t.casetas.split(',') : [] }))
}

/** Liga un tramo que ya existe a una caseta. Devuelve false si ya estaba ligado. */
export async function ligarTramo(caseta: string, tramoId: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('caseta', sql.NVarChar(10), caseta)
    .input('tramo',  sql.Int,          tramoId)
    .query(`
      INSERT INTO casetas_tramos (caseta, tramo_id)
      SELECT @caseta, @tramo
      WHERE NOT EXISTS (SELECT 1 FROM casetas_tramos WHERE caseta = @caseta AND tramo_id = @tramo)`)
  return (r.rowsAffected[0] ?? 0) > 0
}

/** El tramo, las casetas que lo cobran y su primera tarifa, juntos o nada. */
export async function crearTramo(d: TramoCreate): Promise<{ tramo_id: number; tarifa_id: number }> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const t = await tx.request()
      .input('autopista', sql.NVarChar(80),  d.autopista)
      .input('nombre',    sql.NVarChar(120), d.nombre)
      .query(`
        INSERT INTO tramos_casetas (autopista, nombre)
        OUTPUT INSERTED.id
        VALUES (@autopista, @nombre)`)
    const tramoId = t.recordset[0].id as number
    for (const caseta of new Set(d.casetas)) {
      await tx.request()
        .input('caseta', sql.NVarChar(10), caseta)
        .input('tramo',  sql.Int,          tramoId)
        .query('INSERT INTO casetas_tramos (caseta, tramo_id) VALUES (@caseta, @tramo)')
    }
    const ta = await inputsTarifa(tx.request().input('tramo', sql.Int, tramoId), d)
      .query(INSERT_TARIFA)
    await tx.commit()
    return { tramo_id: tramoId, tarifa_id: ta.recordset[0].id as number }
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/** Lo que se ha cobrado en cada caseta, agrupado por clase e importe. */
export async function importesCobrados(): Promise<{ caseta: string; clase: number; total: number; n: number }[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT caseta, clase, total, COUNT(*) AS n
    FROM facturas_casetas_cruces
    WHERE clase > 0 AND descripcion NOT LIKE 'AJUSTE%'
    GROUP BY caseta, clase, total`)
  return r.recordset as { caseta: string; clase: number; total: number; n: number }[]
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
