import { z } from 'zod'
import { lecturaKm } from './common'
import { ValeGasolinaCreateSchema } from './valeGasolinaSchema'
import { litros, costo, fecha, producto } from './recargaSchema'

// Registrar, desde el renglón de una factura de gasolina, la recarga que el
// chofer no reportó —y el vale, si el encargado tampoco lo registró—. Llega el
// ticket con el vale en la mano y la factura ya está cobrando esa carga. Ver la
// migración 069.
//
// El vale es uno de dos: el que ya estaba registrado (`vale_id`) o el que
// tampoco estaba (`vale_nuevo`). Su chofer y su unidad son los de la recarga.

export const RegistrarDesdeFacturaSchema = z.object({
  vale_id: z.coerce.number().int().positive().optional(),
  vale_nuevo: ValeGasolinaCreateSchema
    .pick({ folio: true, sucursal_id: true, fecha: true, creado_por: true })
    .optional(),
  vehiculo_id:  z.coerce.number().int().min(1, 'Vehículo requerido'),
  conductor_id: z.coerce.number().int().min(1, 'Chofer requerido'),
  fecha,
  litros,
  costo,
  // Opcional: el ticket no siempre trae el odómetro. Sin él la recarga no
  // avanza el kilometraje ni cuenta para el rendimiento.
  kilometraje: lecturaKm().nullable().optional(),
  producto: producto.optional(),
}).refine(
  (d) => (d.vale_id === undefined) !== (d.vale_nuevo === undefined),
  { message: 'Elige el vale registrado o captura el que faltaba, no los dos', path: ['vale_id'] },
)

export type RegistrarDesdeFactura = z.infer<typeof RegistrarDesdeFacturaSchema>

export const SinReportarQuerySchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
