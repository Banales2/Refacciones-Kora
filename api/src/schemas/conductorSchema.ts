import { z } from 'zod'
import { CODIGO, TEXTO_SIMPLE } from './common'

// El formulario manda "" cuando el campo se deja en blanco; en la BD eso es un
// null, no una cadena vacía (que además no pasaría las allowlists).
const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

// Base desde donde opera el conductor. Etiqueta corta, no un domicilio.
const ubicacion = z.preprocess(
  vacioANull,
  z.string().trim()
    .max(20, 'Máximo 20 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')
    .nullable()
    .optional()
)

// Número de licencia: código alfanumérico, por eso pasa por la allowlist de
// códigos (mayúsculas, números y guiones).
const licenciaNumero = z.preprocess(
  vacioANull,
  z.string().trim()
    .max(30, 'Máximo 30 caracteres')
    .regex(CODIGO, 'Solo mayúsculas, números y guiones')
    .nullable()
    .optional()
)

// Vigencia: se captura como texto porque no siempre viene como fecha.
const licenciaVigencia = z.preprocess(
  vacioANull,
  z.string().trim()
    .max(30, 'Máximo 30 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')
    .nullable()
    .optional()
)

// Número de expediente de la licencia federal: folio de la dependencia, mismo
// trato que el número de licencia.
const licenciaExpediente = licenciaNumero

export const ConductorCreateSchema = z.object({
  nombre: z.string().trim().min(1, 'Nombre requerido').max(100, 'Máximo 100 caracteres'),
  ubicacion,
  licencia_estatal_numero:   licenciaNumero,
  licencia_estatal_vigencia: licenciaVigencia,
  licencia_federal_numero:     licenciaNumero,
  licencia_federal_expediente: licenciaExpediente,
  licencia_federal_vigencia:   licenciaVigencia,
})

export const ConductorUpdateSchema = z.object({
  nombre: z.string().trim().min(1).max(100, 'Máximo 100 caracteres').optional(),
  ubicacion,
  licencia_estatal_numero:   licenciaNumero,
  licencia_estatal_vigencia: licenciaVigencia,
  licencia_federal_numero:     licenciaNumero,
  licencia_federal_expediente: licenciaExpediente,
  licencia_federal_vigencia:   licenciaVigencia,
})

export type ConductorCreate = z.infer<typeof ConductorCreateSchema>
export type ConductorUpdate = z.infer<typeof ConductorUpdateSchema>
