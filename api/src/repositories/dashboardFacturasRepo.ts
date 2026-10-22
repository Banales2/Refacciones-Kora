// Lo que el tablero lee de las facturas: qué falta por cuadrar y qué encontró
// la conciliación. Aquí solo hay lecturas; las reglas de cada factura viven en
// su propio repo y se reusan de ahí (`POR_REVISAR_SQL`, `CON_IVA_SQL`) para que
// el número del tablero y la lista de la pantalla no puedan decir cosas distintas.
import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { CON_MANO_OBRA_SQL, CON_REFACCIONES_SQL, POR_REVISAR_SQL } from './facturasRepo'
import { CON_IVA_SQL } from './facturasGasolinaRepo'

// ─── Facturas por cuadrar ────────────────────────────────────────────────────

export interface BandejaFacturas {
  /** Cuántas esperan y la fecha de la más vieja: es la que dice si se atrasó. */
  pendientes: number
  mas_vieja:  string | null
}

export interface FacturasPorCuadrar {
  gasolina:    BandejaFacturas
  casetas:     BandejaFacturas
  refacciones: BandejaFacturas
  taller:      BandejaFacturas
  /** Facturas de gasolina con el total sacado de la tasa: falta el IVA del papel. */
  gasolina_total_estimado: number
  /** Tags que llegaron en una factura y nadie ha ligado a una unidad. */
  tags_sin_unidad: number
  /** Lo que suman sus cruces: es gasto que no se le puede achacar a nadie. */
  tags_sin_unidad_monto: number
}

export async function facturasPorCuadrar(): Promise<FacturasPorCuadrar> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT COUNT(*) AS pendientes, CONVERT(char(10), MIN(fecha), 23) AS mas_vieja
    FROM facturas_gasolina WHERE conciliada_en IS NULL;

    -- La fecha de la de casetas es el fin del periodo que cobra; si PASE cambió
    -- la redacción y no se pudo leer, la de emisión.
    SELECT COUNT(*) AS pendientes,
           CONVERT(char(10), MIN(COALESCE(periodo_hasta, CAST(fecha_emision AS date))), 23) AS mas_vieja
    FROM facturas_casetas WHERE revisada_en IS NULL;

    SELECT COUNT(*) AS pendientes, CONVERT(char(10), MIN(f.fecha_compra), 23) AS mas_vieja
    FROM facturas f WHERE ${POR_REVISAR_SQL} AND ${CON_REFACCIONES_SQL};

    SELECT COUNT(*) AS pendientes, CONVERT(char(10), MIN(f.fecha_compra), 23) AS mas_vieja
    FROM facturas f WHERE ${POR_REVISAR_SQL} AND ${CON_MANO_OBRA_SQL};

    SELECT COUNT(*) AS n FROM facturas_gasolina WHERE iva IS NULL AND tasa_iva IS NOT NULL;

    SELECT COUNT(*) AS n,
           COALESCE((SELECT SUM(c.total) FROM facturas_casetas_cruces c
                     WHERE c.vehiculo_id IS NULL), 0) AS monto
    FROM tags_casetas WHERE vehiculo_id IS NULL;
  `)
  const rs = r.recordsets as sql.IRecordSet<Record<string, unknown>>[]
  const bandeja = (i: number) => rs[i][0] as unknown as BandejaFacturas
  return {
    gasolina:    bandeja(0),
    casetas:     bandeja(1),
    refacciones: bandeja(2),
    taller:      bandeja(3),
    gasolina_total_estimado: rs[4][0].n as number,
    tags_sin_unidad:         rs[5][0].n as number,
    tags_sin_unidad_monto:   Number(rs[5][0].monto),
  }
}

// ─── Facturas de casetas de un periodo ───────────────────────────────────────

export interface FacturaCasetasDelPeriodo {
  id:      number
  serie:   string | null
  folio:   string
  periodo: string | null
  /** El último día que cobra: es por el que la factura cae en un periodo u otro. */
  hasta:   string
  total:   number
  revisada: boolean
}

/**
 * Las facturas de PASE que cobran cruces del rango [start, end), por el fin
 * del periodo que cobran. Es la fecha que dice de qué diez días es el papel; la
 * de emisión puede caer ya en el siguiente.
 */
export async function facturasCasetasEnRango(
  start: string, end: string,
): Promise<FacturaCasetasDelPeriodo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      SELECT id, serie, folio, periodo, total,
             CONVERT(char(10), COALESCE(periodo_hasta, CAST(fecha_emision AS date)), 23) AS hasta,
             CAST(CASE WHEN revisada_en IS NULL THEN 0 ELSE 1 END AS BIT) AS revisada
      FROM facturas_casetas
      WHERE COALESCE(periodo_hasta, CAST(fecha_emision AS date)) >= @start
        AND COALESCE(periodo_hasta, CAST(fecha_emision AS date)) <  @end
      ORDER BY hasta DESC, id DESC`)
  return r.recordset.map((x) => ({ ...x, total: Number(x.total) })) as FacturaCasetasDelPeriodo[]
}

// ─── Lo que encontró la conciliación de gasolina ─────────────────────────────

/** Una factura sellada con renglones que ninguna recarga explica. */
export interface FacturaConFaltantes {
  id:         number
  folio:      string
  gasolinera: string
  fecha:      string
  renglones:  number
  litros:     number
  /** Con IVA: es lo que se le paga a la gasolinera por esas cargas. */
  monto:      number
}

/**
 * Las facturas ya conciliadas que cobran cargas que nadie capturó. Se sellaron
 * así a sabiendas (`confirmar_sin_casar`), y por eso son el hallazgo: dinero
 * pagado por combustible que no aparece en ninguna recarga. Las abiertas no
 * cuentan todavía: ahí un renglón sin casar puede ser solo que falta elegirlo.
 */
export async function facturasGasolinaConFaltantes(): Promise<FacturaConFaltantes[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT f.id, f.folio, g.nombre AS gasolinera,
           CONVERT(char(10), f.fecha, 23) AS fecha,
           COUNT(*) AS renglones,
           SUM(fr.cantidad) AS litros,
           SUM(${CON_IVA_SQL}) AS monto
    FROM facturas_gasolina_renglones fr
    JOIN facturas_gasolina f ON f.id = fr.factura_id
    JOIN gasolineras g ON g.id = f.gasolinera_id
    CROSS APPLY (
      SELECT SUM(x.importe) AS subtotal
      FROM facturas_gasolina_renglones x WHERE x.factura_id = fr.factura_id
    ) s
    WHERE f.conciliada_en IS NOT NULL AND fr.ticket_id IS NULL
    GROUP BY f.id, f.folio, g.nombre, f.fecha
    ORDER BY f.fecha DESC, f.id DESC`)
  return r.recordset.map((x) => ({
    ...x, litros: Number(x.litros), monto: Number(x.monto),
  })) as FacturaConFaltantes[]
}

/** Lo capturado que ninguna factura ha cobrado, por gasolinera. */
export interface SinFacturarPorGasolinera {
  gasolinera_id: number
  gasolinera:    string
  tickets:       number
  costo:         number
  /** Días de la carga más vieja. */
  dias_max:      number
}

/**
 * Los tickets sin factura con más de `dias` de cargados, por gasolinera. Mismo
 * criterio que la pestaña "Recargas sin factura": por ticket, y sin factura es
 * que ningún renglón lo reclama.
 */
export async function sinFacturarViejas(dias: number): Promise<SinFacturarPorGasolinera[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('dias', sql.Int, dias)
    .query(`
      SELECT rc.gasolinera_id, g.nombre AS gasolinera,
             COUNT(*) AS tickets, SUM(t.costo) AS costo,
             MAX(DATEDIFF(day, rc.fecha, CAST(SYSDATETIME() AS date))) AS dias_max
      FROM recargas_combustible_tickets t
      JOIN recargas_combustible rc ON rc.id = t.recarga_id
      JOIN gasolineras g ON g.id = rc.gasolinera_id
      WHERE NOT EXISTS (SELECT 1 FROM facturas_gasolina_renglones fgr WHERE fgr.ticket_id = t.id)
        AND rc.fecha < DATEADD(day, -@dias, CAST(SYSDATETIME() AS date))
      GROUP BY rc.gasolinera_id, g.nombre
      ORDER BY SUM(t.costo) DESC`)
  return r.recordset.map((x) => ({ ...x, costo: Number(x.costo) })) as SinFacturarPorGasolinera[]
}

/** Las facturas con renglones sin casar desde `desde`, abiertas o selladas. */
export async function facturasGasolinaConSinCasar(desde: string): Promise<{
  id: number; folio: string; gasolinera: string; fecha: string; conciliada: boolean
}[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('desde', sql.Date, desde)
    .query(`
      SELECT f.id, f.folio, g.nombre AS gasolinera,
             CONVERT(char(10), f.fecha, 23) AS fecha,
             CAST(CASE WHEN f.conciliada_en IS NULL THEN 0 ELSE 1 END AS BIT) AS conciliada
      FROM facturas_gasolina f
      JOIN gasolineras g ON g.id = f.gasolinera_id
      WHERE f.fecha >= @desde
        AND EXISTS (SELECT 1 FROM facturas_gasolina_renglones fr
                    WHERE fr.factura_id = f.id AND fr.ticket_id IS NULL)
      ORDER BY f.fecha DESC, f.id DESC`)
  return r.recordset
}
