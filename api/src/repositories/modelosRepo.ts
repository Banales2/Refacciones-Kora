import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Modelo {
  id:               number
  marca:            string
  nombre:           string
  // Año-versión del modelo ("2018" o "2018-1"). Permite distinguir dos modelos
  // de igual marca/nombre pero año distinto, y también dos versiones del mismo
  // año que salieron con piezas distintas. Null en modelos antiguos que no lo
  // capturaron.
  anio:             string | null
  // Tipos de vehículo que este modelo puede generar. Vacío = sin restricción
  // (se permiten todos). Evita, p. ej., crear un montacargas (sin kilometraje)
  // a partir de un modelo cuyo programa de mantenimiento va por kilometraje.
  tipos_permitidos: string[]
  // Cuándo se dejó de ofrecer el modelo al dar de alta unidades, y por qué.
  // Null = vigente. Un modelo de baja sigue existiendo entero —programa,
  // garantías, tipos de pieza— y los vehículos que ya lo usan lo siguen
  // mostrando; lo único que cambia es que no aparece en el catálogo ni en el
  // selector del alta (ver migración 032).
  baja_en:          string | null
  baja_motivo:      string | null
  created_at:       string
  updated_at:       string
}

const COLS = `id, marca, nombre, anio, tipos_permitidos,
  CONVERT(char(10), baja_en, 23) AS baja_en, baja_motivo,
  created_at, updated_at`

// En la BD se guarda como CSV ("camion,utilitario"); hacia fuera se expone como
// arreglo. NULL/'' significa "sin restricción".
function parseTipos(v: string | null): string[] {
  if (!v) return []
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

function serializeTipos(tipos: string[] | null | undefined): string | null {
  if (!tipos || tipos.length === 0) return null
  return tipos.join(',')
}

// Fila cruda de la BD: tipos_permitidos llega como CSV (o NULL).
type ModeloRow = Omit<Modelo, 'tipos_permitidos'> & { tipos_permitidos: string | null }

function mapRow(row: ModeloRow): Modelo {
  return { ...row, tipos_permitidos: parseTipos(row.tipos_permitidos) }
}

// El catálogo. Por defecto solo los vigentes: los dados de baja siguen en la
// base y se resuelven por id, pero no se ofrecen para dar de alta unidades.
// `incluirBajas` es para la pantalla de modelos, que necesita poder verlos
// para reactivarlos.
export async function findAll(incluirBajas = false): Promise<Modelo[]> {
  const pool = await getPool()
  const filtro = incluirBajas ? '' : 'WHERE baja_en IS NULL'
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM modelos ${filtro} ORDER BY marca, nombre`)
  return r.recordset.map(mapRow)
}

export async function findById(id: number): Promise<Modelo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM modelos WHERE id = @id`)
  return r.recordset[0] ? mapRow(r.recordset[0]) : null
}

// Tipos permitidos de un modelo, para validar el alta de vehículos. Arreglo
// vacío = sin restricción (o modelo inexistente: el FK lo rechazará al insertar).
export async function findTiposPermitidos(id: number): Promise<string[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT tipos_permitidos FROM modelos WHERE id = @id')
  return r.recordset[0] ? parseTipos(r.recordset[0].tipos_permitidos) : []
}

export async function create(marca: string, nombre: string, anio: string | null, tiposPermitidos?: string[]): Promise<Modelo> {
  const pool = await getPool()
  const r = await pool.request()
    .input('marca',  sql.NVarChar(80),  marca)
    .input('nombre', sql.NVarChar(120), nombre)
    .input('anio',   sql.VarChar(6),    anio)
    .input('tipos',  sql.NVarChar(200), serializeTipos(tiposPermitidos))
    .query(`INSERT INTO modelos (marca, nombre, anio, tipos_permitidos) OUTPUT INSERTED.* VALUES (@marca, @nombre, @anio, @tipos)`)
  return mapRow(r.recordset[0])
}

export async function update(id: number, marca?: string, nombre?: string, anio?: string | null, tiposPermitidos?: string[]): Promise<Modelo | null> {
  const pool = await getPool()
  const sets: string[] = ['updated_at=SYSDATETIME()']
  const req = pool.request().input('id', sql.Int, id)
  if (marca  !== undefined) { req.input('marca',  sql.NVarChar(80),  marca);  sets.push('marca=@marca')   }
  if (nombre !== undefined) { req.input('nombre', sql.NVarChar(120), nombre); sets.push('nombre=@nombre') }
  if (anio   !== undefined) { req.input('anio',   sql.VarChar(6),    anio);   sets.push('anio=@anio')     }
  if (tiposPermitidos !== undefined) { req.input('tipos', sql.NVarChar(200), serializeTipos(tiposPermitidos)); sets.push('tipos_permitidos=@tipos') }
  const r = await req.query(
    `UPDATE modelos SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=@id`
  )
  return r.recordset[0] ? mapRow(r.recordset[0]) : null
}

// ¿Existe ya un modelo con la misma marca + nombre + año? (comparación
// insensible a mayúsculas por la colación por defecto de SQL Server). exceptId
// excluye el propio registro al editar.
export async function existsDuplicate(
  marca: string, nombre: string, anio: string | null, exceptId?: number
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('marca',  sql.NVarChar(80),  marca)
    .input('nombre', sql.NVarChar(120), nombre)
    .input('anio',   sql.VarChar(6),    anio)
    .input('except', sql.Int,           exceptId ?? null)
    .query(`
      SELECT TOP 1 id FROM modelos
      WHERE marca = @marca AND nombre = @nombre
        AND (anio = @anio OR (anio IS NULL AND @anio IS NULL))
        AND (@except IS NULL OR id <> @except)`)
  return r.recordset.length > 0
}

export async function countVehiculos(id: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS cnt FROM vehiculos WHERE modelo_id = @id')
  return r.recordset[0].cnt
}

// Baja y reactivación. No hay borrado: un modelo es el padre del programa de
// mantenimiento, de las garantías del catálogo y de la lista de tipos de pieza,
// y borrarlo se llevaba todo eso sin vuelta (migración 032).
export async function darDeBaja(id: number, motivo: string | null): Promise<Modelo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',     sql.Int,           id)
    .input('motivo', sql.NVarChar(200), motivo)
    .query(`
      UPDATE modelos SET baja_en = SYSDATETIME(), baja_motivo = @motivo, updated_at = SYSDATETIME()
      OUTPUT INSERTED.id WHERE id = @id AND baja_en IS NULL`)
  return r.recordset[0] ? findById(id) : null
}

export async function reactivar(id: number): Promise<Modelo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      UPDATE modelos SET baja_en = NULL, baja_motivo = NULL, updated_at = SYSDATETIME()
      OUTPUT INSERTED.id WHERE id = @id AND baja_en IS NOT NULL`)
  return r.recordset[0] ? findById(id) : null
}
