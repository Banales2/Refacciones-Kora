import { z } from 'zod'
import { compradoPor, fechaLlegada } from './loteSchema'
import { RefaccionCreateSchema } from './refaccionSchema'
import { rfc } from './gasolineraSchema'

// Una factura de refacciones leída de su XML (CFDI 4.0), con lo que el XML no
// dice: la sucursal que recibe, quién compró y qué es cada concepto para
// nosotros. El navegador lee el XML (`src/src/lib/xmlRefacciones.ts`); la API
// vuelve a comprobar las sumas. Ver la migración 070.

const importe = z.coerce.number().min(0).max(99999999)

/**
 * Qué es el concepto para nosotros. La primera vez lo dice una persona; las
 * siguientes llega de lo aprendido (`proveedor_conceptos`).
 */
const Asignacion = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('refaccion'),
    pieza_id: z.coerce.number().int().positive().optional(),
    pieza_nueva: RefaccionCreateSchema.optional(),
    /**
     * Cuántas unidades del XML trae cada pieza: 10 L de aceite en botes de 1 L
     * son 10 piezas. 1 = la unidad del XML es la pieza.
     */
    contenido: z.coerce.number().positive('El contenido debe ser mayor a 0').max(99999).default(1),
  }).refine(
    (a) => (a.pieza_id === undefined) !== (a.pieza_nueva === undefined),
    { message: 'Elige la refacción del catálogo o da de alta una nueva, no ambas' },
  ),
  z.object({ tipo: z.literal('mano_obra') }),
  z.object({ tipo: z.literal('cargo') }),
])

export const ConceptoCfdiSchema = z.object({
  /** El número de parte del proveedor. Con él se aprende qué es. */
  no_identificacion: z.string().trim().max(100).nullable(),
  clave_prod_serv: z.string().trim().max(10),
  descripcion: z.string().trim().min(1).max(1000),
  clave_unidad: z.string().trim().max(10),
  cantidad: z.coerce.number().positive().max(999999),
  valor_unitario: z.coerce.number().min(0).max(99999999),
  importe,
  descuento: importe,
  iva: importe,
  asignacion: Asignacion,
})

export const FacturaCfdiImportSchema = z.object({
  uuid: z.string().trim().toUpperCase()
    .regex(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/, 'UUID inválido'),
  serie: z.string().trim().max(25).nullable(),
  folio: z.string().trim().min(1).max(40),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  emisor_rfc: rfc,
  emisor_nombre: z.string().trim().max(300),
  receptor_rfc: rfc,
  /** La tasa de IVA del documento, en por ciento. null = sin IVA. */
  tasa_iva: z.coerce.number().positive().max(100).nullable(),
  subtotal: importe,
  descuento: importe,
  iva: importe,
  total: importe,

  /** Si el RFC no es de nadie: el proveedor del catálogo que lo emite… */
  proveedor_id: z.coerce.number().int().positive().optional(),
  /** …o darlo de alta con el nombre del XML. */
  proveedor_nuevo: z.boolean().optional(),

  sucursal_id: z.coerce.number().int().min(1, 'Sucursal requerida'),
  comprado_por: compradoPor,
  fecha_llegada: fechaLlegada,

  conceptos: z.array(ConceptoCfdiSchema).min(1, 'La factura no trae conceptos').max(50),
})

export type ConceptoCfdi = z.infer<typeof ConceptoCfdiSchema>
export type FacturaCfdiImport = z.infer<typeof FacturaCfdiImportSchema>
