import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Lo que dice el papel de una factura de refacciones, renglón por renglón.
//
// Es la otra lista: `lotes_pieza` dice lo que está capturado, y esta dice lo que
// la factura cobra. Con las dos, las tres preguntas se contestan solas:
//
//   renglón del papel sin lote      -> nadie capturó esa compra
//   lote sin renglón del papel      -> se capturó algo que el papel no trae
//   los dos, con valores distintos  -> error de captura, y se sabe de cuánto
//
// EL RENGLÓN APUNTA A UNA PIEZA DEL CATÁLOGO, no a un texto. En gasolina los
// renglones se casan por litros porque ese número identifica la carga; aquí no
// hay uno así, y casar por parecido entre descripciones se equivoca en silencio.
//
// Ver `db/migrations/044_renglones_de_la_factura.sql`.

export interface RenglonPapel {
  id: number
  pieza_id: number
  numero_serie: string
  descripcion: string
  cantidad: number
  costo_unitario: number
  /** El lote que le corresponde. `null` = nadie capturó esta compra. */
  lote_id: number | null
  // Lo del lote casado, para poder comparar sin una segunda consulta.
  lote_cantidad: number | null
  lote_costo: number | null
  lote_capturado_por: string | null
}

/** Un lote de la factura, con lo que hace falta para compararlo y corregirlo. */
export interface LoteDeFactura {
  lote_id: number
  pieza_id: number
  numero_serie: string
  descripcion: string
  cantidad_inicial: number
  costo_unitario: number
  sucursal_id: number | null
  sucursal: string | null
  capturado_por: string | null
  /** El renglón del papel que lo reclama. `null` = el papel no lo trae. */
  renglon_id: number | null
}

export async function renglonesDelPapel(facturaId: number): Promise<RenglonPapel[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT fr.id, fr.pieza_id, p.numero_serie, p.descripcion,
             fr.cantidad, fr.costo_unitario, fr.lote_id,
             l.cantidad_inicial AS lote_cantidad,
             l.costo_unitario   AS lote_costo,
             l.capturado_por    AS lote_capturado_por
      FROM facturas_renglones fr
      JOIN piezas p ON p.id = fr.pieza_id
      LEFT JOIN lotes_pieza l ON l.id = fr.lote_id
      WHERE fr.factura_id = @id
      ORDER BY fr.id`)
  return r.recordset as RenglonPapel[]
}

export async function lotesDeFactura(facturaId: number): Promise<LoteDeFactura[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT l.id AS lote_id, l.pieza_id, p.numero_serie, p.descripcion,
             l.cantidad_inicial, l.costo_unitario,
             l.sucursal_id, s.nombre AS sucursal, l.capturado_por,
             fr.id AS renglon_id
      FROM lotes_pieza l
      JOIN piezas p ON p.id = l.pieza_id
      LEFT JOIN sucursales s ON s.id = l.sucursal_id
      LEFT JOIN facturas_renglones fr ON fr.lote_id = l.id
      WHERE l.factura_id = @id
      ORDER BY p.numero_serie`)
  return r.recordset as LoteDeFactura[]
}

export interface RenglonAGuardar {
  /** El id del renglón si ya existía; ausente = alta. */
  id?: number
  pieza_id: number
  cantidad: number
  costo_unitario: number
  /** A qué lote corresponde, si ya se decidió. */
  lote_id?: number | null
}

/**
 * Reemplaza por completo los renglones del papel de una factura.
 *
 * Se borra todo y se vuelve a insertar, en vez de calcular altas, bajas y
 * cambios: lo que manda la pantalla es la verdad completa del papel, y compararla
 * contra lo que había solo agrega una forma de equivocarse. Son unas cuantas
 * filas por factura; no vale la pena optimizarlo.
 *
 * Los ids cambian en cada guardado, y eso está bien: el renglón del papel no es
 * una entidad con historia, es una transcripción. Lo que tiene historia es el
 * lote y la corrección, y esos no se tocan aquí.
 */
export async function reemplazarRenglones(
  facturaId: number, renglones: RenglonAGuardar[],
): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request()
      .input('id', sql.Int, facturaId)
      .query('DELETE FROM facturas_renglones WHERE factura_id = @id')

    for (const r of renglones) {
      await tx.request()
        .input('fid',   sql.Int,            facturaId)
        .input('pieza', sql.Int,            r.pieza_id)
        .input('cant',  sql.Int,            r.cantidad)
        .input('costo', sql.Decimal(18, 2), r.costo_unitario)
        .input('lote',  sql.Int,            r.lote_id ?? null)
        .query(`
          INSERT INTO facturas_renglones
            (factura_id, pieza_id, cantidad, costo_unitario, lote_id)
          VALUES (@fid, @pieza, @cant, @costo, @lote)`)
    }

    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/** Cuelga un lote recién creado del renglón del papel que lo pedía. */
export async function ligarLote(renglonId: number, loteId: number): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('rid',  sql.Int, renglonId)
    .input('lote', sql.Int, loteId)
    .query('UPDATE facturas_renglones SET lote_id = @lote WHERE id = @rid')
}

/** Un renglón del papel, para poder registrar la compra que le falta. */
export async function leerRenglon(renglonId: number): Promise<{
  id: number
  factura_id: number
  pieza_id: number
  cantidad: number
  costo_unitario: number
  lote_id: number | null
  folio: string
  proveedor_id: number
  fecha_compra: string
  comprado_por: string
  cabecera_revisada_en: Date | null
} | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, renglonId)
    .query(`
      SELECT fr.id, fr.factura_id, fr.pieza_id, fr.cantidad, fr.costo_unitario,
             fr.lote_id,
             f.folio, f.proveedor_id,
             CONVERT(char(10), f.fecha_compra, 23) AS fecha_compra,
             f.comprado_por, f.cabecera_revisada_en
      FROM facturas_renglones fr
      JOIN facturas f ON f.id = fr.factura_id
      WHERE fr.id = @id`)
  return r.recordset[0] ?? null
}

/** Cuántos renglones del papel tiene la factura. Sirve para saber si ya se capturó. */
export async function cuantosRenglones(facturaId: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query('SELECT COUNT(*) AS n FROM facturas_renglones WHERE factura_id = @id')
  return r.recordset[0].n as number
}
