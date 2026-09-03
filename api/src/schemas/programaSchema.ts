import { z } from 'zod'
import { TEXTO_SIMPLE, TEXTO_LIBRE, KM_MAX } from './common'

// El nombre de una operación es una frase del manual, no una etiqueta de
// catálogo: "Soltura o daños en el tapón del tanque de combustible y tubería de
// combustible". Por eso va contra TEXTO_LIBRE, que deja pasar la puntuación,
// y no contra TEXTO_SIMPLE como el nombre de un requerimiento suelto.
export const NombreOperacionSchema = z
  .string()
  .trim()
  .min(1, 'Requerido')
  .max(200, 'Máximo 200 caracteres')
  .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')

export const ProgramaCreateSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(160, 'Máximo 160 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos'),
  descripcion: z
    .string()
    .trim()
    .max(2000, 'Máximo 2000 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
    .nullable()
    .optional(),
  activo: z.boolean().default(true),
})

export const ProgramaUpdateSchema = ProgramaCreateSchema.partial()

// Las columnas del programa, en el orden en que se recorren.
//
// Tres reglas, y las tres salen de cómo se repite el ciclo (migración 012):
//
//  - Las marcas van de menor a mayor. La primera pasada recorre el odómetro
//    hacia adelante; una columna de 30,000 antes que una de 15,000 no describe
//    ningún programa real, describe una captura desordenada.
//  - Las fases únicas son un prefijo. Una fase de una sola vez a media vuelta
//    no tendría cómo repetirse, porque el bucle la volvería a pisar.
//  - Tiene que quedar al menos una fase no única, o el programa se acaba
//    después de la primera pasada y la unidad se queda sin mantenimiento.
export const FasesSchema = z
  .array(z.object({
    km:    z.coerce.number().int().positive().max(KM_MAX, 'Máximo 9,999,999 km'),
    unica: z.boolean().default(false),
    // Lo cotizado por la columna completa. Ausente o nulo = sin cotizar, que no
    // es lo mismo que gratis: la proyección la deja fuera en vez de sumar cero.
    costo: z.coerce.number().min(0, 'No puede ser negativo').max(9_999_999, 'Máximo $9,999,999')
      .nullable().optional(),
  }))
  .min(1, 'El programa necesita al menos una fase')
  .max(60, 'Máximo 60 fases')
  .superRefine((fases, ctx) => {
    for (let i = 1; i < fases.length; i++) {
      if (fases[i].km <= fases[i - 1].km) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'km'],
          message: 'Las marcas de kilometraje tienen que ir de menor a mayor',
        })
      }
    }
    const primeraDelBucle = fases.findIndex((f) => !f.unica)
    if (primeraDelBucle === -1) {
      ctx.addIssue({
        code: 'custom',
        path: [fases.length - 1, 'unica'],
        message: 'Al menos una fase tiene que repetirse, o el programa se acaba tras la primera vuelta',
      })
    } else {
      const unicaTardia = fases.findIndex((f, i) => f.unica && i > primeraDelBucle)
      if (unicaTardia !== -1) {
        ctx.addIssue({
          code: 'custom',
          path: [unicaTardia, 'unica'],
          message: 'Las fases de una sola vez tienen que ser las primeras',
        })
      }
    }
  })

export const OperacionCreateSchema = z.object({
  nombre:      NombreOperacionSchema,
  descripcion: z
    .string()
    .trim()
    .max(2000, 'Máximo 2000 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
    .nullable()
    .optional(),
  categoria: z
    .string()
    .trim()
    .max(30, 'Máximo 30 caracteres')
    .refine((v) => v === '' || TEXTO_SIMPLE.test(v), 'Solo letras, números, espacios y guiones')
    .nullable()
    .optional(),
  tipo_pieza_id: z.coerce.number().int().positive().nullable().optional(),
  // El "o cada N meses" del renglón. Ausente = el renglón solo va por fases.
  limite_meses:  z.coerce.number().int().positive().max(600, 'Máximo 600 meses').nullable().optional(),
})

export const OperacionUpdateSchema = OperacionCreateSchema.partial()

// Un renglón completo de la cuadrícula: qué se le hace en cada fase. Llega
// entero porque así se edita —marcando y desmarcando celdas—, y lo que no viene
// es una celda en blanco, el "-" del manual.
export const CeldasSchema = z.object({
  celdas: z
    .array(z.object({
      fase_id: z.coerce.number().int().positive(),
      accion:  z.string().trim().min(1).max(2),
    }))
    .max(60, 'Máximo 60 celdas'),
})

export const ReordenarSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).max(500, 'Máximo 500 operaciones'),
})
