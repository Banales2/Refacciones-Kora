import { z } from 'zod'
import { TEXTO_SIMPLE, TEXTO_LIBRE, KM_MAX } from './common'
import { RESULTADOS } from '../shared/chequeoItems'

// "HH:MM" o "HH:MM:SS". Misma regla que en incidencias: la hora es opcional
// porque quien captura no siempre la sabe.
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

// El nivel de combustible en octavos: "0/8" a "8/8". Es lo que se puede leer de
// una aguja sin inventarle precisión que no tiene.
const OCTAVOS = /^[0-8]\/8$/

const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

// Un renglón contestado. `clave` se valida contra el catálogo en el servicio,
// no aquí: el esquema no sabe de qué tipo es la unidad.
export const ChequeoItemSchema = z.object({
  clave: z.string().trim().min(1).max(30).regex(/^[a-z_]+$/, 'Clave inválida'),
  resultado: z.enum(RESULTADOS as [string, ...string[]]),
  valor: z.preprocess(
    vacioANull,
    z.string().trim().regex(OCTAVOS, 'Formato N/8').nullable().optional()
  ),
  nota: z.preprocess(
    vacioANull,
    z.string().trim().max(200, 'Máximo 200 caracteres')
      .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
      .nullable().optional()
  ),
  // Solo la admite la pregunta que el catálogo marca con `preguntarSeveridad`
  // (hoy los golpes). El servicio rechaza el resto: dejar que cualquier renglón
  // mande severidad sería dejar que el formulario decida la gravedad de todo.
  severidad: z.enum(['superficial', 'moderada', 'grave']).optional(),
})

export const ChequeoBase = {
  ubicacion: z
    .string().trim()
    .min(1, 'Requerido')
    .max(160, 'Máximo 160 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos'),
  // El chofer que declara. Texto libre con sugerencias, igual que
  // `incidencias.reportado_por`: no hay catálogo de empleados.
  declarado_por: z
    .string().trim()
    .min(1, 'Requerido')
    .max(120, 'Máximo 120 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones'),
  conductor_id: z.coerce.number().int().positive().nullable().optional(),
  hay_novedad: z.boolean(),
  declaracion: z.preprocess(
    vacioANull,
    z.string().trim().max(500, 'Máximo 500 caracteres')
      .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
      .nullable().optional()
  ),
  lectura: z.coerce.number().int()
    .min(0, 'No puede ser negativa')
    .max(KM_MAX, 'Lectura fuera de rango')
    .nullable().optional(),
  // La pone el servidor cuando no viene (fecha de México). Se admite del
  // cliente para poder capturar el chequeo de ayer que se quedó en papel.
  fecha: z.string().date().optional(),
  hora: z.preprocess(
    vacioANull,
    z.string().trim().regex(HORA, 'Formato HH:MM').nullable().optional()
  ),
  nota: z.preprocess(
    vacioANull,
    z.string().trim().max(255, 'Máximo 255 caracteres')
      .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
      .nullable().optional()
  ),
}

// Decir que hay novedad y no escribir cuál es lo mismo que no decir nada. La
// base lo impone también (CK_chequeos_declaracion); aquí se atrapa antes para
// que el mensaje sea del campo y no del motor.
const declaracionCompleta = (d: { hay_novedad: boolean; declaracion?: string | null }) =>
  !d.hay_novedad || !!d.declaracion?.trim()

const MSG_DECLARACION = {
  message: 'Escribe qué pasó',
  path: ['declaracion'],
}

export const ChequeoCreateSchema = z.object({
  ...ChequeoBase,
  items: z.array(ChequeoItemSchema).max(40),
}).refine(declaracionCompleta, MSG_DECLARACION)

// Corregir el chequeo del día. No se borra ni se captura otro (el índice único
// no lo permitiría): se corrige, y la bitácora guarda cómo estaba antes.
//
// Los renglones viajan completos, no por diferencia: mandar solo los que
// cambiaron obligaría a adivinar si una pregunta ausente es "sin cambio" o
// "quítala", y las dos respuestas son defendibles.
export const ChequeoUpdateSchema = z.object({
  ...ChequeoBase,
  declarado_por: ChequeoBase.declarado_por.optional(),
  ubicacion:     ChequeoBase.ubicacion.optional(),
  hay_novedad:   z.boolean().optional(),
  items:         z.array(ChequeoItemSchema).max(40).optional(),
  // La fecha no se corrige: es la mitad de la llave única, y moverla
  // convertiría una corrección en "este chequeo era de otro día", que choca
  // contra el chequeo que ya exista ahí. Se rechaza en vez de ignorarse en
  // silencio: aceptar un campo que no se aplica es peor que no aceptarlo.
  // `.optional()` no sobra: sin él, `z.undefined()` también rechaza que la
  // clave falte, y entonces ninguna corrección pasaría.
  fecha: z.undefined({ message: 'La fecha de un chequeo no se puede cambiar' }).optional(),
}).refine(
  (d) => d.hay_novedad === undefined || declaracionCompleta(d as { hay_novedad: boolean; declaracion?: string | null }),
  MSG_DECLARACION
)

// Leer la declaración y decidir qué hacer con ella.
export const ChequeoRevisarSchema = z.object({
  nota: z.preprocess(
    vacioANull,
    z.string().trim().max(255, 'Máximo 255 caracteres')
      .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
      .nullable().optional()
  ),
  // Cuando se abre, la incidencia sale de la declaración y quien revisa le pone
  // la gravedad: es lo que no se le puede pedir al chofer que reportó un ruido.
  abrir_incidencia: z.boolean().default(false),
  severidad: z.enum(['superficial', 'moderada', 'grave']).optional(),
  categoria: z.preprocess(
    vacioANull,
    z.string().trim().max(30, 'Máximo 30 caracteres')
      .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')
      .nullable().optional()
  ),
}).refine((d) => !d.abrir_incidencia || !!d.severidad, {
  message: 'Elige la gravedad de la incidencia',
  path: ['severidad'],
})

// Rango de la pantalla de flota. Sin fechas, el servicio responde el día de hoy:
// una consulta sin filtro sobre una tabla que crece un renglón por unidad por
// día no le sirve a nadie y crece para siempre.
export const ChequeoQuerySchema = z.object({
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
  vehiculo_id: z.coerce.number().int().positive().optional(),
  // 'por_revisar' = declaraciones con novedad que nadie ha leído.
  filtro: z.enum(['por_revisar']).optional(),
})

export type ChequeoCreate  = z.infer<typeof ChequeoCreateSchema>
export type ChequeoUpdate  = z.infer<typeof ChequeoUpdateSchema>
export type ChequeoRevisar = z.infer<typeof ChequeoRevisarSchema>
export type ChequeoQuery   = z.infer<typeof ChequeoQuerySchema>
export type ChequeoItemIn  = z.infer<typeof ChequeoItemSchema>
