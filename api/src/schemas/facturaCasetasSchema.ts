import { z } from 'zod'

// La factura de casetas de PASE, importada de su XML.
//
// La pantalla lee el XML y manda los cruces ya separados; aquí se valida la
// forma de cada uno, y el service comprueba que, juntos, den el total impreso.
// Lo que llega no se teclea: si algo no cuadra es que el archivo no es el que se
// cree, y se rechaza entero en vez de guardar media factura.
//
// Ver `db/migrations/064_facturas_de_casetas.sql`.

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
const fechaHora = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, 'Formato inválido (YYYY-MM-DDTHH:mm:ss)')

const dinero = z.coerce.number().min(-99999999).max(99999999)

/** Como lo imprime PASE, sin los puntos del final. */
export const tag = z
  .string()
  .trim()
  .transform((v) => v.replace(/\.+$/, '').toUpperCase())
  .pipe(z.string().min(4, 'Tag inválido').max(30, 'Máximo 30 caracteres')
    .regex(/^[A-Z0-9]+$/, 'Solo letras y números'))

export const CruceSchema = z.object({
  renglon: z.coerce.number().int().positive(),
  tag,
  fecha_hora: fechaHora,
  evento: z.string().trim().max(20).nullable(),
  carril: z.string().trim().max(10).nullable(),
  caseta: z.string().trim().min(1).max(10),
  descripcion: z.string().trim().min(1).max(100),
  clase: z.coerce.number().int().min(0).max(20),
  importe: dinero,
  iva: dinero,
  total: dinero,
})

export const FacturaCasetasImportSchema = z.object({
  uuid: z.string().trim().toUpperCase()
    .regex(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/, 'UUID inválido'),
  serie: z.string().trim().max(25).nullable(),
  folio: z.string().trim().min(1).max(40),
  fecha_emision: fechaHora,
  fecha_limite_pago: fecha.nullable(),
  periodo: z.string().trim().max(100).nullable(),
  periodo_desde: fecha.nullable(),
  periodo_hasta: fecha.nullable(),
  subtotal: dinero,
  iva: dinero,
  total: dinero,
  /**
   * El tope es holgado a propósito: una decena normal trae unos 400 cruces. Más
   * de 3,000 es más probable un archivo equivocado que diez días de flota.
   */
  cruces: z.array(CruceSchema).min(1, 'La factura no trae cruces').max(3000),
})

export const FacturaCasetasQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  /** Solo las que nadie ha revisado: la bandeja. */
  por_revisar: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true' || v === '1')
    .optional(),
})

export const RevisarCasetasSchema = z.object({
  nota: z.string().trim().max(255, 'Máximo 255 caracteres').optional(),
})

export const TagCreateSchema = z.object({
  tag,
  vehiculo_id: z.coerce.number().int().positive().nullable(),
  nota: z.string().trim().max(255).nullish(),
})

export const TagUpdateSchema = z.object({
  vehiculo_id: z.coerce.number().int().positive().nullable(),
  nota: z.string().trim().max(255).nullish(),
})

export type Cruce = z.infer<typeof CruceSchema>
export type FacturaCasetasImport = z.infer<typeof FacturaCasetasImportSchema>
export type FacturaCasetasQuery = z.infer<typeof FacturaCasetasQuerySchema>
export type TagCreate = z.infer<typeof TagCreateSchema>
export type TagUpdate = z.infer<typeof TagUpdateSchema>
