import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/registrosCambiosService'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

const Consulta = z.object({
  usuario: z.string().trim().max(255).optional(),
  accion:  z.enum(['CREAR', 'EDITAR', 'ELIMINAR', 'LOGIN']).optional(),
  tabla:   z.string().trim().max(80).optional(),
  desde:   z.string().regex(FECHA).optional(),
  hasta:   z.string().regex(FECHA).optional(),
  texto:   z.string().trim().max(200).optional(),
  pagina:  z.coerce.number().int().min(1).default(1),
  // El tope evita que alguien pida la bitácora entera en una sola petición.
  tamano:  z.coerce.number().int().min(1).max(200).default(50),
})

// La bitácora enseña quién hizo qué y con qué correo, de toda la organización.
// Es la única pantalla restringida a admin; el `allowedRoles` de
// staticwebapp.config.json impone lo mismo por fuera.
export async function registrosCambiosList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin')

    const params = Object.fromEntries(request.query.entries())
    // Los desplegables mandan cadena vacía al limpiarse; para zod eso es un
    // valor, no una ausencia, y acabaría filtrando por accion = ''.
    for (const k of Object.keys(params)) if (params[k] === '') delete params[k]

    const data = await service.listar(Consulta.parse(params))
    return { status: 200, jsonBody: data }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('registros-cambios-list', {
  methods: ['GET'],
  route: 'registros-cambios',
  authLevel: 'anonymous',
  handler: registrosCambiosList,
})

export async function registrosCambiosFiltros(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin')
    return { status: 200, jsonBody: await service.filtros() }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('registros-cambios-filtros', {
  methods: ['GET'],
  route: 'registros-cambios/filtros',
  authLevel: 'anonymous',
  handler: registrosCambiosFiltros,
})
