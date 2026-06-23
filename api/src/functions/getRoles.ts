import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPool } from '../shared/db'

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

    const entraObjectId = body.userId
    const email = body.userDetails

    if (!entraObjectId) {
      return { status: 200, jsonBody: { roles: [] } }
    }

    const pool = await getPool()

    const result = await pool
      .request()
      .input('entraId', entraObjectId)
      .query('SELECT id, rol FROM usuarios WHERE EntraObjectId = @entraId')

    if (result.recordset.length === 0) {
      context.warn(`Usuario sin alta en BD intentó entrar: ${email} (${entraObjectId})`)
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
