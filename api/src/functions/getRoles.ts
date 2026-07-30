import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import * as sql from 'mssql'
import { getPool } from '../shared/db'

const OID_CLAIM = 'http://schemas.microsoft.com/identity/claims/objectidentifier'

// `EntraObjectId` es uniqueidentifier: pasarle algo que no sea GUID hace que
// SQL Server falle al convertir y el error acabaría confundiéndose con "usuario
// sin alta". Aceptamos las dos formas que convierte SQL Server: con y sin
// guiones.
const GUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

// El driver valida el GUID por su cuenta y rechaza la forma sin guiones, que es
// precisamente la que usa el `userId` de Static Web Apps. La reinsertamos.
function normalizarGuid(valor: string): string {
  if (valor.includes('-')) return valor
  return [
    valor.slice(0, 8),
    valor.slice(8, 12),
    valor.slice(12, 16),
    valor.slice(16, 20),
    valor.slice(20),
  ].join('-')
}

interface RolesRequest {
  identityProvider: string
  userId: string
  userDetails: string
  claims: Array<{ typ: string; val: string }>
  accessToken: string
}

export async function getRoles(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const body = (await request.json()) as RolesRequest

    const email = body.userDetails

    // `userId` es un identificador propio de Static Web Apps, no el Object ID
    // de Entra: el que coincide con lo que damos de alta en BD es el claim
    // `oid`. Probamos ambos porque SWA no siempre incluye los claims.
    const oidClaim = body.claims?.find((c) => c.typ === OID_CLAIM)?.val
    const candidatos = [oidClaim, body.userId]
      .filter((v): v is string => !!v && GUID.test(v))
      .map(normalizarGuid)

    if (candidatos.length === 0) {
      context.warn(
        `Login sin identificador utilizable: ${email} userId=${body.userId} oid=${oidClaim}`
      )
      return { status: 200, jsonBody: { roles: [] } }
    }

    const pool = await getPool()

    const consulta = pool.request()
    candidatos.forEach((valor, i) => consulta.input(`id${i}`, sql.UniqueIdentifier, valor))
    const condiciones = candidatos.map((_, i) => `EntraObjectId = @id${i}`).join(' OR ')

    const result = await consulta.query(
      `SELECT id, rol FROM usuarios WHERE ${condiciones}`
    )

    if (result.recordset.length === 0) {
      context.warn(
        `Usuario sin alta en BD intentó entrar: ${email} candidatos=${candidatos.join(',')}`
      )
      return { status: 200, jsonBody: { roles: [] } }
    }

    const usuario = result.recordset[0]

    return {
      status: 200,
      jsonBody: { roles: [usuario.rol] },
    }
  } catch (err) {
    context.error('Error en getRoles:', err)
    return { status: 200, jsonBody: { roles: [] } }
  }
}

app.http('getRoles', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: getRoles,
})
