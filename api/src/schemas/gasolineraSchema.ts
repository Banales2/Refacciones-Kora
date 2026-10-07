import { z } from 'zod'

export const GasolineraCreateSchema = z.object({
  nombre:    z.string().trim().min(1, 'Nombre requerido').max(120),
  ubicacion: z.string().trim().min(1, 'Ubicación requerida').max(200),
})

/**
 * El permiso de expendio de la CRE, como viene en el complemento de
 * Hidrocarburos: `PL/11284/EXP/ES/2015`. Es de UNA estación.
 */
export const permisoCre = z
  .string()
  .trim()
  .toUpperCase()
  // Los de las cuatro facturas de octubre de 2026 son todos PL/####/EXP/ES/2015;
  // la forma se deja un poco abierta para no rechazar la factura legítima de una
  // estación con otra variante.
  .regex(/^[A-Z]{2}\/\d+\/[A-Z]+\/[A-Z]+\/\d{4}$/, 'El permiso de la CRE tiene la forma PL/11284/EXP/ES/2015')

export const rfc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'RFC inválido')

export const GasolineraUpdateSchema = z.object({
  nombre:    z.string().trim().min(1).max(120).optional(),
  ubicacion: z.string().trim().min(1).max(200).optional(),
  /** null lo desliga: sus próximas facturas preguntarán otra vez de quién son. */
  permiso_cre: permisoCre.nullable().optional(),
  rfc:         rfc.nullable().optional(),
})

export type GasolineraCreate = z.infer<typeof GasolineraCreateSchema>
export type GasolineraUpdate = z.infer<typeof GasolineraUpdateSchema>
