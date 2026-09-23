import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/modelosService'
import { TIPOS_VEHICULO } from '../schemas/vehiculoSchema'
import { TEXTO_SIMPLE, ANIO_MODELO } from '../schemas/common'

const Schema = z.object({
  marca: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(40, 'Máximo 40 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')
    .optional(),
  nombre: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(40, 'Máximo 40 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')
    .optional(),
  anio: z
    .string()
    .trim()
    .regex(ANIO_MODELO, 'Usa AAAA o AAAA-versión (ej. 2024 o 2024-1)')
    .refine((v) => {
      const y = Number(v.slice(0, 4))
      return y >= 1950 && y <= 2100
    }, 'El año debe estar entre 1950 y 2100')
    .nullable()
    .optional(),
  tipos_permitidos: z.array(z.enum(TIPOS_VEHICULO)).optional(),
})

export async function modelosUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const { marca, nombre, anio, tipos_permitidos } = Schema.parse(await req.json())
    const antes = await capturar('modelos', id)
    const updated = await service.update(id, marca, nombre, anio, tipos_permitidos)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'modelos',
      registroId: id,
      antes,
      despues: await capturar('modelos', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('modelos-update', { methods: ['PUT', 'PATCH'], route: 'modelos/{id}', authLevel: 'anonymous', handler: modelosUpdate })
