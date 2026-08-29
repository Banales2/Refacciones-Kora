import { z } from 'zod'
import { TEXTO_SIMPLE, TEXTO_LIBRE, CODIGO, KM_MAX } from './common'

// Una garantía se mide en meses, en kilómetros o en los dos, y con los dos gana
// lo que ocurra primero ("3 años o 100,000 km"). El modo tiene que traer el
// dato con el que se mide: una garantía "por km" sin límite de km no vence
// nunca, que no es una garantía. Lo valida también la base (migración 010),
// pero aquí el mensaje se puede leer.
function exigeLimites<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((v: {
    trigger_mode?: 'km' | 'meses' | 'ambos'
    duracion_meses?: number | null
    limite_km?: number | null
  }, ctx: z.RefinementCtx) => {
    if (!v.trigger_mode) return
    const porTiempo = v.trigger_mode === 'meses' || v.trigger_mode === 'ambos'
    const porKm     = v.trigger_mode === 'km'    || v.trigger_mode === 'ambos'
    if (porTiempo && v.duracion_meses == null) {
      ctx.addIssue({
        code: 'custom', path: ['duracion_meses'],
        message: 'Indica de cuántos meses es la garantía',
      })
    }
    if (porKm && v.limite_km == null) {
      ctx.addIssue({
        code: 'custom', path: ['limite_km'],
        message: 'Indica hasta cuántos kilómetros cubre',
      })
    }
  })
}

const nombre = z
  .string().trim()
  .min(1, 'Requerido')
  .max(120, 'Máximo 120 caracteres')
  .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')

const descripcion = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim()
    .max(500, 'Máximo 500 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
    .nullable().optional()
)

// 600 meses son 50 años: de sobra para cualquier garantía y suficiente para
// atajar el dedazo de teclear días donde van meses.
const duracionMeses = z.coerce.number().int().positive('Debe ser mayor a 0')
  .max(600, 'No puede ser mayor a 600 meses').nullable().optional()

const limiteKm = z.coerce.number().int().positive('Debe ser mayor a 0')
  .max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional()

const triggerMode = z.enum(['km', 'meses', 'ambos'])

// ─── Catálogo del modelo ────────────────────────────────────────────────────

export const GarantiaModeloCreateSchema = exigeLimites(z.object({
  nombre,
  descripcion,
  trigger_mode:   triggerMode,
  duracion_meses: duracionMeses,
  limite_km:      limiteKm,
  activo:         z.boolean().optional(),
}))

// En la edición el modo puede no venir, y entonces no hay contra qué exigir los
// límites: la base sigue cuidando la coherencia de la fila resultante.
export const GarantiaModeloUpdateSchema = exigeLimites(z.object({
  nombre:         nombre.optional(),
  descripcion,
  trigger_mode:   triggerMode.optional(),
  duracion_meses: duracionMeses,
  limite_km:      limiteKm,
  activo:         z.boolean().optional(),
}))

// ─── Garantía de una unidad ─────────────────────────────────────────────────

const folio = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().toUpperCase()
    .max(60, 'Máximo 60 caracteres')
    .regex(CODIGO, 'Solo mayúsculas, números y guiones')
    .nullable().optional()
)

const observaciones = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim()
    .max(255, 'Máximo 255 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
    .nullable().optional()
)

// Sin tope superior: una garantía puede arrancar en el futuro (unidad comprada
// pero todavía no entregada), y ponerle "no futura" impediría capturarla.
const fecha = z.string().date('Formato inválido (YYYY-MM-DD)').nullable().optional()

const kmInicio = z.coerce.number().int()
  .min(0, 'No puede ser negativo')
  .max(KM_MAX, 'Máximo 9,999,999 km')
  .nullable().optional()

export const GarantiaVehiculoCreateSchema = exigeLimites(z.object({
  nombre,
  descripcion,
  trigger_mode:   triggerMode,
  duracion_meses: duracionMeses,
  limite_km:      limiteKm,
  // Si no viene, el servicio la arranca en la fecha de compra de la unidad.
  fecha_inicio:   fecha,
  km_inicio:      kmInicio,
  folio,
  observaciones,
}))

export const GarantiaVehiculoUpdateSchema = exigeLimites(z.object({
  nombre:         nombre.optional(),
  descripcion,
  trigger_mode:   triggerMode.optional(),
  duracion_meses: duracionMeses,
  limite_km:      limiteKm,
  fecha_inicio:   fecha,
  km_inicio:      kmInicio,
  folio,
  observaciones,
  // Cancelarla es decir "esta unidad ya la perdió", con desde cuándo y por qué.
  // Se limpia mandando null en los dos.
  cancelada_en:       fecha,
  motivo_cancelacion: observaciones,
}))

/** Ids de garantías a las que se ata un requerimiento (o un renglón de plantilla). */
export const GarantiaIdsSchema = z.array(z.coerce.number().int().positive()).max(20).optional()
