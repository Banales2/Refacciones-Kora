import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { COLS_ARCHIVADO, filtroArchivado, type CamposArchivado } from './archivadoRepo'

// Tipo de pieza: lo que un modelo necesita ("filtro de aire"), sin decir cuál
// pieza concreta. La pieza que lo cubre se elige por vehículo.
export interface TipoPieza extends CamposArchivado {
  id:     number
  nombre: string
  /**
   * Las piezas de este tipo se identifican una por una, en vez de contarse a
   * granel. Decide cómo se lleva su existencia. Ver `docs/piezas-identificadas.md`.
   */
  rastreo_individual: boolean
  /**
   * Las piezas de este tipo se miden con profundímetro en el chequeo diario:
   * llantas, balatas. Ver `db/migrations/052_desgaste_en_el_chequeo.sql`.
   */
  mide_desgaste: boolean
  /**
   * Los milímetros en los que la lectura ya cuenta como falla, y de ahí para
   * abajo. `null` = se mide pero no hay mínimo definido: se guarda la lectura
   * y no se abre ninguna incidencia.
   */
  desgaste_minimo_mm: number | null
}

// Las tres consultas devuelven lo mismo, y el flag llega del driver como 0/1.
const COLS = `id, nombre, rastreo_individual, mide_desgaste, desgaste_minimo_mm, ${COLS_ARCHIVADO}`
const OUT  = 'INSERTED.id, INSERTED.nombre, INSERTED.rastreo_individual, ' +
             'INSERTED.mide_desgaste, INSERTED.desgaste_minimo_mm, ' +
             'INSERTED.archivado_en, INSERTED.archivado_motivo'

// `bit` no es booleano en JS: sin esto, `rastreo_individual` viajaría como 0 o 1
// y cualquier `if` del cliente trataría el 0 como falso por accidente, no por
// diseño. Se normaliza en la frontera, una sola vez.
function aTipo(r: Record<string, unknown>): TipoPieza {
  return {
    ...r,
    rastreo_individual: !!r.rastreo_individual,
    mide_desgaste:      !!r.mide_desgaste,
    // DECIMAL llega como string del driver cuando no cabe en un number seguro;
    // aquí siempre cabe, pero se normaliza para no dejar al cliente comparando
    // "4.0" contra 4.
    desgaste_minimo_mm: r.desgaste_minimo_mm == null ? null : Number(r.desgaste_minimo_mm),
  } as TipoPieza
}

// Por defecto solo lo que está en uso; `incluirArchivados` es para la pantalla
// del catálogo, que necesita verlos para poder restaurarlos.
export async function findAll(incluirArchivados = false): Promise<TipoPieza[]> {
  const pool = await getPool()
  const filtro = filtroArchivado(incluirArchivados)
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM tipos_pieza ${filtro ? `WHERE ${filtro}` : ''} ORDER BY nombre`)
  return r.recordset.map(aTipo)
}

export async function findById(id: number): Promise<TipoPieza | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM tipos_pieza WHERE id = @id`)
  return r.recordset[0] ? aTipo(r.recordset[0]) : null
}

export async function create(nombre: string, rastreo = false): Promise<TipoPieza> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre',  sql.NVarChar(80), nombre)
    .input('rastreo', sql.Bit,          rastreo)
    .query(`
      INSERT INTO tipos_pieza (nombre, rastreo_individual)
      OUTPUT ${OUT}
      VALUES (@nombre, @rastreo)`)
  return aTipo(r.recordset[0])
}

/**
 * Solo pisa lo que viene. El nombre y el flag se editan por separado —renombrar
 * un tipo desde el catálogo no debe apagarle el rastreo sin querer— así que
 * cada uno se manda solo cuando cambia.
 */
export async function update(
  id: number, nombre?: string, rastreo?: boolean,
  desgaste?: { mide: boolean; minimo: number | null },
): Promise<TipoPieza | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',      sql.Int,          id)
    .input('nombre',  sql.NVarChar(80), nombre ?? null)
    .input('rastreo', sql.Bit,          rastreo ?? null)
    .input('mide',    sql.Bit,          desgaste?.mide ?? null)
    // El mínimo se manda junto con el flag y no por su cuenta: así apagar la
    // medición limpia el número en la misma operación, y un COALESCE no puede
    // impedir que se borre un mínimo a propósito.
    .input('minimo',  sql.Decimal(4, 1), desgaste ? desgaste.minimo : null)
    .query(`
      UPDATE tipos_pieza SET
        nombre             = COALESCE(@nombre, nombre),
        rastreo_individual = COALESCE(@rastreo, rastreo_individual),
        mide_desgaste      = COALESCE(@mide, mide_desgaste),
        desgaste_minimo_mm = CASE WHEN @mide IS NULL THEN desgaste_minimo_mm ELSE @minimo END
      OUTPUT ${OUT}
      WHERE id = @id`)
  return r.recordset[0] ? aTipo(r.recordset[0]) : null
}

// ¿Ya existe un tipo con este nombre? exceptId excluye el propio al editar.
export async function existsNombre(nombre: string, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre', sql.NVarChar(80), nombre)
    .input('except', sql.Int,          exceptId ?? null)
    .query('SELECT TOP 1 id FROM tipos_pieza WHERE nombre = @nombre AND (@except IS NULL OR id <> @except)')
  return r.recordset.length > 0
}

// Referencias que impiden borrar el tipo: modelos que lo piden, vehículos que lo
// necesitan por su cuenta o que ya eligieron pieza para él, y piezas del
// catálogo marcadas con este tipo.
export async function countReferencias(id: number): Promise<{ modelos: number; vehiculos: number; piezas: number }> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT
        -- DISTINCT porque un modelo puede pedir el mismo tipo varias veces (dos
        -- filtros de aire con etiquetas distintas) y aquí se cuentan modelos, no
        -- renglones: "lo usan 3 modelos" tiene que decir 3 y no 5.
        (SELECT COUNT(DISTINCT modelo_id) FROM tipos_pieza_modelo WHERE tipo_pieza_id = @id) AS modelos,
        -- Un vehículo puede requerir el tipo sin haber elegido pieza todavía, y
        -- ambas tablas lo referencian: el UNION lo cuenta una sola vez.
        (SELECT COUNT(*) FROM (
          SELECT vehiculo_id FROM piezas_vehiculo      WHERE tipo_pieza_id = @id
          UNION
          SELECT vehiculo_id FROM tipos_pieza_vehiculo WHERE tipo_pieza_id = @id
        ) AS refs)                                                          AS vehiculos,
        (SELECT COUNT(*) FROM piezas             WHERE tipo_pieza_id = @id) AS piezas`)
  return r.recordset[0]
}

