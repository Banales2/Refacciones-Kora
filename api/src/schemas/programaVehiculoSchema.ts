import { z } from 'zod'
import { KM_MAX } from './common'

// El punto cero del recorrido de una unidad. `km_inicio` es el odómetro desde
// el que se cuenta —una unidad usada no arranca en cero— y `fecha_inicio` es
// desde cuándo corren los límites de meses.
export const AsignarProgramaSchema = z.object({
  programa_id:  z.coerce.number().int().positive().optional(),
  km_inicio:    z.coerce.number().int().min(0).max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional(),
  fecha_inicio: z.string().date().nullable().optional(),
})

export const VisitaSchema = z.object({
  fecha:            z.string().date(),
  // Ausente = se toma el odómetro que la unidad trae hoy.
  km:               z.coerce.number().int().min(0).max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional(),
  mantenimiento_id: z.coerce.number().int().positive().nullable().optional(),
})

export const AtenderOperacionSchema = z.object({
  fecha: z.string().date(),
  km:    z.coerce.number().int().min(0).max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional(),
})
