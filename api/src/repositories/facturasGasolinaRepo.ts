import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Las facturas de la gasolinera y a qué recarga corresponde cada ticket.
//
// La factura SÍ viene desglosada: un renglón por ticket, con sus litros, su
// precio unitario y su importe. Lo que no trae es a qué vehículo fue, qué chofer
// la hizo ni contra qué vale — eso solo lo sabe el sistema. Conciliar es casar
// cada renglón del papel con su recarga.
//
// SE CASA POR LITROS, NO POR IMPORTE. El importe del renglón es sin IVA (los
// renglones suman el subtotal, no el total) y `recargas_combustible.costo` es lo
// que se pagó en la bomba, que sí lo incluye: compararlos da 16% de diferencia
// siempre. Los litros son el mismo número de los dos lados.
//
// Ver `db/migrations/041_facturas_de_gasolina.sql`.

export interface FacturaGasolina {
  id: number
  gasolinera_id: number
  gasolinera: string
  serie: string | null
  folio: string
  fecha: string
  subtotal: number
  iva: number
  total: number
  uuid: string | null
  capturado_por: string
  conciliada_en: string | null
  conciliada_por: string | null
  nota: string | null
  /** Cuántos tickets trae el papel. */
  renglones: number
  /** Cuántos de esos ya casaron con una recarga. */
  casados: number
  /** Litros que la factura dice haber despachado. */
  litros_factura: number
}

export interface RenglonFactura {
  id: number
  ticket: string | null
  producto: string | null
  litros: number
  precio_unitario: number | null
  /** Sin IVA, como lo emite el CFDI. */
  importe: number
  recarga_id: number | null
  metodo: 'ticket' | 'litros' | 'manual' | null
  // Lo de la recarga casada, para enseñarlo junto al renglón.
  recarga_fecha: string | null
  recarga_litros: number | null
  /** Lo que se pagó en la bomba: CON IVA. No es comparable con `importe`. */
  recarga_costo: number | null
  vehiculo: string | null
  conductor: string | null
  vale_folio: string | null
}

/** Una recarga que podría corresponder a algún renglón de la factura. */
export interface RecargaCandidata {
  id: number
  fecha: string
  litros: number
  costo: number
  ticket: string | null
  vehiculo: string
  conductor: string
  vale_folio: string | null
}

const SELECT_FACTURA = `
  SELECT f.id, f.gasolinera_id, g.nombre AS gasolinera, f.serie, f.folio,
         CONVERT(char(10), f.fecha, 23) AS fecha,
         f.subtotal, f.iva, f.total, f.uuid, f.capturado_por,
         CONVERT(varchar(19), f.conciliada_en, 126) AS conciliada_en,
         f.conciliada_por, f.nota,
         (SELECT COUNT(*) FROM facturas_gasolina_renglones r
           WHERE r.factura_id = f.id) AS renglones,
         (SELECT COUNT(*) FROM facturas_gasolina_renglones r
           WHERE r.factura_id = f.id AND r.recarga_id IS NOT NULL) AS casados,
         COALESCE((SELECT SUM(r.litros) FROM facturas_gasolina_renglones r
                   WHERE r.factura_id = f.id), 0) AS litros_factura
  FROM facturas_gasolina f
  JOIN gasolineras g ON g.id = f.gasolinera_id
`

export interface FacturaGasolinaQuery {
  page: number
  pageSize: number
  gasolinera_id?: number
  search?: string
  desde?: string
  hasta?: string
  por_conciliar?: boolean
}

export async function findAll(
  p: FacturaGasolinaQuery,
): Promise<{ data: FacturaGasolina[]; total: number }> {
  const pool = await getPool()
  const req = pool.request()
    .input('offset', sql.Int, (p.page - 1) * p.pageSize)
    .input('pageSize', sql.Int, p.pageSize)

  const where: string[] = []
  if (p.gasolinera_id) {
    req.input('gid', sql.Int, p.gasolinera_id)
    where.push('f.gasolinera_id = @gid')
  }
  if (p.search) {
    req.input('search', `%${p.search}%`)
    where.push('(f.folio LIKE @search OR g.nombre LIKE @search)')
  }
  if (p.desde) { req.input('desde', sql.Date, p.desde); where.push('f.fecha >= @desde') }
  if (p.hasta) { req.input('hasta', sql.Date, p.hasta); where.push('f.fecha <= @hasta') }
  if (p.por_conciliar) where.push('f.conciliada_en IS NULL')
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const r = await req.query(`
    ${SELECT_FACTURA}
    ${filtro}
    ORDER BY f.fecha DESC, f.id DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(*) AS total
    FROM facturas_gasolina f
    JOIN gasolineras g ON g.id = f.gasolinera_id
    ${filtro};
  `)

  return {
    data: r.recordsets[0] as unknown as FacturaGasolina[],
    total: (r.recordsets[1] as unknown as { total: number }[])[0].total,
  }
}

export async function findById(id: number): Promise<FacturaGasolina | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_FACTURA} WHERE f.id = @id`)
  return (r.recordset[0] as FacturaGasolina) ?? null
}

export interface RenglonNuevo {
  ticket?: string | null
  producto?: string | null
  litros: number
  precio_unitario?: number | null
  importe: number
}

export interface FacturaGasolinaNueva {
  gasolinera_id: number
  serie?: string | null
  folio: string
  fecha: string
  subtotal: number
  iva: number
  total: number
  uuid?: string | null
  renglones: RenglonNuevo[]
}

/** La cabecera y sus renglones, en una transacción: media factura no sirve. */
export async function crear(
  data: FacturaGasolinaNueva, capturadoPor: string,
): Promise<number> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const cab = await tx.request()
      .input('gid',      sql.Int,            data.gasolinera_id)
      .input('serie',    sql.NVarChar(10),   data.serie ?? null)
      .input('folio',    sql.NVarChar(30),   data.folio)
      .input('fecha',    sql.Date,           data.fecha)
      .input('subtotal', sql.Decimal(18, 2), data.subtotal)
      .input('iva',      sql.Decimal(18, 2), data.iva)
      .input('total',    sql.Decimal(18, 2), data.total)
      .input('uuid',     sql.NVarChar(36),   data.uuid ?? null)
      .input('capturo',  sql.NVarChar(120),  capturadoPor)
      .query(`
        INSERT INTO facturas_gasolina
          (gasolinera_id, serie, folio, fecha, subtotal, iva, total, uuid, capturado_por)
        OUTPUT INSERTED.id
        VALUES (@gid, @serie, @folio, @fecha, @subtotal, @iva, @total, @uuid, @capturo)`)
    const facturaId = cab.recordset[0].id as number

    for (const r of data.renglones) {
      await tx.request()
        .input('fid',     sql.Int,            facturaId)
        .input('ticket',  sql.NVarChar(40),   r.ticket ?? null)
        .input('prod',    sql.NVarChar(40),   r.producto ?? null)
        .input('litros',  sql.Decimal(10, 3), r.litros)
        .input('precio',  sql.Decimal(18, 4), r.precio_unitario ?? null)
        .input('importe', sql.Decimal(18, 2), r.importe)
        .query(`
          INSERT INTO facturas_gasolina_renglones
            (factura_id, ticket, producto, litros, precio_unitario, importe)
          VALUES (@fid, @ticket, @prod, @litros, @precio, @importe)`)
    }

    await tx.commit()
    return facturaId
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

export async function findByFolio(
  gasolineraId: number, serie: string | null, folio: string,
): Promise<{ id: number } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('gid',   sql.Int,          gasolineraId)
    .input('serie', sql.NVarChar(10), serie)
    .input('folio', sql.NVarChar(30), folio)
    .query(`
      SELECT id FROM facturas_gasolina
      WHERE gasolinera_id = @gid AND folio = @folio
        AND (serie = @serie OR (serie IS NULL AND @serie IS NULL))`)
  return r.recordset[0] ?? null
}

export async function findByUuid(uuid: string): Promise<{ id: number; folio: string } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('uuid', sql.NVarChar(36), uuid)
    .query('SELECT id, folio FROM facturas_gasolina WHERE uuid = @uuid')
  return r.recordset[0] ?? null
}

/** Los renglones de la factura con lo que se sepa de su recarga casada. */
export async function renglones(facturaId: number): Promise<RenglonFactura[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT fr.id, fr.ticket, fr.producto, fr.litros, fr.precio_unitario,
             fr.importe, fr.recarga_id, fr.metodo,
             CONVERT(char(10), rc.fecha, 23) AS recarga_fecha,
             rc.litros AS recarga_litros, rc.costo AS recarga_costo,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             co.nombre AS conductor, vg.folio AS vale_folio
      FROM facturas_gasolina_renglones fr
      LEFT JOIN recargas_combustible rc ON rc.id = fr.recarga_id
      LEFT JOIN vehiculos    v  ON v.id  = rc.vehiculo_id
      LEFT JOIN modelos      mo ON mo.id = v.modelo_id
      LEFT JOIN conductores  co ON co.id = rc.conductor_id
      LEFT JOIN vales_gasolina vg ON vg.id = rc.vale_id
      WHERE fr.factura_id = @id
      ORDER BY fr.id`)
  return r.recordset as RenglonFactura[]
}

/**
 * Las recargas que algún renglón de esta factura podría estar cobrando.
 *
 * Son las de su gasolinera, de su fecha hacia atrás, que NINGÚN renglón de
 * NINGUNA factura haya reclamado ya — más las que esta misma tiene casadas, para
 * que al volver sigan apareciendo.
 *
 * El corte por fecha es hacia atrás y sin límite inferior a propósito: una carga
 * de hace tres meses que nadie facturó sigue siendo candidata legítima, y poner
 * una ventana la escondería justo cuando aparece la factura atrasada que la
 * cobra.
 */
export async function candidatas(
  facturaId: number, limite = 400,
): Promise<RecargaCandidata[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',     sql.Int, facturaId)
    .input('limite', sql.Int, limite)
    .query(`
      SELECT TOP (@limite)
             rc.id, CONVERT(char(10), rc.fecha, 23) AS fecha,
             rc.litros, rc.costo, rc.ticket,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             co.nombre AS conductor, vg.folio AS vale_folio
      FROM recargas_combustible rc
      JOIN facturas_gasolina f ON f.id = @id
      JOIN vehiculos    v  ON v.id  = rc.vehiculo_id
      JOIN modelos      mo ON mo.id = v.modelo_id
      JOIN conductores  co ON co.id = rc.conductor_id
      LEFT JOIN vales_gasolina vg ON vg.id = rc.vale_id
      WHERE rc.gasolinera_id = f.gasolinera_id
        AND rc.fecha <= f.fecha
        AND NOT EXISTS (
          SELECT 1 FROM facturas_gasolina_renglones otro
          WHERE otro.recarga_id = rc.id AND otro.factura_id <> @id
        )
      ORDER BY rc.fecha DESC, rc.id DESC`)
  return r.recordset as RecargaCandidata[]
}

export interface Casado {
  renglon_id: number
  recarga_id: number | null
  metodo: 'ticket' | 'litros' | 'manual' | null
}

/**
 * Guarda a qué recarga corresponde cada renglón.
 *
 * Se sueltan todas primero y luego se asignan: lo que manda la pantalla es la
 * verdad completa, y calcular la diferencia contra lo que había solo agrega una
 * forma de equivocarse. El UNIQUE de `recarga_id` es quien impide de verdad que
 * dos renglones se lleven la misma carga.
 */
export async function guardarCasados(
  facturaId: number, casados: Casado[],
): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request()
      .input('id', sql.Int, facturaId)
      .query(`
        UPDATE facturas_gasolina_renglones
        SET recarga_id = NULL, metodo = NULL
        WHERE factura_id = @id`)

    for (const c of casados) {
      if (c.recarga_id === null) continue
      await tx.request()
        .input('rid',    sql.Int,          c.renglon_id)
        .input('fid',    sql.Int,          facturaId)
        .input('rec',    sql.Int,          c.recarga_id)
        .input('metodo', sql.NVarChar(10), c.metodo ?? 'manual')
        .query(`
          UPDATE facturas_gasolina_renglones
          SET recarga_id = @rec, metodo = @metodo
          WHERE id = @rid AND factura_id = @fid`)
    }

    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

export async function sellar(
  facturaId: number, quien: string, nota: string | null,
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',    sql.Int,           facturaId)
    .input('quien', sql.NVarChar(120), quien)
    .input('nota',  sql.NVarChar(255), nota)
    .query(`
      UPDATE facturas_gasolina
      SET conciliada_en = SYSUTCDATETIME(), conciliada_por = @quien, nota = @nota
      WHERE id = @id AND conciliada_en IS NULL`)
  return (r.rowsAffected[0] ?? 0) > 0
}

export async function reabrir(facturaId: number): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      UPDATE facturas_gasolina
      SET conciliada_en = NULL, conciliada_por = NULL
      WHERE id = @id`)
}

/** La factura que ya cobra esa recarga, si alguna la reclamó. */
export async function facturaDeRecarga(
  recargaId: number,
): Promise<{ id: number; folio: string; conciliada: boolean } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, recargaId)
    .query(`
      SELECT f.id, f.folio,
             CAST(CASE WHEN f.conciliada_en IS NULL THEN 0 ELSE 1 END AS BIT) AS conciliada
      FROM facturas_gasolina_renglones fr
      JOIN facturas_gasolina f ON f.id = fr.factura_id
      WHERE fr.recarga_id = @id`)
  return r.recordset[0] ?? null
}
