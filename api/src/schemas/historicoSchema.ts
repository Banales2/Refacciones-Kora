import { z } from 'zod'
import {
  cantidadInicial, compradoPor, costoUnitario, fechaCompra, numFactura, tasaIva,
} from './loteSchema'
import { RefaccionCreateSchema } from './refaccionSchema'

// La carga de facturas anteriores al sistema. Ver
// `db/migrations/028_facturas_historicas.sql` y `docs/importacion-historica.md`.
//
// Se parece a una compra (`compraSchema`) pero no lo es, y las dos diferencias
// son lo que justifica un schema aparte:
//
//   1. El renglón NO elige entre `pieza_id` y `pieza_nueva`. Viene siempre con
//      número de serie, y la API decide: si esa serie ya está en el catálogo se
//      usa, y si no, se da de alta. Un archivo de 200 renglones capturados hace
//      dos años no puede exigirle a nadie que marque cuáles ya existen.
//   2. No lleva identificadores. Estas piezas ya se gastaron: no hay folio
//      físico que leer porque no hay pieza que ir a ver.
export const RenglonHistoricoSchema = z.object({
  numero_serie:  RefaccionCreateSchema.shape.numero_serie,
  // Con la que se da de alta la refacción si no existía. Si ya existe se
  // ignora: el catálogo de hoy sabe más que un archivo viejo, y pisarle la
  // descripción a una refacción en uso es corregir lo que nadie pidió corregir.
  descripcion:   RefaccionCreateSchema.shape.descripcion,
  // Opcional, y esa es la diferencia con el alta normal de una refacción: solo
  // hace falta para las series que NO están en el catálogo. Exigirlo siempre
  // obligaría a inventarle un tipo a refacciones que ya lo tienen, y ese número
  // de más es el que acaba pisando el bueno el día que alguien lo use.
  tipo_pieza_id: RefaccionCreateSchema.shape.tipo_pieza_id.optional(),
  cantidad_inicial: cantidadInicial,
  costo_unitario:   costoUnitario,
})

export const FacturaHistoricaSchema = z.object({
  num_factura:  numFactura,
  fecha_compra: fechaCompra,
  // Más holgado que el tope de 50 de una captura a mano: ese existe porque una
  // factura de más de 50 partidas tecleada de golpe es más probable que sea un
  // error que una compra real. Aquí no se teclea nada — se lee un archivo que
  // el proveedor emitió — y las facturas grandes de verdad existen.
  renglones:    z.array(RenglonHistoricoSchema).min(1, 'Factura sin renglones').max(300),
})

export const ImportacionHistoricaSchema = z
  .object({
    proveedor_id: z.coerce.number().int().min(1, 'Proveedor requerido'),
    // Las piezas ya no están en ningún estante, pero el lote sí necesita
    // sucursal: es a esa a la que entraron cuando llegaron, y es donde su
    // existencia —de cero— se anota. Sin ella el lote sería stock que no
    // aparece en ningún inventario, ni siquiera para decir que no queda nada.
    sucursal_id:  z.coerce.number().int().min(1, 'Sucursal requerida'),
    // El IVA es de la importación completa, no del renglón ni de la factura:
    // un archivo se exporta con una sola convención de precios. Ausente = los
    // precios del archivo ya lo incluyen, igual que en una compra.
    tasa_iva:     tasaIva,
    comprado_por: compradoPor,
    facturas:     z.array(FacturaHistoricaSchema).min(1, 'El archivo no trae ninguna factura').max(300),
  })
  .refine(
    (d) => d.facturas.reduce((n, f) => n + f.renglones.length, 0) <= 2000,
    { message: 'El archivo trae más de 2,000 renglones. Pártelo en dos.' },
  )

export type RenglonHistorico    = z.infer<typeof RenglonHistoricoSchema>
export type FacturaHistorica    = z.infer<typeof FacturaHistoricaSchema>
export type ImportacionHistorica = z.infer<typeof ImportacionHistoricaSchema>
