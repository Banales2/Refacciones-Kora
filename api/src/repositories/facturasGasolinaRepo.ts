import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { SQL_KM } from '../shared/km'
import type { ProductoRecarga } from '../shared/combustible'

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
  /** Suma de los importes de los renglones. */
  subtotal: number
  /**
   * El IVA como viene en el papel (migración 065). null en las capturadas antes,
   * cuyo total sale de la tasa.
   */
  iva: number | null
  /** subtotal + iva. Ver `TOTAL_SQL`. */
  total: number
  /**
   * El total salió de la tasa porque nadie ha capturado el IVA del papel. En
   * combustible eso da de más: el IVA no se cobra sobre el IEPS.
   */
  total_estimado: boolean
}

export interface RenglonFactura {
  id: number
  descripcion: string | null
  cantidad: number
  /** Como lo imprime el papel: en combustible, sin IVA. */
  importe: number
  /**
   * El renglón con su IVA: lo que de verdad cobra, y lo único comparable con
   * el costo del ticket, que es lo que se pagó en la bomba. Ver `CON_IVA_SQL`.
   */
  importe_con_iva: number
  /** El IVA del renglón no viene en el papel y se repartió o salió de la tasa. */
  iva_estimado: boolean
  ticket_id: number | null
  recarga_id: number | null
  // Lo del ticket casado, para enseñarlo junto al renglón.
  recarga_fecha: string | null
  ticket_litros: number | null
  /** Lo que se pagó en la bomba, con IVA: se compara con `importe_con_iva`. */
  ticket_costo: number | null
  vehiculo: string | null
  conductor: string | null
  vale_folio: string | null
}

/** Un ticket que algún renglón podría estar cobrando. */
/**
 * Cuántos días DESPUÉS de la fecha de la factura puede estar registrada una
 * recarga y seguir siendo candidata.
 *
 * La fecha de la recarga es la de captura, y no siempre la de la carga: la del
 * sábado se registra el lunes, la de un puente el martes. Con el corte exacto,
 * esa recarga ni aparecía como opción y su renglón salía como "carga que nadie
 * capturó" aunque sí se capturó.
 *
 * Eran tres (fin de semana y un puente) y se quedaban cortos: en octubre de
 * 2026 había cargas registradas cuatro días después de su factura que no
 * salían como opción. Siete cubren una semana de captura atrasada.
 */
export const DIAS_DE_GRACIA = 7

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
  /**
   * Cuántos días después de la fecha de la factura quedó registrada. 0 si fue
   * antes o el mismo día. Ver `DIAS_DE_GRACIA`.
   */
  dias_despues: number
}

/**
 * El total del papel. Con el IVA capturado es subtotal + IVA, que es lo que
 * imprime una factura de combustible: el IVA no se cobra sobre el IEPS, así que
 * NO es subtotal * 1.16 (migración 065). Sin él, las capturadas antes caen a la
 * tasa, y el total es una estimación que la pantalla marca como tal.
 */
const TOTAL_SQL = `
  CAST(s.subtotal + COALESCE(
    f.iva,
    CASE WHEN f.tasa_iva IS NULL THEN 0 ELSE ROUND(s.subtotal * f.tasa_iva / 100, 2) END
  ) AS DECIMAL(18, 2))
`

// Aparte del SELECT porque el listado filtra por el total y por cuántos
// renglones casaron, y el conteo necesita las mismas columnas que el filtro.
const FROM_FACTURA = `
  FROM facturas_gasolina f
  JOIN gasolineras g ON g.id = f.gasolinera_id
  CROSS APPLY (
    SELECT COUNT(*) AS renglones,
           SUM(CASE WHEN r.recarga_id IS NOT NULL THEN 1 ELSE 0 END) AS casados,
           COALESCE(SUM(r.importe), 0) AS subtotal
    FROM facturas_gasolina_renglones r
    WHERE r.factura_id = f.id
  ) s
`

const SELECT_FACTURA = `
  SELECT f.id, f.gasolinera_id, g.nombre AS gasolinera, f.folio,
         CONVERT(char(10), f.fecha, 23) AS fecha,
         f.tasa_iva, f.iva, f.capturado_por,
         CONVERT(varchar(19), f.conciliada_en, 126) AS conciliada_en,
         f.conciliada_por, f.nota,
         s.renglones, s.casados, s.subtotal,
         ${TOTAL_SQL} AS total,
         CAST(CASE WHEN f.iva IS NULL AND f.tasa_iva IS NOT NULL THEN 1 ELSE 0 END AS BIT)
           AS total_estimado
  ${FROM_FACTURA}
`

/**
 * "9990", "$9,990.00" o "370.137" → número; lo demás → null. Con un número se
 * busca también por dinero y litros: es como se pregunta por una factura
 * cuando se tiene el ticket en la mano.
 */
function comoNumero(texto: string): number | null {
  const limpio = texto.replace(/[$,\s]/g, '')
  return /^\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : null
}

export interface FacturaGasolinaQuery {
  page: number
  pageSize: number
  gasolinera_id?: number
  search?: string
  desde?: string
  hasta?: string
  por_conciliar?: boolean
  estado?: 'por_conciliar' | 'conciliada' | 'con_faltantes'
  total_min?: number
  total_max?: number
}

export async function findAll(
  p: FacturaGasolinaQuery,
): Promise<{ data: FacturaGasolina[]; total: number; suma: number }> {
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
    req.input('search', sql.NVarChar(110), `%${p.search.trim()}%`)
    // Folio, gasolinera, UUID, y lo que se sabe de las recargas que ya casaron:
    // unidad, placas, chofer y vale. Lo que trae el ticket en la mano.
    const opciones = [
      'f.folio LIKE @search', 'g.nombre LIKE @search', 'f.uuid LIKE @search',
      `EXISTS (
        SELECT 1 FROM facturas_gasolina_renglones rb
        JOIN recargas_combustible rcb ON rcb.id = rb.recarga_id
        JOIN vehiculos   vb ON vb.id = rcb.vehiculo_id
        JOIN modelos     mb ON mb.id = vb.modelo_id
        JOIN conductores cb ON cb.id = rcb.conductor_id
        LEFT JOIN vales_gasolina vgb ON vgb.id = rcb.vale_id
        WHERE rb.factura_id = f.id
          AND (vb.numero_serie LIKE @search OR vb.placas LIKE @search
               OR CONCAT(mb.marca, ' ', mb.nombre) LIKE @search
               OR cb.nombre LIKE @search OR vgb.folio LIKE @search))`,
    ]
    // Con un número, también el dinero y los litros: el total, o un renglón
    // por su importe —con o sin IVA, porque el ticket trae el que se pagó y el
    // papel el de antes— o por sus litros.
    const numero = comoNumero(p.search)
    if (numero !== null) {
      req.input('num', sql.Decimal(18, 6), numero)
      opciones.push(
        `ABS(${TOTAL_SQL} - @num) < 0.01`,
        `EXISTS (
          SELECT 1 FROM facturas_gasolina_renglones rn
          WHERE rn.factura_id = f.id
            AND (ABS(rn.importe - @num) < 0.01
                 OR ABS(rn.importe + COALESCE(rn.iva, 0) - @num) < 0.01
                 OR ABS(rn.cantidad - @num) < 0.01))`,
      )
    }
    where.push(`(${opciones.join(' OR ')})`)
  }
  if (p.desde) { req.input('desde', sql.Date, p.desde); where.push('f.fecha >= @desde') }
  if (p.hasta) { req.input('hasta', sql.Date, p.hasta); where.push('f.fecha <= @hasta') }
  if (p.total_min !== undefined) {
    req.input('tmin', sql.Decimal(18, 2), p.total_min)
    where.push(`${TOTAL_SQL} >= @tmin`)
  }
  if (p.total_max !== undefined) {
    req.input('tmax', sql.Decimal(18, 2), p.total_max)
    where.push(`${TOTAL_SQL} <= @tmax`)
  }
  if (p.por_conciliar || p.estado === 'por_conciliar') where.push('f.conciliada_en IS NULL')
  if (p.estado === 'conciliada') where.push('f.conciliada_en IS NOT NULL')
  if (p.estado === 'con_faltantes') where.push('s.casados < s.renglones')
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const r = await req.query(`
    ${SELECT_FACTURA}
    ${filtro}
    ORDER BY f.fecha DESC, f.id DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(*) AS total, COALESCE(SUM(${TOTAL_SQL}), 0) AS suma
    ${FROM_FACTURA}
    ${filtro};
  `)

  const resumen = (r.recordsets[1] as unknown as { total: number; suma: number }[])[0]
  return {
    data: r.recordsets[0] as unknown as FacturaGasolina[],
    total: resumen.total,
    suma: Number(resumen.suma),
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
  /** El IVA del papel. Ver la migración 065. */
  iva?: number | null
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
      .input('iva',     sql.Decimal(18, 2), data.iva ?? null)
      .input('capturo', sql.NVarChar(120), capturadoPor)
      .query(`
        INSERT INTO facturas_gasolina (gasolinera_id, folio, fecha, tasa_iva, iva, capturado_por)
        OUTPUT INSERTED.id
        VALUES (@gid, @folio, @fecha, @tasa, @iva, @capturo)`)
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

export async function findByUuid(uuid: string): Promise<{ id: number; folio: string } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('uuid', sql.Char(36), uuid)
    .query('SELECT id, folio FROM facturas_gasolina WHERE uuid = @uuid')
  return r.recordset[0] ?? null
}

export interface FacturaImportada {
  uuid: string
  gasolinera_id: number
  folio: string
  fecha: string
  iva: number
  renglones: {
    descripcion: string
    cantidad: number
    importe: number
    iva: number
    despacho: string | null
  }[]
  /** Si el permiso todavía no era de nadie, se le queda a esta gasolinera. */
  ligar: { permiso_cre: string; rfc: string } | null
}

/**
 * La factura leída del XML, con sus renglones, en una transacción. Si hay que
 * ligar el permiso a la gasolinera, va en la misma: una factura importada a una
 * gasolinera que no quedó ligada se volvería a preguntar la próxima vez.
 *
 * La cantidad se guarda a tres decimales, como el ticket de la bomba: es la
 * llave del cuadre.
 */
export async function crearImportada(
  data: FacturaImportada, capturadoPor: string,
): Promise<number> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    if (data.ligar) {
      await tx.request()
        .input('gid',     sql.Int,          data.gasolinera_id)
        .input('permiso', sql.NVarChar(40), data.ligar.permiso_cre)
        .input('rfc',     sql.NVarChar(13), data.ligar.rfc)
        .query(`
          UPDATE gasolineras SET permiso_cre = @permiso, rfc = @rfc
          WHERE id = @gid AND permiso_cre IS NULL`)
    }

    const cab = await tx.request()
      .input('gid',     sql.Int,            data.gasolinera_id)
      .input('folio',   sql.NVarChar(30),   data.folio)
      .input('fecha',   sql.Date,           data.fecha)
      .input('iva',     sql.Decimal(18, 2), data.iva)
      .input('uuid',    sql.Char(36),       data.uuid)
      .input('capturo', sql.NVarChar(120),  capturadoPor)
      .query(`
        INSERT INTO facturas_gasolina (gasolinera_id, folio, fecha, iva, uuid, capturado_por)
        OUTPUT INSERTED.id
        VALUES (@gid, @folio, @fecha, @iva, @uuid, @capturo)`)
    const facturaId = cab.recordset[0].id as number

    for (const r of data.renglones) {
      await tx.request()
        .input('fid',      sql.Int,            facturaId)
        .input('desc',     sql.NVarChar(100),  r.descripcion)
        .input('cant',     sql.Decimal(10, 3), Math.round(r.cantidad * 1000) / 1000)
        .input('importe',  sql.Decimal(18, 6), r.importe)
        .input('iva',      sql.Decimal(18, 6), r.iva)
        .input('despacho', sql.NVarChar(30),   r.despacho)
        .query(`
          INSERT INTO facturas_gasolina_renglones
            (factura_id, descripcion, cantidad, importe, iva, despacho)
          VALUES (@fid, @desc, @cant, @importe, @iva, @despacho)`)
    }

    await tx.commit()
    return facturaId
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * El renglón con su IVA, para ponerlo junto al costo del ticket.
 *
 * El importe del papel viene sin IVA y el ticket es lo que se pagó en la bomba,
 * con IVA: lado a lado, siempre parecía que la gasolinera cobraba de menos.
 * Con el IVA del propio renglón (lo trae todo XML importado), importe + IVA da
 * el ticket al centavo. Sin él:
 *
 *   - capturada a mano con el IVA del papel → se reparte por importe. Es
 *     estimación: el IVA no se cobra sobre el IEPS, que va por litro.
 *   - capturada con tasa (antes de la 065) → importe × (1 + tasa). Da de más,
 *     por lo mismo.
 *   - sin IVA ni tasa → los importes ya lo incluían (migración 020).
 */
const CON_IVA_SQL = `
  CAST(CASE
    WHEN fr.iva IS NOT NULL      THEN fr.importe + fr.iva
    WHEN f.iva IS NOT NULL       THEN fr.importe + f.iva * fr.importe / NULLIF(s.subtotal, 0)
    WHEN f.tasa_iva IS NOT NULL  THEN fr.importe * (1 + f.tasa_iva / 100)
    ELSE fr.importe
  END AS DECIMAL(18, 2))
`

/** Los renglones de la factura con lo que se sepa de su recarga casada. */
export async function renglones(facturaId: number): Promise<RenglonFactura[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT fr.id, fr.descripcion, fr.cantidad, fr.importe,
             ${CON_IVA_SQL} AS importe_con_iva,
             CAST(CASE WHEN fr.iva IS NULL AND (f.iva IS NOT NULL OR f.tasa_iva IS NOT NULL)
                       THEN 1 ELSE 0 END AS BIT) AS iva_estimado,
             fr.ticket_id, fr.recarga_id,
             CONVERT(char(10), rc.fecha, 23) AS recarga_fecha,
             t.litros AS ticket_litros, t.costo AS ticket_costo,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             co.nombre AS conductor, vg.folio AS vale_folio
      FROM facturas_gasolina_renglones fr
      JOIN facturas_gasolina f ON f.id = fr.factura_id
      CROSS APPLY (
        SELECT SUM(x.importe) AS subtotal
        FROM facturas_gasolina_renglones x WHERE x.factura_id = fr.factura_id
      ) s
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
 * Son los de las recargas de su gasolinera, de su fecha hacia atrás —con
 * `DIAS_DE_GRACIA` de margen, porque la carga del sábado se registra el lunes—,
 * que ningún renglón de ninguna OTRA factura haya reclamado — más los que esta
 * misma tiene casados, para que al volver sigan apareciendo.
 *
 * El corte por fecha no tiene límite inferior a propósito: una carga de hace
 * tres meses que nadie facturó sigue siendo candidata legítima, y poner una
 * ventana la escondería justo cuando aparece la factura atrasada que la cobra.
 * Por lo mismo no lleva TOP: un tope por cantidad es una ventana por la puerta
 * de atrás, y se comía justo los más viejos. Lo que acota la lista es que lo ya
 * facturado sale solo.
 */
export async function candidatas(facturaId: number): Promise<TicketCandidato[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',     sql.Int, facturaId)
    .input('gracia', sql.Int, DIAS_DE_GRACIA)
    .query(`
      SELECT t.id, t.recarga_id, t.ticket_n, t.tickets,
             CONVERT(char(10), rc.fecha, 23) AS fecha,
             t.litros, t.costo,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             co.nombre AS conductor, vg.folio AS vale_folio,
             CASE WHEN rc.fecha > f.fecha THEN DATEDIFF(day, f.fecha, rc.fecha) ELSE 0 END
               AS dias_despues
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
        AND rc.fecha <= DATEADD(day, @gracia, f.fecha)
        AND NOT EXISTS (
          SELECT 1 FROM facturas_gasolina_renglones otro
          WHERE otro.ticket_id = t.id AND otro.factura_id <> @id
        )
      ORDER BY rc.fecha DESC, rc.id DESC, t.id`)
  return r.recordset.map((c) => ({
    ...c, litros: Number(c.litros), costo: Number(c.costo),
  })) as TicketCandidato[]
}

/** Un ticket de otra gasolinera idéntico a un renglón sin casar. */
export interface TicketEnOtraGasolinera {
  renglon_id: number
  ticket_id:  number
  recarga_id: number
  gasolinera: string
  fecha:      string
  litros:     number
  costo:      number
  vehiculo:   string
  conductor:  string
}

/**
 * Tickets registrados con OTRA gasolinera que son idénticos a un renglón sin
 * casar de esta factura: lo más probable es que alguien eligió la estación
 * equivocada al capturar la recarga. En octubre de 2026 dos cargas de
 * Vázquez estaban capturadas como Dakota, y su factura las daba por "nadie
 * las capturó".
 *
 * Idéntico es lo mismo que pide la propuesta normal: litros iguales a tres
 * decimales, o el mismo importe con IVA al centavo y litros a menos de
 * `litrosTolerancia` — esto último solo con el IVA del propio renglón, que es
 * el que da el ticket exacto. Y con un corte de fecha alrededor de la factura,
 * porque entre estaciones dos cargas redondas ($2,000 al mismo precio) sí
 * pueden coincidir; dentro de una semana es mucho menos probable.
 *
 * No se proponen: solo se avisan. Arreglarlo es corregir la gasolinera de la
 * recarga, y entonces sale como candidata normal.
 */
export async function ticketsEnOtraGasolinera(
  facturaId: number, litrosTolerancia: number,
): Promise<TicketEnOtraGasolinera[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',     sql.Int, facturaId)
    .input('gracia', sql.Int, DIAS_DE_GRACIA)
    .input('tol',    sql.Decimal(10, 3), litrosTolerancia)
    .query(`
      SELECT fr.id AS renglon_id, t.id AS ticket_id, t.recarga_id,
             g.nombre AS gasolinera,
             CONVERT(char(10), rc.fecha, 23) AS fecha,
             t.litros, t.costo,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             co.nombre AS conductor
      FROM facturas_gasolina_renglones fr
      JOIN facturas_gasolina f ON f.id = fr.factura_id
      JOIN recargas_combustible rc
        ON rc.gasolinera_id <> f.gasolinera_id
       AND rc.fecha BETWEEN DATEADD(day, -@gracia, f.fecha) AND DATEADD(day, @gracia, f.fecha)
      JOIN recargas_combustible_tickets t ON t.recarga_id = rc.id
      JOIN gasolineras  g  ON g.id  = rc.gasolinera_id
      JOIN vehiculos    v  ON v.id  = rc.vehiculo_id
      JOIN modelos      mo ON mo.id = v.modelo_id
      JOIN conductores  co ON co.id = rc.conductor_id
      WHERE fr.factura_id = @id
        AND fr.ticket_id IS NULL
        AND (
          ROUND(t.litros, 3) = ROUND(fr.cantidad, 3)
          OR (fr.iva IS NOT NULL
              AND ABS(t.costo - ROUND(fr.importe + fr.iva, 2)) < 0.005
              AND ABS(t.litros - fr.cantidad) <= @tol)
        )
        -- Si otra factura ya lo cobra, ese ticket está bien donde está.
        AND NOT EXISTS (
          SELECT 1 FROM facturas_gasolina_renglones otro WHERE otro.ticket_id = t.id
        )
      ORDER BY fr.id, rc.fecha DESC, t.id`)
  return r.recordset.map((c) => ({
    ...c, litros: Number(c.litros), costo: Number(c.costo),
  })) as TicketEnOtraGasolinera[]
}

export interface Casado {
  renglon_id: number
  ticket_id: number | null
}

/**
 * Por qué un renglón no puede casarse con el ticket que mandaron. Son las
 * mismas reglas que deciden si un ticket es candidato (ver `candidatas`): la
 * pantalla solo ofrece esos, pero la API no puede fiarse de la pantalla, y el
 * candado de las recargas conciliadas supone que nunca se casó un ticket de
 * otra gasolinera.
 */
export type RechazoCasado =
  | { motivo: 'renglon_ajeno';    renglon_id: number }
  | { motivo: 'ticket_no_existe'; renglon_id: number; cantidad: number }
  | { motivo: 'otra_gasolinera';  renglon_id: number; cantidad: number; gasolinera: string | null }
  | { motivo: 'fuera_del_corte';  renglon_id: number; cantidad: number; fecha: string }
  | { motivo: 'ya_facturado';     renglon_id: number; cantidad: number; folio: string }

export type ResultadoGuardar =
  | { estado: 'no_existe' }
  | { estado: 'ya_conciliada' }
  | { estado: 'rechazado'; rechazo: RechazoCasado }
  /** Guardó los casados pero no selló: quedan renglones sin casar y no se confirmó. */
  | { estado: 'sin_casar' }
  | { estado: 'sellada' }

/**
 * Guarda a qué ticket corresponde cada renglón y, si se puede, sella la factura.
 *
 * Se sueltan todos primero y luego se asignan: lo que manda la pantalla es la
 * verdad completa, y calcular la diferencia contra lo que había solo agrega una
 * forma de equivocarse. La recarga se copia del ticket.
 *
 * TODO EN UNA TRANSACCIÓN, con la factura bloqueada desde el principio. Antes
 * eran tres pasos sueltos —¿está sellada?, guardar, sellar— y dos admins a la
 * vez podían terminar con la factura sellada por uno y los casados del otro:
 * el segundo guardaba encima justo después del sello, y aunque a él le salía
 * el 409, el daño ya estaba hecho.
 *
 * Cada ticket se valida contra las reglas de `candidatas`: de la gasolinera de
 * la factura, hasta su fecha más los días de gracia y sin otra factura que lo
 * cobre. El primero que no cumpla deshace todo.
 *
 * Con renglones sin casar y sin `confirmarSinCasar` los casados SÍ se guardan
 * —el trabajo no se pierde— y la factura se queda abierta.
 */
export async function guardarYSellar(
  facturaId: number, casados: Casado[],
  sello: { confirmarSinCasar: boolean; quien: string; nota: string | null },
): Promise<ResultadoGuardar> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const f = await tx.request()
      .input('id', sql.Int, facturaId)
      .query(`
        SELECT conciliada_en FROM facturas_gasolina WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @id`)
    if (f.recordset.length === 0) {
      await tx.rollback()
      return { estado: 'no_existe' }
    }
    if (f.recordset[0].conciliada_en !== null) {
      await tx.rollback()
      return { estado: 'ya_conciliada' }
    }

    await tx.request()
      .input('id', sql.Int, facturaId)
      .query(`
        UPDATE facturas_gasolina_renglones SET ticket_id = NULL, recarga_id = NULL
        WHERE factura_id = @id`)

    for (const c of casados) {
      if (c.ticket_id === null) continue
      const u = await tx.request()
        .input('rid',    sql.Int, c.renglon_id)
        .input('fid',    sql.Int, facturaId)
        .input('tid',    sql.Int, c.ticket_id)
        .input('gracia', sql.Int, DIAS_DE_GRACIA)
        .query(`
          UPDATE fr
          SET ticket_id = t.id, recarga_id = t.recarga_id
          FROM facturas_gasolina_renglones fr
          JOIN facturas_gasolina f ON f.id = fr.factura_id
          JOIN recargas_combustible_tickets t ON t.id = @tid
          JOIN recargas_combustible rc ON rc.id = t.recarga_id
          WHERE fr.id = @rid AND fr.factura_id = @fid
            AND rc.gasolinera_id = f.gasolinera_id
            AND rc.fecha <= DATEADD(day, @gracia, f.fecha)
            AND NOT EXISTS (
              SELECT 1 FROM facturas_gasolina_renglones otro
              WHERE otro.ticket_id = t.id AND otro.factura_id <> @fid
            )`)
      if ((u.rowsAffected[0] ?? 0) === 0) {
        const rechazo = await porQueNoCasa(tx, facturaId, c.renglon_id, c.ticket_id)
        await tx.rollback()
        return { estado: 'rechazado', rechazo }
      }
    }

    const pendientes = await tx.request()
      .input('id', sql.Int, facturaId)
      .query(`
        SELECT COUNT(*) AS n FROM facturas_gasolina_renglones
        WHERE factura_id = @id AND ticket_id IS NULL`)
    if (pendientes.recordset[0].n > 0 && !sello.confirmarSinCasar) {
      await tx.commit()
      return { estado: 'sin_casar' }
    }

    await tx.request()
      .input('id',    sql.Int,           facturaId)
      .input('quien', sql.NVarChar(120), sello.quien)
      .input('nota',  sql.NVarChar(255), sello.nota)
      .query(`
        UPDATE facturas_gasolina
        SET conciliada_en = SYSUTCDATETIME(), conciliada_por = @quien, nota = @nota
        WHERE id = @id`)
    await tx.commit()
    return { estado: 'sellada' }
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/** Qué regla de `candidatas` no cumple el ticket. Corre dentro de la transacción. */
async function porQueNoCasa(
  tx: sql.Transaction, facturaId: number, renglonId: number, ticketId: number,
): Promise<RechazoCasado> {
  const r = await tx.request()
    .input('rid',    sql.Int, renglonId)
    .input('fid',    sql.Int, facturaId)
    .input('tid',    sql.Int, ticketId)
    .input('gracia', sql.Int, DIAS_DE_GRACIA)
    .query(`
      SELECT fr.cantidad,
             t.id AS ticket_id,
             CASE WHEN rc.gasolinera_id IS NULL OR rc.gasolinera_id <> f.gasolinera_id
                  THEN 1 ELSE 0 END AS otra_gasolinera,
             g.nombre AS gasolinera,
             CASE WHEN rc.fecha > DATEADD(day, @gracia, f.fecha) THEN 1 ELSE 0 END AS fuera_del_corte,
             CONVERT(char(10), rc.fecha, 23) AS fecha,
             (SELECT TOP 1 otra.folio
                FROM facturas_gasolina_renglones otro
                JOIN facturas_gasolina otra ON otra.id = otro.factura_id
               WHERE otro.ticket_id = @tid AND otro.factura_id <> @fid) AS folio
      FROM facturas_gasolina_renglones fr
      JOIN facturas_gasolina f ON f.id = fr.factura_id
      LEFT JOIN recargas_combustible_tickets t ON t.id = @tid
      LEFT JOIN recargas_combustible rc ON rc.id = t.recarga_id
      LEFT JOIN gasolineras g ON g.id = rc.gasolinera_id
      WHERE fr.id = @rid AND fr.factura_id = @fid`)
  const d = r.recordset[0]
  if (!d) return { motivo: 'renglon_ajeno', renglon_id: renglonId }
  const cantidad = Number(d.cantidad)
  if (d.ticket_id === null) return { motivo: 'ticket_no_existe', renglon_id: renglonId, cantidad }
  if (d.otra_gasolinera) {
    return { motivo: 'otra_gasolinera', renglon_id: renglonId, cantidad, gasolinera: d.gasolinera }
  }
  if (d.fuera_del_corte) {
    return { motivo: 'fuera_del_corte', renglon_id: renglonId, cantidad, fecha: d.fecha }
  }
  return { motivo: 'ya_facturado', renglon_id: renglonId, cantidad, folio: d.folio ?? '?' }
}

/**
 * Pone el IVA del papel a una factura capturada con tasa. Solo a las que no
 * están conciliadas: lo sellado no se mueve sin reabrir.
 */
export async function setIva(facturaId: number, iva: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',  sql.Int,            facturaId)
    .input('iva', sql.Decimal(18, 2), iva)
    .query(`
      UPDATE facturas_gasolina SET iva = @iva
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
): Promise<{ ticket_id: number; litros: number; folio: string; fecha_factura: string }[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, recargaId)
    .query(`
      SELECT t.id AS ticket_id, t.litros, f.folio,
             CONVERT(char(10), f.fecha, 23) AS fecha_factura
      FROM facturas_gasolina_renglones fr
      JOIN facturas_gasolina f ON f.id = fr.factura_id
      JOIN recargas_combustible_tickets t ON t.id = fr.ticket_id
      WHERE fr.recarga_id = @id AND f.conciliada_en IS NOT NULL`)
  return r.recordset.map((x) => ({ ...x, litros: Number(x.litros) }))
}

// ── Registrar desde la factura ────────────────────────────────────────────────

/** El vale que el encargado tampoco registró, ya resuelto por el servicio. */
export interface ValeNuevoDesdeFactura {
  folio:         string
  creado_por:    string
  capturado_por: string
  sucursal_id:   number
  fecha:         string
}

export interface RegistroDesdeFactura {
  renglonId:    number
  /** El vale que ya estaba registrado, o null si va en `valeNuevo`. */
  valeId:       number | null
  valeNuevo:    ValeNuevoDesdeFactura | null
  vehiculoId:   number
  conductorId:  number
  fecha:        string
  litros:       number
  costo:        number
  kilometraje:  number | null
  producto:     ProductoRecarga | null
  capturadoPor: string
}

export type ResultadoRegistro =
  | { estado: 'no_existe' }
  | { estado: 'ya_conciliada' }
  | { estado: 'renglon_ajeno' }
  | { estado: 'renglon_casado' }
  | { estado: 'folio_repetido' }
  | { estado: 'vale_usado' }
  | { estado: 'registrada'; recarga_id: number; vale_id: number; ticket_id: number }

/**
 * Da de alta la recarga que nadie reportó —y su vale, si tampoco estaba— y la
 * casa con el renglón que la destapó. Todo en una transacción con la factura
 * bloqueada, igual que `guardarYSellar`: la factura no puede sellarse a media
 * alta, ni el renglón llevarse otro ticket mientras tanto.
 *
 * La recarga y el vale nuevo quedan marcados con la factura (`desde_factura_id`,
 * migración 069): de esa marca sale el reporte de omisiones. Un vale que ya
 * estaba registrado no se marca: el encargado sí cumplió.
 *
 * La gasolinera es la de la factura: es la que está cobrando la carga.
 */
export async function registrarDesdeFactura(
  facturaId: number, d: RegistroDesdeFactura,
): Promise<ResultadoRegistro> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  const salir = async (r: ResultadoRegistro) => { await tx.rollback(); return r }
  try {
    const f = await tx.request()
      .input('id', sql.Int, facturaId)
      .query(`
        SELECT conciliada_en, gasolinera_id FROM facturas_gasolina WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @id`)
    if (f.recordset.length === 0) return salir({ estado: 'no_existe' })
    if (f.recordset[0].conciliada_en !== null) return salir({ estado: 'ya_conciliada' })
    const gasolineraId = f.recordset[0].gasolinera_id as number

    const ren = await tx.request()
      .input('rid', sql.Int, d.renglonId)
      .input('fid', sql.Int, facturaId)
      .query(`
        SELECT ticket_id FROM facturas_gasolina_renglones WITH (UPDLOCK)
        WHERE id = @rid AND factura_id = @fid`)
    if (ren.recordset.length === 0) return salir({ estado: 'renglon_ajeno' })
    if (ren.recordset[0].ticket_id !== null) return salir({ estado: 'renglon_casado' })

    let valeId = d.valeId
    if (d.valeNuevo) {
      // El índice único del folio lo detendría igual, con un error ilegible.
      const rep = await tx.request()
        .input('folio', sql.NVarChar(30), d.valeNuevo.folio)
        .query('SELECT 1 FROM vales_gasolina WITH (UPDLOCK, HOLDLOCK) WHERE folio = @folio')
      if (rep.recordset.length > 0) return salir({ estado: 'folio_repetido' })
      const v = await tx.request()
        .input('folio',         sql.NVarChar(30),  d.valeNuevo.folio)
        .input('creado_por',    sql.NVarChar(120), d.valeNuevo.creado_por)
        .input('capturado_por', sql.NVarChar(120), d.valeNuevo.capturado_por)
        .input('conductor_id',  sql.Int,  d.conductorId)
        .input('vehiculo_id',   sql.Int,  d.vehiculoId)
        .input('sucursal_id',   sql.Int,  d.valeNuevo.sucursal_id)
        .input('fecha',         sql.Date, d.valeNuevo.fecha)
        .input('fid',           sql.Int,  facturaId)
        .query(`
          INSERT INTO vales_gasolina
            (folio, creado_por, capturado_por, conductor_id, vehiculo_id, sucursal_id, fecha, desde_factura_id)
          OUTPUT INSERTED.id
          VALUES (@folio, @creado_por, @capturado_por, @conductor_id, @vehiculo_id, @sucursal_id, @fecha, @fid)`)
      valeId = v.recordset[0].id as number
    } else {
      // El servicio ya lo revisó; aquí se repite bajo el candado por si otra
      // recarga lo gastó entre tanto. UQ_recargas_vale es la última palabra.
      const usado = await tx.request()
        .input('vid', sql.Int, valeId)
        .query('SELECT 1 FROM recargas_combustible WITH (UPDLOCK, HOLDLOCK) WHERE vale_id = @vid')
      if (usado.recordset.length > 0) return salir({ estado: 'vale_usado' })
    }

    const r = await tx.request()
      .input('vehiculo_id',   sql.Int, d.vehiculoId)
      .input('gasolinera_id', sql.Int, gasolineraId)
      .input('conductor_id',  sql.Int, d.conductorId)
      .input('vale_id',       sql.Int, valeId)
      .input('fecha',         sql.Date, d.fecha)
      .input('litros',        sql.Decimal(10, 3), d.litros)
      .input('costo',         sql.Decimal(18, 2), d.costo)
      .input('kilometraje',   SQL_KM, d.kilometraje)
      .input('producto',      sql.NVarChar(10), d.producto)
      .input('capturado_por', sql.NVarChar(120), d.capturadoPor)
      .input('fid',           sql.Int, facturaId)
      .query(`
        INSERT INTO recargas_combustible
          (vehiculo_id, gasolinera_id, conductor_id, vale_id, fecha, litros, costo,
           kilometraje, producto, capturado_por, desde_factura_id)
        OUTPUT INSERTED.id
        VALUES (@vehiculo_id, @gasolinera_id, @conductor_id, @vale_id, @fecha, @litros, @costo,
                @kilometraje, @producto, @capturado_por, @fid)`)
    const recargaId = r.recordset[0].id as number

    const t = await tx.request()
      .input('rid',    sql.Int, recargaId)
      .input('litros', sql.Decimal(10, 3), d.litros)
      .input('costo',  sql.Decimal(18, 2), d.costo)
      .query(`
        INSERT INTO recargas_combustible_tickets (recarga_id, litros, costo)
        OUTPUT INSERTED.id
        VALUES (@rid, @litros, @costo)`)
    const ticketId = t.recordset[0].id as number

    await tx.request()
      .input('rid', sql.Int, d.renglonId)
      .input('tid', sql.Int, ticketId)
      .input('cid', sql.Int, recargaId)
      .query(`
        UPDATE facturas_gasolina_renglones SET ticket_id = @tid, recarga_id = @cid
        WHERE id = @rid`)

    await tx.commit()
    return { estado: 'registrada', recarga_id: recargaId, vale_id: valeId!, ticket_id: ticketId }
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * Una recarga que el chofer no reportó y salió al cuadrar la factura. Si
 * `vale_sin_registrar`, el encargado tampoco registró el vale.
 */
export interface SinReportar {
  recarga_id:   number
  fecha:        string
  litros:       number
  costo:        number
  producto:     string | null
  vehiculo:     string
  placas:       string | null
  conductor_id: number
  conductor:    string
  gasolinera:   string | null
  factura_id:   number
  factura_folio: string
  vale_id:      number | null
  vale_folio:   string | null
  vale_fecha:   string | null
  vale_sin_registrar: boolean
  /** A nombre de quién está el vale: quien lo entregó. */
  encargado:        string | null
  encargado_nombre: string | null
  sucursal:     string | null
  /** Quién lo registró desde la factura. */
  capturado_por: string | null
}

/** Las omisiones: recargas registradas desde una factura, de la más nueva a la más vieja. */
export async function sinReportar(p: { desde?: string; hasta?: string }): Promise<SinReportar[]> {
  const pool = await getPool()
  const req = pool.request()
  const where = ['r.desde_factura_id IS NOT NULL']
  if (p.desde) { req.input('desde', sql.Date, p.desde); where.push('r.fecha >= @desde') }
  if (p.hasta) { req.input('hasta', sql.Date, p.hasta); where.push('r.fecha <= @hasta') }
  const r = await req.query(`
    SELECT r.id AS recarga_id, CONVERT(char(10), r.fecha, 23) AS fecha,
           r.litros, r.costo, r.producto,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo, v.placas,
           r.conductor_id, co.nombre AS conductor,
           g.nombre AS gasolinera,
           f.id AS factura_id, f.folio AS factura_folio,
           vg.id AS vale_id, vg.folio AS vale_folio,
           CONVERT(char(10), vg.fecha, 23) AS vale_fecha,
           CAST(CASE WHEN vg.desde_factura_id IS NOT NULL THEN 1 ELSE 0 END AS BIT)
             AS vale_sin_registrar,
           vg.creado_por AS encargado, enc.nombre AS encargado_nombre,
           s.nombre AS sucursal,
           r.capturado_por
    FROM recargas_combustible r
    JOIN facturas_gasolina f ON f.id = r.desde_factura_id
    JOIN vehiculos   v  ON v.id  = r.vehiculo_id
    JOIN modelos     mo ON mo.id = v.modelo_id
    JOIN conductores co ON co.id = r.conductor_id
    LEFT JOIN gasolineras    g  ON g.id  = r.gasolinera_id
    LEFT JOIN vales_gasolina vg ON vg.id = r.vale_id
    LEFT JOIN sucursales     s  ON s.id  = vg.sucursal_id
    -- APPLY y no JOIN: nada garantiza que el correo no se repita en usuarios.
    OUTER APPLY (
      SELECT TOP 1 NULLIF(LTRIM(RTRIM(u.nombre)), '') AS nombre
      FROM usuarios u WHERE LTRIM(RTRIM(u.email)) = vg.creado_por
    ) enc
    WHERE ${where.join(' AND ')}
    ORDER BY r.fecha DESC, r.id DESC`)
  return r.recordset.map((x) => ({
    ...x, litros: Number(x.litros), costo: Number(x.costo),
  })) as SinReportar[]
}
