// Archivar y restaurar un renglón de catálogo (migración 033).
//
// Vive aparte porque la operación es idéntica en los ocho catálogos y lo único
// que cambia es el nombre de la tabla: repetirla ocho veces garantizaba que
// tarde o temprano una se quedara sin actualizar. No sustituye a los
// repositorios —cada uno sigue con sus lecturas y su alta—, solo se lleva esta
// escritura, que no tiene nada propio de cada catálogo.
//
// ARCHIVAR NO ES BORRAR. El renglón se queda entero en la base y se sigue
// resolviendo por id: los registros históricos que lo referencian —recargas con
// su gasolinera, lotes con su proveedor, mantenimientos con su técnico— siguen
// diciendo de qué hablaban. Lo único que cambia es que deja de ofrecerse en el
// catálogo y en los selectores del alta.
import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Lista blanca, y el motivo es de seguridad: el nombre de la tabla entra en el
// SQL concatenado —un identificador no se puede parametrizar— así que el único
// origen posible de ese nombre tiene que ser esta constante, nunca la petición.
export const TABLAS_ARCHIVABLES = [
  'sucursales', 'rutas', 'gasolineras', 'conductores',
  'tecnicos', 'proveedores', 'piezas', 'tipos_pieza',
  // No es un catálogo: es un papel que se dio por perdido (migración 055). Se
  // sube aquí porque la operación es exactamente la misma —el renglón se
  // queda, deja de ofrecerse— y repetirla aparte era garantizar que una de las
  // dos se quedara sin arreglar. Lo que NO comparte es la puerta: archivar un
  // catálogo es de admin, y dar por perdido un vale es de todos los días, así
  // que tiene su propio endpoint.
  'vales_gasolina',
] as const

export type TablaArchivable = typeof TABLAS_ARCHIVABLES[number]

/** Las columnas del archivado, para agregarlas al SELECT de cada repositorio. */
export const COLS_ARCHIVADO =
  'CONVERT(char(10), archivado_en, 23) AS archivado_en, archivado_motivo'

/** El filtro del catálogo. Vacío cuando se piden también los archivados. */
export function filtroArchivado(incluirArchivados: boolean, alias = ''): string {
  if (incluirArchivados) return ''
  return `${alias ? `${alias}.` : ''}archivado_en IS NULL`
}

/** Campos que todo renglón archivable expone hacia fuera. */
export interface CamposArchivado {
  archivado_en:     string | null
  archivado_motivo: string | null
}

// Devuelve false si el renglón no existe o ya estaba archivado, para que el
// servicio distinga "no lo encontré" de "no había nada que hacer".
export async function archivar(
  tabla: TablaArchivable, id: number, motivo: string | null,
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',     sql.Int,           id)
    .input('motivo', sql.NVarChar(200), motivo)
    .query(`
      UPDATE ${tabla} SET archivado_en = SYSDATETIME(), archivado_motivo = @motivo
      OUTPUT INSERTED.id WHERE id = @id AND archivado_en IS NULL`)
  return r.recordset.length > 0
}

export async function restaurar(tabla: TablaArchivable, id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      UPDATE ${tabla} SET archivado_en = NULL, archivado_motivo = NULL
      OUTPUT INSERTED.id WHERE id = @id AND archivado_en IS NOT NULL`)
  return r.recordset.length > 0
}

/** ¿Está archivado? Null si el renglón no existe. */
export async function estaArchivado(tabla: TablaArchivable, id: number): Promise<boolean | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT archivado_en FROM ${tabla} WHERE id = @id`)
  if (!r.recordset[0]) return null
  return r.recordset[0].archivado_en != null
}
