import { z } from 'zod'
import { TEXTO_LIBRE, TEXTO_SIMPLE } from './common'

// Fecha local (no UTC) para no rechazar "hoy" en zonas horarias detrás de UTC.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const observaciones = z
  .string()
  .trim()
  .max(300, 'Máximo 300 caracteres')
  .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
  .nullish()

export const TraspasoCreateSchema = z.object({
  lote_id:             z.coerce.number().int().min(1, 'Lote requerido'),
  origen_sucursal_id:  z.coerce.number().int().min(1, 'Sucursal de origen requerida'),
  destino_sucursal_id: z.coerce.number().int().min(1, 'Sucursal de destino requerida'),
  cantidad:            z.coerce.number().int().min(1, 'Mínimo 1 unidad'),
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
    .refine((v) => v <= todayIso(), 'No puede ser una fecha futura'),
  // Quien dio el visto bueno para mover la mercancía. Obligatorio: un traspaso
  // sin autorizador es justo el que nadie reconoce después. Quien lo capturó no
  // viene aquí —sale de la cuenta de la sesión—.
  autorizado_por: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(120, 'Máximo 120 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones'),
  observaciones,
})
  // Se valida aquí y no solo en la base para poder dar el mensaje en español;
  // el CHECK de la tabla queda como red por si algo entra por otro camino.
  .refine((d) => d.origen_sucursal_id !== d.destino_sucursal_id, {
    message: 'El origen y el destino no pueden ser la misma sucursal',
    path: ['destino_sucursal_id'],
  })

// Los límites de una refacción en una sucursal: el mínimo que siempre debe
// haber y el máximo que no conviene rebasar. Los dos son opcionales por
// separado —se puede vigilar solo el piso, solo el techo o los dos— pero uno
// tiene que venir: una regla sin ningún límite no vigila nada.
//
// Las mismas reglas están como CHECK en la tabla (migración 050); aquí se
// repiten para contestar en español en vez de con un error del motor.
const limite = z.coerce
  .number()
  .int()
  .min(1, 'Mínimo 1 unidad')
  .max(999, 'Máximo 999')
  .nullish()

const enOrden = (d: { minimo?: number | null; maximo?: number | null }) =>
  d.minimo == null || d.maximo == null || d.maximo >= d.minimo

const MSG_ORDEN = { message: 'El máximo no puede ser menor que el mínimo', path: ['maximo'] }

export const MinimoCreateSchema = z.object({
  sucursal_id: z.coerce.number().int().min(1, 'Sucursal requerida'),
  pieza_id:    z.coerce.number().int().min(1, 'Refacción requerida'),
  minimo:      limite,
  maximo:      limite,
  observaciones,
})
  .refine((d) => d.minimo != null || d.maximo != null, {
    message: 'Define al menos un mínimo o un máximo',
    path: ['minimo'],
  })
  .refine(enOrden, MSG_ORDEN)

// En la edición, `null` limpia el límite y omitirlo lo deja como está. Que
// quede al menos uno no se puede saber aquí —depende de lo que ya tenga la
// fila— y lo revisa el servicio; el orden sí, cuando vienen los dos.
export const MinimoUpdateSchema = z.object({
  minimo:       limite,
  maximo:       limite,
  observaciones,
})
  .refine(enOrden, MSG_ORDEN)

export type TraspasoCreate = z.infer<typeof TraspasoCreateSchema>
export type MinimoCreate   = z.infer<typeof MinimoCreateSchema>
export type MinimoUpdate   = z.infer<typeof MinimoUpdateSchema>
