import { z } from 'zod'
import {
  cantidadInicial, compradoPor, costoUnitario, fechaCompra, numFactura,
} from './loteSchema'
import { RefaccionCreateSchema } from './refaccionSchema'

// Una compra es una factura con varios renglones. NO existe como tabla: lo que
// se guarda son N lotes que comparten proveedor, sucursal, fecha y
// `num_factura`. La factura es lo que los vuelve a juntar cuando hay que
// cuadrar el gasto contra el papel.
//
// Cada renglón entra de una de dos formas, nunca las dos:
//   pieza_id     -> la refacción ya está en el catálogo.
//   pieza_nueva  -> se da de alta aquí mismo, junto con su primera compra. Es
//                   el caso de la refacción que nadie había comprado nunca, y
//                   pedirla en un alta aparte obligaba a salir de la captura.
export const CompraRenglonSchema = z
  .object({
    pieza_id: z.coerce.number().int().positive().optional(),
    pieza_nueva: RefaccionCreateSchema.optional(),
    cantidad_inicial: cantidadInicial,
    costo_unitario: costoUnitario,
  })
  .refine(
    (r) => (r.pieza_id === undefined) !== (r.pieza_nueva === undefined),
    { message: 'Cada renglón lleva una refacción del catálogo o una nueva, no ambas' },
  )

export const CompraCreateSchema = z.object({
  proveedor_id: z.coerce.number().int().min(1, 'Proveedor requerido'),
  // La sucursal que recibe la compra completa. Igual que en el lote suelto: un
  // renglón sin sucursal sería stock que no aparece en ningún inventario.
  // Repartirlo después es un traspaso, no parte de la compra.
  sucursal_id: z.coerce.number().int().min(1, 'Sucursal requerida'),
  fecha_compra: fechaCompra,
  num_factura: numFactura,
  comprado_por: compradoPor,
  // El tope no es arbitrario: cada renglón es un INSERT dentro de la misma
  // transacción, y una factura de más de 50 partidas capturada a mano es más
  // probable que sea un error que una compra real.
  renglones: z
    .array(CompraRenglonSchema)
    .min(1, 'Agrega al menos una refacción')
    .max(50, 'Máximo 50 refacciones por factura'),
})

export type CompraRenglon = z.infer<typeof CompraRenglonSchema>
export type CompraCreate = z.infer<typeof CompraCreateSchema>
