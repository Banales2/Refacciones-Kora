import { z } from 'zod'
import { KM_MAX } from './common'

export const EtapaSchema = z.enum(['fabricante', 'posgarantia'])

// El punto cero del recorrido de una unidad en una etapa. `km_inicio` es el
// odómetro desde el que se cuenta —una unidad usada no arranca en cero— y
// `fecha_inicio` es desde cuándo corren los límites de meses.
//
// En la etapa de posgarantía los dos pueden ir en null a propósito: eso quiere
// decir "derívalos", y el servicio los saca del último servicio que la unidad
// realmente recibió.
export const AsignarProgramaSchema = z.object({
  etapa:        EtapaSchema.default('fabricante'),
  programa_id:  z.coerce.number().int().positive().optional(),
  km_inicio:    z.coerce.number().int().min(0).max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional(),
  fecha_inicio: z.string().date().nullable().optional(),
})

// Fijar la etapa a mano, o soltarla (null) para que vuelva a decidirla la
// garantía principal del modelo.
export const EtapaForzadaSchema = z.object({
  etapa: EtapaSchema.nullable(),
})

// Lo que una unidad hace distinto del programa de su modelo. Llega entero: es
// un reemplazo, no un parche, porque así se edita en la cuadrícula.
export const ExcepcionesSchema = z.object({
  fases: z.array(z.object({
    fase_id: z.coerce.number().int().positive(),
    // Null = la marca del catálogo.
    km:      z.coerce.number().int().positive().max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional(),
    costo:   z.coerce.number().min(0, 'No puede ser negativo').max(9_999_999, 'Máximo $9,999,999')
      .nullable().optional(),
    omitida: z.boolean().default(false),
  })).max(60, 'Máximo 60 columnas').default([]),
  operaciones: z.array(z.object({
    operacion_id: z.coerce.number().int().positive(),
    activa:       z.boolean().default(true),
    limite_meses: z.coerce.number().int().positive().max(600, 'Máximo 600 meses')
      .nullable().optional(),
  })).max(500, 'Máximo 500 renglones').default([]),
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
