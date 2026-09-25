import { z } from 'zod'
import { TEXTO_SIMPLE, TEXTO_LIBRE, KM_MAX } from './common'
import { RESULTADOS } from '../shared/chequeoItems'
import { EtiquetaPiezaSchema } from './tipoPiezaSchema'

// "HH:MM" o "HH:MM:SS". Misma regla que en incidencias: la hora es opcional
// porque quien captura no siempre la sabe.
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

// El nivel de combustible en cuartos: "1/4" a "4/4". Son los cuatro que marca
// la aguja de verdad; pedir más finura es pedir que alguien la invente.
//
// También se admiten los octavos que se capturaron antes ("0/8" a "8/8"): la
// captura ya no los ofrece, pero un chequeo viejo que se corrige vuelve a pasar
// por aquí con el valor que traiga, y rechazarlo sería impedir que se corrija
// otra cosa del mismo chequeo. Mismo criterio que una pregunta `retirado`.
const NIVEL_TANQUE = /^([1-4]\/4|[0-8]\/8)$/

const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

// Un renglón contestado. `clave` se valida contra el catálogo en el servicio,
// no aquí: el esquema no sabe de qué tipo es la unidad.
export const ChequeoItemSchema = z.object({
  clave: z.string().trim().min(1).max(30).regex(/^[a-z_]+$/, 'Clave inválida'),
  resultado: z.enum(RESULTADOS as [string, ...string[]]),
  valor: z.preprocess(
    vacioANull,
    z.string().trim().regex(NIVEL_TANQUE, 'Nivel de tanque inválido').nullable().optional()
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

/**
 * Una lectura de profundímetro: qué posición y cuántos milímetros.
 *
 * No viaja la unidad: quién estaba puesto ahí lo resuelve el servidor desde la
 * bitácora. Si lo mandara el teléfono, una PWA con el formulario abierto desde
 * antes de un cambio de llanta atribuiría la medición a la pieza que ya se
 * quitó —y esa es justo la liga que este módulo existe para cuidar—.
 *
 * Solo viene lo que se midió. Una posición ausente es "no se midió", que es el
 * caso normal: nadie mide veintidós ruedas con profundímetro todos los días.
 */
export const DesgasteSchema = z.object({
  tipo_pieza_id: z.coerce.number().int().positive(),
  etiqueta: EtiquetaPiezaSchema,
  milimetros: z.coerce
    .number()
    .positive('Debe ser mayor a 0')
    .max(100, 'Máximo 100 mm')
    // Un decimal: el profundímetro del patio no da más, y aceptar tres
    // invitaría a capturar una precisión que nadie leyó.
    .refine((v) => Number.isInteger(v * 10), 'Un decimal como máximo'),
})

export const ChequeoBase = {
  ubicacion: z
    .string().trim()
    .min(1, 'Requerido')
    .max(160, 'Máximo 160 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos'),
  // El chofer de la unidad. Texto libre con sugerencias, igual que
  // `incidencias.reportado_por`: no hay catálogo de empleados. Nulo solo cuando
  // no había chofer (`sin_chofer`); lo exige el refine de abajo.
  declarado_por: z.preprocess(
    vacioANull,
    z.string().trim()
      .max(120, 'Máximo 120 caracteres')
      .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')
      .nullable().optional()
  ),
  conductor_id: z.coerce.number().int().positive().nullable().optional(),
  hay_novedad: z.boolean(),
  // No había chofer a quien preguntarle. No es lo mismo que `hay_novedad:
  // false`, que es "se le preguntó y no reportó nada". Ver la migración 039.
  sin_chofer: z.boolean().default(false),
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
  // Acuse de que quien captura vio que la lectura BAJA el odómetro de la unidad
  // y aun así la sostiene. No se guarda en ningún lado: solo abre la puerta en
  // el servicio. Ausente = no confirmado, que es lo correcto para un cliente
  // viejo o para quien pega directo al endpoint —el caso que hay que frenar es
  // el dígito mal tecleado, y ese llega sin bandera—.
  confirmar_baja: z.boolean().default(false),
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

// Las tres reglas de la declaración, que la base también impone
// (CK_chequeos_declaracion_v2). Se repiten aquí para que el mensaje señale el
// campo en vez de devolver un error del motor.
interface Declaracion {
  hay_novedad?: boolean
  sin_chofer?:  boolean
  declarado_por?: string | null
  declaracion?: string | null
}

const REGLAS: { check: (d: Declaracion) => boolean; message: string; path: string[] }[] = [
  {
    // Decir que hay novedad y no escribir cuál es lo mismo que no decir nada.
    check: (d) => !d.hay_novedad || !!d.declaracion?.trim(),
    message: 'Escribe qué reportó el chofer',
    path: ['declaracion'],
  },
  {
    // No puede declarar quien no estaba.
    //
    // Deliberadamente NO se revisa aquí `declarado_por`, aunque la base sí lo
    // exija nulo (CK_chequeos_declaracion_v2): un nombre que quedó escrito
    // antes de marcar "no había chofer" es basura del formulario, no un error
    // de quien captura, y el servicio lo descarta. Rechazar el alta por eso
    // sería regañar por algo que ya se arregló solo.
    check: (d) => !d.sin_chofer || (!d.hay_novedad && !d.declaracion?.trim()),
    message: 'Si no había chofer, no puede haber reporte suyo',
    path: ['sin_chofer'],
  },
  {
    // Y con chofer, el nombre es obligatorio: un reporte sin firma no se le
    // puede preguntar a nadie después.
    check: (d) => !!d.sin_chofer || !!d.declarado_por?.trim(),
    message: 'Falta el nombre del chofer',
    path: ['declarado_por'],
  },
]

function aplicarReglas<T extends z.ZodTypeAny>(schema: T): T {
  return REGLAS.reduce(
    (s, r) => s.refine(r.check, { message: r.message, path: r.path }),
    schema as z.ZodTypeAny
  ) as unknown as T
}

export const ChequeoCreateSchema = aplicarReglas(z.object({
  ...ChequeoBase,
  items: z.array(ChequeoItemSchema).max(40),
  // Tope alto a propósito: un tractocamion con remolque pasa de veinte ruedas.
  desgaste: z.array(DesgasteSchema).max(40).optional(),
}))

// Corregir el chequeo del día. No se borra ni se captura otro (el índice único
// no lo permitiría): se corrige, y la bitácora guarda cómo estaba antes.
//
// Los renglones viajan completos, no por diferencia: mandar solo los que
// cambiaron obligaría a adivinar si una pregunta ausente es "sin cambio" o
// "quítala", y las dos respuestas son defendibles.
// Las reglas NO se aplican aquí, a diferencia del alta: en una corrección
// parcial el payload no es juzgable por sí solo —mandar solo los renglones
// dejaría `declarado_por` ausente y parecería que falta el nombre—. Lo que hay
// que juzgar es el estado ya mezclado con lo guardado, y eso solo lo sabe el
// servicio, que llama a `revisarDeclaracion` con el resultado.
export const ChequeoUpdateSchema = z.object({
  ...ChequeoBase,
  declarado_por: ChequeoBase.declarado_por.optional(),
  ubicacion:     ChequeoBase.ubicacion.optional(),
  hay_novedad:   z.boolean().optional(),
  // Sin `.default(false)`: aquí "ausente" significa "no lo toques", y un
  // default lo convertiría en "había chofer" en cada corrección parcial.
  sin_chofer:    z.boolean().optional(),
  items:         z.array(ChequeoItemSchema).max(40).optional(),
  // Ausente = no se tocan las lecturas guardadas; un arreglo vacío sí las
  // borra, que es como se deshace una medición capturada por error.
  desgaste:      z.array(DesgasteSchema).max(40).optional(),
  // La fecha no se corrige: es la mitad de la llave única, y moverla
  // convertiría una corrección en "este chequeo era de otro día", que choca
  // contra el chequeo que ya exista ahí. Se rechaza en vez de ignorarse en
  // silencio: aceptar un campo que no se aplica es peor que no aceptarlo.
  // `.optional()` no sobra: sin él, `z.undefined()` también rechaza que la
  // clave falte, y entonces ninguna corrección pasaría.
  fecha: z.undefined({ message: 'La fecha de un chequeo no se puede cambiar' }).optional(),
})

/**
 * Las mismas tres reglas, aplicables a un estado ya armado. La usa el servicio
 * al corregir, donde lo único juzgable es la mezcla de lo guardado con lo que
 * viene en el payload. Devuelve el primer problema, o null si todo cuadra.
 */
export function revisarDeclaracion(d: Declaracion): string | null {
  return REGLAS.find((r) => !r.check(d))?.message ?? null
}

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
export type DesgasteIn = z.infer<typeof DesgasteSchema>
export type ChequeoItemIn  = z.infer<typeof ChequeoItemSchema>
