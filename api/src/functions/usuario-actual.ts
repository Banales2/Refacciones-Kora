// Quién es quien está conectado, con el nombre dado de alta en `usuarios`.
//
// `/.auth/me` sólo devuelve el correo, y hay pantallas que necesitan mostrar el
// mismo texto que la API va a guardar (p. ej. quién autoriza una incidencia).
// Sin este endpoint el formulario enseñaría un correo y se guardaría un nombre.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { nombreOCorreo } from '../shared/usuario'
import { sucursalAsignada } from '../shared/alcance'

export async function usuarioActual(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'lector', 'viewer', 'practicante', 'responsable')
    return {
      status: 200,
      jsonBody: {
        data: {
          email:  user.userDetails,
          nombre: await nombreOCorreo(user),
          roles:  user.userRoles,
          // A qué sucursal está acotado (null = ve todo). Sólo es cortesía para
          // la interfaz: quien filtra de verdad es la API.
          sucursal_id: await sucursalAsignada(user),
        },
      },
    }
  } catch (err) { return handleError(err, ctx) }
}

app.http('usuario-actual', {
  methods: ['GET'],
  route: 'usuario-actual',
  authLevel: 'anonymous',
  handler: usuarioActual,
})
