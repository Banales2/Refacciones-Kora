import { z } from 'zod'
import { TEXTO_LIBRE } from './common'

// Por qué se necesita. Obligatorio a propósito: es lo único que le permite a
// quien autoriza decidir sin tener que llamar por teléfono. Un mínimo de 5
// caracteres no impide escribir "urgen", pero sí frena el punto y el "x".
const motivo = z
  .string()
  .trim()
  .min(5, 'Explica para qué se necesita')
  .max(500, 'Máximo 500 caracteres')
  .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')

export const SolicitudCreateSchema = z.object({
  // A dónde va la mercancía. A quien tiene sucursal asignada se la pone el
  // servidor con la suya, así que aquí es opcional y sobra si la manda.
  sucursal_id: z.coerce.number().int().positive().optional(),
  motivo,
  renglones: z
    .array(z.object({
      pieza_id: z.coerce.number().int().positive(),
      cantidad: z.coerce.number().int()
        .min(1, 'Mínimo 1 unidad')
        .max(999, 'Máximo 999 unidades'),
    }))
    .min(1, 'Agrega al menos una refacción')
    // El tope no es arbitrario: una solicitud de más de cincuenta partidas
    // capturada a mano es más probable que sea un error que una necesidad.
    .max(50, 'Máximo 50 refacciones por solicitud')
    .refine(
      (rs) => new Set(rs.map((r) => r.pieza_id)).size === rs.length,
      'Una misma refacción aparece dos veces; súmala en una sola cantidad',
    ),
})

export const SolicitudResolverSchema = z
  .object({
    estado: z.enum(['aprobada', 'rechazada']),
    nota: z
      .string().trim().max(500, 'Máximo 500 caracteres')
      .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
      .nullish(),
  })
  // Un "no" sin razón obliga a quien pidió a volver a preguntar, y entonces el
  // canal no sirvió de nada. Al aprobar la nota sobra: la respuesta ya es la
  // que se esperaba.
  .refine((d) => d.estado !== 'rechazada' || !!d.nota?.trim(), {
    message: 'Al rechazar hay que decir por qué',
    path: ['nota'],
  })

export type SolicitudCreate   = z.infer<typeof SolicitudCreateSchema>
export type SolicitudResolver = z.infer<typeof SolicitudResolverSchema>
