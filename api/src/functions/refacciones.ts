import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPool } from '../shared/db'

export async function refacciones(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const pool = await getPool()
    const result = await pool
      .request()
      .query('SELECT * FROM piezas')

    return {
      status: 200,
      jsonBody: { data: result.recordset },
    }
  } catch (err) {
    // NUNCA expongas detalles del error al cliente
    context.error('Error consultando refacciones:', err)
    return {
      status: 500,
      jsonBody: { error: 'Error interno del servidor' },
    }
  }
}

app.http('refacciones', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: refacciones,
})