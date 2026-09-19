import { z } from 'zod'
import {
  cantidadInicial, compradoPor, costoUnitario, descuentoPct, fechaCompra,
  numFactura, tasaIva,
} from './loteSchema'
import { RefaccionCreateSchema } from './refaccionSchema'

// Lo que dice el papel de una factura de refacciones.
//
// Ver `db/migrations/044_renglones_de_la_factura.sql`.

// Cada renglón trae una refacción del catálogo o una nueva, nunca las dos — el
// mismo trato que en el alta de compra. Dar de alta aquí es necesario: el papel
// puede traer una pieza que nadie ha comprado nunca, y obligar a salir a otra
// pantalla para registrarla rompe la revisión a la mitad.
export const RenglonPapelSchema = z
  .object({
    pieza_id: z.coerce.number().int().positive().optional(),
    pieza_nueva: RefaccionCreateSchema.optional(),
    cantidad: cantidadInicial,
    costo_unitario: costoUnitario,
    /**
     * A qué lote corresponde. Se manda cuando una persona lo decidió a mano; si
     * viene ausente, el servidor lo empareja y guarda lo que decidió.
     */
    lote_id: z.coerce.number().int().positive().nullish(),
  })
  .refine(
    (r) => (r.pieza_id === undefined) !== (r.pieza_nueva === undefined),
    { message: 'Cada renglón lleva una refacción del catálogo o una nueva, no ambas' },
  )

export const RenglonesPapelSchema = z.object({
  /**
   * El papel COMPLETO, no lo que se agrega. La pantalla manda la transcripción
   * entera y el servidor reemplaza: mandar altas y bajas por separado solo
   * agrega una forma de que las dos versiones discrepen.
   */
  renglones: z.array(RenglonPapelSchema).max(200, 'Máximo 200 renglones por factura'),
})

export const CuadrarSchema = z.object({
  nota: z.string().trim().max(255, 'Máximo 255 caracteres').optional(),
  /**
   * Cerrar aunque queden refacciones del papel sin capturar, o capturadas que el
   * papel no trae. Es legítimo —el papel puede tardar en aclararse— pero no
   * puede pasar por descuido, así que la API responde 409 la primera vez.
   */
  confirmar_sin_resolver: z.boolean().optional().default(false),
})

// Registrar la compra que al papel le falta. Lo único que el renglón no sabe es
// dónde entró la mercancía: la cantidad y el costo los dice el papel.
export const RegistrarRenglonSchema = z.object({
  sucursal_id: z.coerce.number().int().min(1, 'Sucursal requerida'),
})

/**
 * La factura que nadie capturó, encontrada al revisar el fajo de papeles.
 *
 * Solo la cabecera: nace sin renglones, y los lotes se registran uno por uno
 * desde el cuadre. Ver `db/migrations/045_factura_hallada_en_revision.sql`.
 */
export const FacturaHalladaSchema = z.object({
  proveedor_id: z.coerce.number().int().min(1, 'Proveedor requerido'),
  num_factura: numFactura,
  fecha_compra: fechaCompra,
  tasa_iva: tasaIva,
  descuento_pct: descuentoPct,
  /** Quién hizo la compra, según el papel. */
  comprado_por: compradoPor,
})

export type FacturaHallada = z.infer<typeof FacturaHalladaSchema>
export type RenglonesPapel = z.infer<typeof RenglonesPapelSchema>
export type Cuadrar = z.infer<typeof CuadrarSchema>
export type RegistrarRenglon = z.infer<typeof RegistrarRenglonSchema>
