// Nombre legible de quien está usando el sistema.
//
// La sesión de Static Web Apps sólo trae el correo (`userDetails`); el nombre
// vive en la tabla `usuarios`, ligado al Object ID de Entra. Vivía en audit.ts,
// pero la bitácora dejó de ser el único interesado: las incidencias guardan
// quién las autoriza y quieren el nombre, no el correo.
import * as sql from 'mssql'
import { getPool } from './db'
import { ClientPrincipal } from './auth'

// El nombre no cambia casi nunca, así que se cachea por proceso. El coste de una
// entrada obsoleta es un nombre viejo en un registro; el de no cachear, una
// consulta extra en cada escritura de la aplicación.
const nombres = new Map<string, string | null>()

// `userId` de Static Web Apps viene sin guiones; la tabla los usa.
function conGuiones(valor: string): string {
  if (valor.includes('-') || valor.length !== 32) return valor
  return [valor.slice(0, 8), valor.slice(8, 12), valor.slice(12, 16), valor.slice(16, 20), valor.slice(20)].join('-')
}

/** Nombre dado de alta en `usuarios`, o null si no está o falla la consulta. */
export async function nombreEnBD(userId: string): Promise<string | null> {
  const oid = conGuiones(userId)
  if (nombres.has(oid)) return nombres.get(oid) ?? null
  try {
    const pool = await getPool()
    const r = await pool.request()
      .input('oid', sql.NVarChar(100), oid)
      .query(`SELECT TOP 1 nombre FROM usuarios
              WHERE TRY_CONVERT(uniqueidentifier, @oid) IS NOT NULL
                AND EntraObjectId = TRY_CONVERT(uniqueidentifier, @oid)`)
    const nombre = (r.recordset[0]?.nombre as string) ?? null
    nombres.set(oid, nombre)
    return nombre
  } catch {
    // Sin cachear el fallo: la próxima escritura vuelve a intentarlo.
    return null
  }
}

/**
 * Cómo se llama esta persona para mostrarla en un registro: su nombre si está
 * dado de alta, si no el correo. Nunca queda vacío, porque las columnas que lo
 * guardan son NOT NULL y quedarse sin identificar a nadie es peor que un correo.
 */
export async function nombreOCorreo(user: ClientPrincipal): Promise<string> {
  const nombre = user.userId ? await nombreEnBD(user.userId) : null
  return nombre ?? user.userDetails ?? '(desconocido)'
}
