import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Las facturas de la gasolinera y a qué recarga corresponde cada renglón.
//
// Esto NO guarda la factura: el documento se archiva por otro lado. Aquí solo
// vive lo necesario para comprobar que el gasto está bien capturado — de ahí que
// el renglón tenga descripción, cantidad e importe y nada más.
//
// Sigue el modelo de las facturas de refacciones (migración 026): cabecera con
// la tasa de IVA, renglones con lo suyo, y los importes CALCULADOS, no
// guardados. El subtotal sale de sumar los renglones.
//
// SE CASA POR CANTIDAD, NO POR IMPORTE. El importe del renglón suele venir sin
// IVA y `recargas_combustible.costo` es lo que se pagó en la bomba, que sí lo
// incluye: compararlos da 16% de diferencia siempre. Los litros son el mismo
// número de los dos lados.
//
// SE CASA CON EL TICKET, NO CON LA RECARGA. Un tráiler carga cada tanque aparte,
// la bomba imprime un ticket por tanque y la gasolinera los cobra en renglones
// —a veces en facturas— distintos. El renglón guarda también la recarga del
// ticket, que es por donde se pregunta "qué factura cobra esta recarga".
//
// Ver `db/migrations/041_facturas_de_gasolina.sql` y la 059.

export interface FacturaGasolina {
  id: number
  gasolinera_id: number
  gasolinera: string
  folio: string
  fecha: string
  /** `null` = los importes de los renglones ya incluyen IVA. Migración 020. */
  tasa_iva: number | null
  capturado_por: string
  conciliada_en: string | null
  conciliada_por: string | null
  nota: string | null
  /** Cuántos renglones trae el papel. */
  renglones: number
  /** Cuántos de esos ya casaron con una recarga. */
  casados: number
  /** Suma de los importes de los renglones. El total se calcula con la tasa. */
  subtotal: number
}

export interface RenglonFactura {
  id: number
  descripcion: string | null
  cantidad: number
  importe: number
  ticket_id: number | null
  recarga_id: number | null
  // Lo del ticket casado, para enseñarlo junto al renglón.
  recarga_fecha: string | null
  ticket_litros: number | null
  /** Lo que se pagó en la bomba. No es comparable con `importe` si hay tasa. */
  ticket_costo: number | null
  vehiculo: string | null
  conductor: string | null
  vale_folio: string | null
}

/** Un ticket que algún renglón podría estar cobrando. */
export interface TicketCandidato {
  /** El del ticket: es lo que se casa. */
  id: number
  recarga_id: number
  /** Cuál de los tickets de su recarga es (1, 2, 3) y cuántos trae. */
  ticket_n: number
  tickets: number
  fecha: string
  litros: number
  costo: number
  vehiculo: string
  conductor: string
  vale_folio: string | null
}

const SELECT_FACTURA = `
  SELECT f.id, f.gasolinera_id, g.nombre AS gasolinera, f.folio,
         CONVERT(char(10), f.fecha, 23) AS fecha,
         f.tasa_iva, f.capturado_por,
         CONVERT(varchar(19), f.conciliada_en, 126) AS conciliada_en,
         f.conciliada_por, f.nota,
         (SELECT COUNT(*) FROM facturas_gasolina_renglones r
           WHERE r.factura_id = f.id) AS renglones,
         (SELECT COUNT(*) FROM facturas_gasolina_renglones r
           WHERE r.factura_id = f.id AND r.recarga_id IS NOT NULL) AS casados,
         COALESCE((SELECT SUM(r.importe) FROM facturas_gasolina_renglones r
                   WHERE r.factura_id = f.id), 0) AS subtotal
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

export async function findByFolio(
  gasolineraId: number, folio: string,
): Promise<{ id: number } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('gid',   sql.Int,          gasolineraId)
    .input('folio', sql.NVarChar(30), folio)
    .query('SELECT id FROM facturas_gasolina WHERE gasolinera_id = @gid AND folio = @folio')
  return r.recordset[0] ?? null
}

export interface RenglonNuevo {
  /** Diesel, Magna o Premium. Lista cerrada, ver `facturaGasolinaSchema`. */
  descripcion: string
  cantidad: number
  importe: number
}

export interface FacturaGasolinaNueva {
  gasolinera_id: number
  folio: string
  fecha: string
  tasa_iva?: number | null
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
      .input('gid',     sql.Int,           data.gasolinera_id)
      .input('folio',   sql.NVarChar(30),  data.folio)
      .input('fecha',   sql.Date,          data.fecha)
      .input('tasa',    sql.Decimal(5, 2), data.tasa_iva ?? null)
      .input('capturo', sql.NVarChar(120), capturadoPor)
      .query(`
        INSERT INTO facturas_gasolina (gasolinera_id, folio, fecha, tasa_iva, capturado_por)
        OUTPUT INSERTED.id
        VALUES (@gid, @folio, @fecha, @tasa, @capturo)`)
    const facturaId = cab.recordset[0].id as number

    for (const r of data.renglones) {
      await tx.request()
        .input('fid',     sql.Int,            facturaId)
        .input('desc',    sql.NVarChar(100),  r.descripcion)
        .input('cant',    sql.Decimal(10, 3), r.cantidad)
        .input('importe', sql.Decimal(18, 2), r.importe)
        .query(`
          INSERT INTO facturas_gasolina_renglones (factura_id, descripcion, cantidad, importe)
          VALUES (@fid, @desc, @cant, @importe)`)
    }

    await tx.commit()
    return facturaId
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/** Los renglones de la factura con lo que se sepa de su recarga casada. */
export async function renglones(facturaId: number): Promise<RenglonFactura[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT fr.id, fr.descripcion, fr.cantidad, fr.importe, fr.ticket_id, fr.recarga_id,
             CONVERT(char(10), rc.fecha, 23) AS recarga_fecha,
             t.litros AS ticket_litros, t.costo AS ticket_costo,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             co.nombre AS conductor, vg.folio AS vale_folio
      FROM facturas_gasolina_renglones fr
      LEFT JOIN recargas_combustible_tickets t ON t.id = fr.ticket_id
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
 * Los tickets que algún renglón de esta factura podría estar cobrando.
 *
 * Son los de las recargas de su gasolinera, de su fecha hacia atrás, que ningún
 * renglón de ninguna OTRA factura haya reclamado — más los que esta misma tiene
 * casados, para que al volver sigan apareciendo.
 *
 * El corte por fecha no tiene límite inferior a propósito: una carga de hace
 * tres meses que nadie facturó sigue siendo candidata legítima, y poner una
 * ventana la escondería justo cuando aparece la factura atrasada que la cobra.
 */
export async function candidatas(
  facturaId: number, limite = 400,
): Promise<TicketCandidato[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',     sql.Int, facturaId)
    .input('limite', sql.Int, limite)
    .query(`
      SELECT TOP (@limite)
             t.id, t.recarga_id, t.ticket_n, t.tickets,
             CONVERT(char(10), rc.fecha, 23) AS fecha,
             t.litros, t.costo,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             co.nombre AS conductor, vg.folio AS vale_folio
      -- El número se cuenta antes del filtro: "ticket 2 de 3" no cambia
      -- porque el 1 ya lo cobre otra factura.
      FROM (
        SELECT id, recarga_id, litros, costo,
               ROW_NUMBER() OVER (PARTITION BY recarga_id ORDER BY id) AS ticket_n,
               COUNT(*) OVER (PARTITION BY recarga_id) AS tickets
        FROM recargas_combustible_tickets
      ) t
      JOIN recargas_combustible rc ON rc.id = t.recarga_id
      JOIN facturas_gasolina f ON f.id = @id
      JOIN vehiculos    v  ON v.id  = rc.vehiculo_id
      JOIN modelos      mo ON mo.id = v.modelo_id
      JOIN conductores  co ON co.id = rc.conductor_id
      LEFT JOIN vales_gasolina vg ON vg.id = rc.vale_id
      WHERE rc.gasolinera_id = f.gasolinera_id
        AND rc.fecha <= f.fecha
        AND NOT EXISTS (
          SELECT 1 FROM facturas_gasolina_renglones otro
          WHERE otro.ticket_id = t.id AND otro.factura_id <> @id
        )
      ORDER BY rc.fecha DESC, rc.id DESC, t.id`)
  return r.recordset.map((c) => ({
    ...c, litros: Number(c.litros), costo: Number(c.costo),
  })) as TicketCandidato[]
}

export interface Casado {
  renglon_id: number
  ticket_id: number | null
}

/**
 * Guarda a qué ticket corresponde cada renglón.
 *
 * Se sueltan todos primero y luego se asignan: lo que manda la pantalla es la
 * verdad completa, y calcular la diferencia contra lo que había solo agrega una
 * forma de equivocarse. El UNIQUE de `ticket_id` es quien impide de verdad que
 * dos renglones se lleven el mismo ticket. La recarga se copia del ticket.
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
        UPDATE facturas_gasolina_renglones SET ticket_id = NULL, recarga_id = NULL
        WHERE factura_id = @id`)

    for (const c of casados) {
      if (c.ticket_id === null) continue
      await tx.request()
        .input('rid', sql.Int, c.renglon_id)
        .input('fid', sql.Int, facturaId)
        .input('tid', sql.Int, c.ticket_id)
        .query(`
          UPDATE fr
          SET ticket_id = t.id, recarga_id = t.recarga_id
          FROM facturas_gasolina_renglones fr
          JOIN recargas_combustible_tickets t ON t.id = @tid
          WHERE fr.id = @rid AND fr.factura_id = @fid`)
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

/** Un ticket que ninguna factura ha cobrado. */
export interface RecargaSinFacturar {
  /** El del ticket. */
  id: number
  recarga_id: number
  /** Cuál de los tickets de su recarga es (1, 2, 3) y cuántos trae. */
  ticket_n: number
  tickets: number
  fecha: string
  gasolinera_id: number
  gasolinera: string
  litros: number
  costo: number
  vehiculo: string
  conductor: string
  vale_folio: string | null
  /** Días desde la carga. Es lo que dice si ya se tardó la factura. */
  dias: number
}

/**
 * Los tickets que ninguna factura ha reclamado todavía. Va por ticket y no por
 * recarga porque cada uno se factura aparte: una recarga de tres tanques puede
 * tener dos cobrados y uno pendiente.
 *
 * Es el reverso de "el renglón sin recarga": allá la gasolinera cobra algo que
 * no está capturado; aquí está capturado algo que la gasolinera no ha cobrado.
 * Lo segundo casi nunca es un problema —la factura llega después— pero una carga
 * de hace tres meses sin facturar sí lo es, y por eso se devuelve `dias`.
 *
 * NO se filtra por antigüedad: esconder lo viejo sería esconder justo lo que
 * hay que mirar.
 */
export async function recargasSinFacturar(p: {
  page: number
  pageSize: number
  gasolinera_id?: number
  search?: string
  desde?: string
  hasta?: string
}): Promise<{ data: RecargaSinFacturar[]; total: number; costo_total: number }> {
  const pool = await getPool()
  const req = pool.request()
    .input('offset', sql.Int, (p.page - 1) * p.pageSize)
    .input('pageSize', sql.Int, p.pageSize)

  const where = [
    `NOT EXISTS (SELECT 1 FROM facturas_gasolina_renglones fgr WHERE fgr.ticket_id = t.id)`,
  ]
  if (p.gasolinera_id) {
    req.input('gid', sql.Int, p.gasolinera_id)
    where.push('rc.gasolinera_id = @gid')
  }
  if (p.search) {
    req.input('search', `%${p.search}%`)
    where.push(`(g.nombre LIKE @search OR v.numero_serie LIKE @search
                 OR co.nombre LIKE @search OR vg.folio LIKE @search)`)
  }
  if (p.desde) { req.input('desde', sql.Date, p.desde); where.push('rc.fecha >= @desde') }
  if (p.hasta) { req.input('hasta', sql.Date, p.hasta); where.push('rc.fecha <= @hasta') }

  // `ticket_n` se cuenta antes del filtro: "ticket 2 de 3" no cambia porque
  // el 1 ya esté facturado.
  const joins = `
    FROM (
      SELECT id, recarga_id, litros, costo,
             ROW_NUMBER() OVER (PARTITION BY recarga_id ORDER BY id) AS ticket_n,
             COUNT(*) OVER (PARTITION BY recarga_id) AS tickets
      FROM recargas_combustible_tickets
    ) t
    JOIN recargas_combustible rc ON rc.id = t.recarga_id
    JOIN gasolineras g  ON g.id  = rc.gasolinera_id
    JOIN vehiculos   v  ON v.id  = rc.vehiculo_id
    JOIN modelos     mo ON mo.id = v.modelo_id
    JOIN conductores co ON co.id = rc.conductor_id
    LEFT JOIN vales_gasolina vg ON vg.id = rc.vale_id
    WHERE ${where.join(' AND ')}`

  const r = await req.query(`
    SELECT t.id, t.recarga_id, t.ticket_n, t.tickets,
           CONVERT(char(10), rc.fecha, 23) AS fecha,
           rc.gasolinera_id, g.nombre AS gasolinera,
           t.litros, t.costo,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
           co.nombre AS conductor, vg.folio AS vale_folio,
           DATEDIFF(day, rc.fecha, CAST(SYSDATETIME() AS date)) AS dias
    ${joins}
    ORDER BY rc.fecha DESC, rc.id DESC, t.id
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(*) AS total, COALESCE(SUM(t.costo), 0) AS costo_total
    ${joins};
  `)

  const resumen = (r.recordsets[1] as unknown as { total: number; costo_total: number }[])[0]
  return {
    data: r.recordsets[0] as unknown as RecargaSinFacturar[],
    total: resumen.total,
    costo_total: Number(resumen.costo_total),
  }
}

/**
 * Los tickets de la recarga que ya cobra una factura CONCILIADA, con los litros
 * con que casaron. Es lo que no se puede mover sin reabrir esa factura.
 */
export async function ticketsConciliados(
  recargaId: number,
): Promise<{ ticket_id: number; litros: number; folio: string }[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, recargaId)
    .query(`
      SELECT t.id AS ticket_id, t.litros, f.folio
      FROM facturas_gasolina_renglones fr
      JOIN facturas_gasolina f ON f.id = fr.factura_id
      JOIN recargas_combustible_tickets t ON t.id = fr.ticket_id
      WHERE fr.recarga_id = @id AND f.conciliada_en IS NOT NULL`)
  return r.recordset.map((x) => ({ ...x, litros: Number(x.litros) }))
}
