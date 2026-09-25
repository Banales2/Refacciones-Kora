import { z } from 'zod'

const TipoPiezaBase = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Nombre requerido')
    .max(40, 'Máximo 40 caracteres')
    .regex(
      /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]+$/,
      'Solo letras, números, espacios y guiones',
    ),
  /**
   * Si las piezas de este tipo se identifican una por una (una llanta con su
   * propia historia) o se cuentan a granel (aceite, tornillos).
   *
   * Ausente = false: todo lo que existe hoy se cuenta a granel, y encenderlo es
   * una decisión que se toma tipo por tipo. Ver
   * `db/migrations/025_tipo_pieza_rastreo_individual.sql`.
   */
  rastreo_individual: z.boolean().optional().default(false),
  /**
   * Si las piezas de este tipo se miden con profundímetro en el chequeo diario
   * —llantas, balatas— y a partir de cuántos milímetros la lectura cuenta
   * como falla.
   *
   * El mínimo es opcional aunque la medición esté encendida: se puede querer
   * el dato sin que abra pendientes todavía, que es como conviene empezar
   * mientras se junta historia. Ver la migración 052.
   */
  mide_desgaste: z.boolean().optional().default(false),
  desgaste_minimo_mm: z.coerce
    .number()
    .positive('El mínimo debe ser mayor a 0')
    .max(100, 'El mínimo no puede pasar de 100 mm')
    .nullish(),
})

// Un mínimo sin medición es un número que nadie va a comparar contra nada.
export const TipoPiezaCreateSchema = TipoPiezaBase.refine(
  (d) => !d.desgaste_minimo_mm || d.mide_desgaste,
  { message: 'Para fijar un mínimo hay que activar la medición de desgaste',
    path: ['desgaste_minimo_mm'] },
)

// Sale del objeto base y no del de alta: en una edición los dos campos del
// desgaste pueden venir por separado, y que no se contradigan lo resuelve el
// servicio con lo que ya tiene la fila —apagar la medición borra el mínimo—.
export const TipoPiezaUpdateSchema = TipoPiezaBase.partial()

// Posición que ocupa una pieza dentro de la unidad ("delantero", "trasero",
// "izquierdo"): lo que distingue dos renglones del mismo tipo. Cadena vacía —el
// caso normal, un tipo que va una sola vez— es válida y es el valor que se
// guarda; por eso no se usa NULL en la columna ni aquí.
export const EtiquetaPiezaSchema = z
  .string()
  .trim()
  .max(40, 'Máximo 40 caracteres')
  .refine(
    (v) => v === '' || /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]+$/.test(v),
    'Solo letras, números, espacios y guiones',
  )
  .default('')

export type TipoPiezaCreate = z.infer<typeof TipoPiezaCreateSchema>
export type TipoPiezaUpdate = z.infer<typeof TipoPiezaUpdateSchema>
