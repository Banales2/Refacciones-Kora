// A qué filas llega quien está conectado.
//
// El rol dice QUÉ PUEDE HACER y lo impone `requireRole`; esto dice QUÉ PUEDE
// VER, y sale de `usuarios.sucursal_id` (migración 049). Son dos ejes: un
// responsable de sucursal es `responsable` por el rol y "de Tepic" por esta
// columna, y cualquier otro rol se acota igual poniéndole una sucursal.
//
// POR QUÉ SE CONSULTA EN CADA PETICIÓN Y NO VIAJA EN LA SESIÓN. Static Web Apps
// sólo guarda en la cookie lo que devuelve `getRoles`, y eso son roles: meter la
// sucursal ahí obligaría a disfrazarla de rol y la dejaría congelada ~8 horas.
// Leyéndola aquí, reasignar a alguien de sucursal surte efecto en un minuto,
// sin pedirle que cierre sesión.
//
// NULL = sin acotar, ve todo. Es lo que tienen los usuarios que no se acotan, y
// por eso el filtro es opt-in: nadie pierde acceso por sorpresa.
//
// FALLA CERRADO. Si la consulta falla, la petición falla; y si el `userId` de la
// sesión no casa con ninguna fila, se niega. Devolver "sin acotar" en cualquiera
// de los dos casos le enseñaría toda la flota a un responsable: basta con que
// SWA mande un `userId` distinto del Object ID (ver docs/autenticacion.md, que
// ya pasó con el proveedor `aad` preconfigurado).
import * as sql from 'mssql'
import { getPool } from './db'
import { AuthError, ClientPrincipal } from './auth'
import { NotFoundError } from './errors'

export interface Alcance {
  /** Sucursal a la que está acotado, o null si ve todo. */
  sucursalId: number | null
}

export const SIN_ACOTAR: Alcance = { sucursalId: null }

// Tipos de vehículo que no tienen base en ninguna sucursal y que cualquier
// responsable ve: las unidades de translado pasan por todos los patios. Las
// cajas y los utilitarios tampoco tienen sucursal, pero no se pidieron; si
// hicieran falta, basta con agregarlos aquí.
export const TIPOS_COMPARTIDOS = ['tractocamion'] as const

// Un minuto: lo bastante corto para que una reasignación se note sin cerrar
// sesión, lo bastante largo para no pagar una consulta en cada petición.
const TTL_MS = 60_000
const cache = new Map<string, { alcance: Alcance; expira: number }>()

// `userId` de Static Web Apps viene sin guiones; la tabla los usa.
function conGuiones(valor: string): string {
  if (valor.includes('-') || valor.length !== 32) return valor
  return [valor.slice(0, 8), valor.slice(8, 12), valor.slice(12, 16), valor.slice(16, 20), valor.slice(20)].join('-')
}

/** Alcance de quien está conectado. Lanza si no se puede resolver. */
export async function alcanceDe(user: ClientPrincipal): Promise<Alcance> {
  const oid = conGuiones(user.userId ?? '')
  const enCache = cache.get(oid)
  if (enCache && enCache.expira > Date.now()) return enCache.alcance

  const pool = await getPool()
  const r = await pool.request()
    .input('oid', sql.NVarChar(100), oid)
    .query(`SELECT TOP 1 sucursal_id FROM usuarios
            WHERE TRY_CONVERT(uniqueidentifier, @oid) IS NOT NULL
              AND EntraObjectId = TRY_CONVERT(uniqueidentifier, @oid)`)

  // Sin fila no se cachea: quien tiene rol está dado de alta, así que esto es
  // un userId que no casa con la tabla, y lo sano es volver a preguntar.
  const fila = r.recordset[0]
  if (!fila) throw new AuthError('Usuario sin alta', 403)

  const alcance: Alcance = { sucursalId: (fila.sucursal_id as number | null) ?? null }
  cache.set(oid, { alcance, expira: Date.now() + TTL_MS })
  return alcance
}

// ── SQL ──────────────────────────────────────────────────────────────────────
//
// Vehículos a los que llega el alcance, como condición sobre una columna de id.
// Pide el parámetro @alcance (ver `conAlcance`); con @alcance NULL es siempre
// verdadera y SQL Server no llega a evaluar la subconsulta.
export function vehiculoEnAlcance(columna: string): string {
  return `(@alcance IS NULL OR ${columna} IN (
    SELECT vehiculo_id FROM camiones    WHERE sucursal_id = @alcance
    UNION ALL
    SELECT vehiculo_id FROM montacargas WHERE sucursal_id = @alcance
    UNION ALL
    SELECT id FROM vehiculos WHERE tipo IN (${TIPOS_COMPARTIDOS.map((t) => `'${t}'`).join(',')})
  ))`
}

/** Declara el @alcance que piden los fragmentos de arriba. */
export function conAlcance(req: sql.Request, alcance: Alcance): sql.Request {
  return req.input('alcance', sql.Int, alcance.sucursalId)
}

// ── Filtros y candados ───────────────────────────────────────────────────────

/** Ids de los vehículos visibles, o null si se ven todos. */
export async function vehiculosVisibles(alcance: Alcance): Promise<Set<number> | null> {
  if (alcance.sucursalId == null) return null
  const pool = await getPool()
  const r = await conAlcance(pool.request(), alcance)
    .query(`SELECT id FROM vehiculos WHERE ${vehiculoEnAlcance('id')}`)
  return new Set(r.recordset.map((f: { id: number }) => f.id))
}

/**
 * Deja sólo las filas de vehículos visibles. Para listados que ya traen
 * `vehiculo_id` y no se paginan en SQL: la flota son decenas de unidades, y
 * filtrar aquí evita meterle el parámetro a cada consulta del repositorio.
 */
export async function soloVisibles<T extends { vehiculo_id: number | null }>(
  filas: T[], alcance: Alcance
): Promise<T[]> {
  const visibles = await vehiculosVisibles(alcance)
  if (!visibles) return filas
  return filas.filter((f) => f.vehiculo_id != null && visibles.has(f.vehiculo_id))
}

/**
 * Deja sólo las filas de la sucursal del alcance. Las filas sin sucursal (un
 * lote histórico que nunca se ubicó) no son de nadie, así que el acotado no las
 * ve: enseñarlas sería enseñar inventario que puede ser de otra.
 */
export function soloDeSucursal<T extends { sucursal_id: number | null }>(
  filas: T[], alcance: Alcance
): T[] {
  if (alcance.sucursalId == null) return filas
  return filas.filter((f) => f.sucursal_id === alcance.sucursalId)
}

/**
 * Candado para rutas que reciben un vehículo. Fuera del alcance contesta 404 y
 * no 403: decir "existe pero no es tuyo" ya es enseñar algo de otra sucursal.
 */
export async function exigirVehiculo(vehiculoId: number, alcance: Alcance): Promise<void> {
  if (alcance.sucursalId == null) return
  const pool = await getPool()
  const r = await conAlcance(pool.request(), alcance)
    .input('vid', sql.Int, vehiculoId)
    .query(`SELECT 1 AS ok FROM vehiculos WHERE id = @vid AND ${vehiculoEnAlcance('id')}`)
  if (r.recordset.length === 0) throw new NotFoundError('Vehículo')
}

// Tablas cuyas filas cuelgan de un vehículo, con el recurso que se nombra en el
// 404. Lista cerrada porque el nombre se concatena al SQL. Sólo están las que
// algún rol acotado puede modificar por id; si mañana se le abre otra, se
// agrega aquí.
const TABLAS_DE_VEHICULO = {
  chequeos: 'Chequeo',
} as const

/** Candado para rutas que reciben el id de una fila que cuelga de un vehículo. */
export async function exigirFilaDeVehiculo(
  tabla: keyof typeof TABLAS_DE_VEHICULO, id: number, alcance: Alcance
): Promise<void> {
  if (alcance.sucursalId == null) return
  const pool = await getPool()
  const r = await conAlcance(pool.request(), alcance)
    .input('id', sql.Int, id)
    .query(`SELECT 1 AS ok FROM ${tabla} WHERE id = @id AND ${vehiculoEnAlcance('vehiculo_id')}`)
  if (r.recordset.length === 0) throw new NotFoundError(TABLAS_DE_VEHICULO[tabla])
}

/**
 * Candado para rutas que reciben una sucursal. Sin sucursal pedida, el acotado
 * recibe la suya: así "todas las sucursales" se vuelve "la mía" en vez de un 404.
 */
export function sucursalPermitida(pedida: number | undefined, alcance: Alcance): number | undefined {
  if (alcance.sucursalId == null) return pedida
  if (pedida != null && pedida !== alcance.sucursalId) throw new NotFoundError('Sucursal')
  return alcance.sucursalId
}
