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
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones'),
  nombre: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(40, 'Máximo 40 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones'),
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

export async function modelosCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const { marca, nombre, anio, tipos_permitidos } = Schema.parse(await req.json())
    const created = await service.create(marca, nombre, anio ?? null, tipos_permitidos)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'modelos',
      registroId: created.id,
      despues: await capturar('modelos', created.id),
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('modelos-create', { methods: ['POST'], route: 'modelos', authLevel: 'anonymous', handler: modelosCreate })
