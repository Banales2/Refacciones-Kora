import { z } from 'zod'
import { KM_MAX, lecturaKm } from './common'

// Fecha local (no UTC) para no rechazar "hoy" en zonas horarias detrás de UTC.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// La bomba despacha con milésimas de litro y el ticket las imprime así; la
// columna guarda DECIMAL(10,3), así que un cuarto decimal se redondearía en
// silencio y lo capturado dejaría de cuadrar con el papel: se rechaza.
const litros = z.coerce
  .number()
  .positive('Debe ser mayor a 0')
  // El margen absorbe la representación binaria (45.678 * 1000 = 45677.999…).
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Máximo 3 decimales')

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
  .refine((v) => v <= todayIso(), 'No puede ser una fecha futura')

const costo = z.coerce.number().min(0, 'No puede ser negativo')

// Los trailers tienen varios tanques y la bomba imprime un ticket por tanque;
// la gasolinera los factura por separado. Ver la migración 059.
export const TICKETS_MAX = 3

const ticket = z.object({
  // Al editar, el ticket que ya existía. Sin él se da de alta uno nuevo: un
  // ticket que ya casó con una factura tiene que conservar su id.
  id: z.coerce.number().int().positive().optional(),
  litros,
  costo,
})

const tickets = z
  .array(ticket)
  .min(1, 'Captura al menos un ticket')
  .max(TICKETS_MAX, `Máximo ${TICKETS_MAX} tickets por recarga`)

export type TicketRecarga = z.infer<typeof ticket>

// Una pantalla de antes de los tickets (la PWA que no se ha recargado) manda
// `litros` y `costo` sueltos: son un solo ticket.
function conTickets(body: unknown): unknown {
  if (body && typeof body === 'object' && !('tickets' in body) && 'litros' in body) {
    const { litros, costo, ...resto } = body as Record<string, unknown>
    return { ...resto, tickets: [{ litros, costo }] }
  }
  return body
}

export const RecargaCreateSchema = z.preprocess(conTickets, z.object({
  gasolinera_id: z.coerce.number().int().min(1, 'Gasolinera requerida'),
  conductor_id:  z.coerce.number().int().min(1, 'Conductor requerido'),
  // Obligatorio al registrar. Las recargas anteriores a esta función se
  // quedaron sin vale y por eso la columna sigue siendo NULL-able en la tabla.
  vale_id: z.coerce.number().int().min(1, 'Vale requerido'),
  fecha,
  tickets,
  kilometraje: lecturaKm(),
}))

// El chofer cargó de su bolsa porque no le alcanzaba para ir por el vale: no hay
// vale, la gasolinera fue la que estaba a mano y nadie leyó el odómetro. Ver la
// migración 056.
export const RecargaEmergenciaSchema = z.object({
  conductor_id: z.coerce.number().int().min(1, 'Conductor requerido'),
  fecha,
  litros,
  costo,
})

// `litros` y `costo` sueltos siguen valiendo para una recarga de UN ticket (la
// de emergencia siempre lo es): corrigen ese ticket. Con más de uno hay que
// mandar `tickets`, y lo decide el servicio, que sabe cuántos tiene.
export const RecargaUpdateSchema = z.object({
  gasolinera_id: z.coerce.number().int().min(1).optional(),
  conductor_id:  z.coerce.number().int().min(1).optional(),
  vale_id:       z.coerce.number().int().min(1, 'Vale requerido').optional(),
  fecha:  fecha.optional(),
  tickets: tickets.optional(),
  litros: litros.optional(),
  costo:  costo.optional(),
  kilometraje: lecturaKm().optional(),
})

export type RecargaCreate = z.infer<typeof RecargaCreateSchema>
export type RecargaUpdate = z.infer<typeof RecargaUpdateSchema>
export type RecargaEmergencia = z.infer<typeof RecargaEmergenciaSchema>
