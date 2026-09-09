import { z } from 'zod'
import { EtiquetaPiezaSchema } from './tipoPiezaSchema'

// Dónde quedó puesta una de las piezas del consumo.
//
// Capturar el consumo y montar la pieza eran dos pasos: primero se declaraba el
// gasto y después había que ir a la unidad a decir en qué renglón quedó. Todo lo
// que hace falta para el segundo paso ya lo sabe el primero —el lote, la
// sucursal, la fecha y el km salen del mantenimiento— salvo esto: la posición.
//
// Un consumo puede montarse en varios renglones (cuatro balatas en cuatro
// posiciones), de ahí que sea una lista. Puede ir vacía: no todo lo que se gasta
// se monta —aceite, limpiadores— y ahí el consumo es todo lo que hay que
// registrar.
export const MontajeConsumoSchema = z.object({
  /** Qué renglón de ese tipo ('' = el tipo va una sola vez en la unidad). */
  etiqueta: EtiquetaPiezaSchema,
  // De la pieza que SALE, cuando el renglón ya traía una. Es el dato que se
  // perdía por completo al montar después: sin él no hay forma de reclamar una
  // garantía ni de ver que un proveedor falla seguido.
  motivo_retiro: z.enum(['desgaste', 'falla', 'robo', 'siniestro', 'preventivo', 'garantia']).nullish(),
  destino: z.enum(['desecho', 'reacondicionar', 'devolucion_proveedor', 'venta', 'stock']).nullish(),
})

export const DetalleMttoPiezaCreateSchema = z.object({
  lote_id:        z.coerce.number().int().min(1, 'Lote requerido'),
  // De qué sucursal sale la pieza. El mismo lote puede estar repartido entre
  // varias, así que el lote solo no basta para saber de dónde descontar.
  sucursal_id:    z.coerce.number().int().min(1, 'Sucursal requerida'),
  cantidad:       z.coerce.number().int().min(1, 'Mínimo 1 unidad'),
  costo_unitario: z.coerce.number().positive().optional(),
  // Dónde se montó cada pieza de este consumo. Nunca más de `cantidad`
  // renglones: el service lo verifica contra la cantidad capturada.
  montajes: z.array(MontajeConsumoSchema).max(20).optional(),
})

export const DetalleMttoPiezaUpdateSchema = z.object({
  cantidad:       z.coerce.number().int().min(1).optional(),
  costo_unitario: z.coerce.number().positive().optional(),
})

export type DetalleMttoPiezaCreate = z.infer<typeof DetalleMttoPiezaCreateSchema>
export type DetalleMttoPiezaUpdate = z.infer<typeof DetalleMttoPiezaUpdateSchema>
