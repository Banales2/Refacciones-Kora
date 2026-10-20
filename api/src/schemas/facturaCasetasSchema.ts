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

// Una tarifa con IVA, en pesos. Sin `coerce`: convertiría el null de "no se
// publica esta clasificación" en $0, que es una tarifa distinta.
const tarifa = z.number().min(0).max(99999).nullable()

const TarifaValoresSchema = z.object({
  vigente_desde: fecha,
  moto: tarifa,
  auto: tarifa,
  autobus_2: tarifa,
  autobus_3: tarifa,
  autobus_4: tarifa,
  camion_2: tarifa,
  camion_3: tarifa,
  camion_4: tarifa,
  camion_5: tarifa,
  camion_6: tarifa,
  camion_7: tarifa,
  camion_8: tarifa,
  camion_9: tarifa,
  eje_ligero: tarifa,
  eje_pesado: tarifa,
})

const algunaTarifa = ({ vigente_desde: _, ...v }: z.infer<typeof TarifaValoresSchema>) =>
  Object.values(v).some((x) => x !== null)
const SIN_TARIFAS = { message: 'Captura al menos una tarifa' }

/** Corregir una vigencia que ya existe: sus precios o su fecha. */
export const TarifaUpdateSchema = TarifaValoresSchema.refine(algunaTarifa, SIN_TARIFAS)

/** Un aumento: una vigencia nueva para un tramo que ya existe. */
export const TarifaCreateSchema = TarifaValoresSchema
  .extend({ tramo_id: z.number().int().positive() })
  .refine(algunaTarifa, SIN_TARIFAS)

/** Un tramo nuevo, con las casetas de PASE que lo cobran y su primera tarifa. */
export const TramoCreateSchema = TarifaValoresSchema
  .extend({
    autopista: z.string().trim().min(1, 'Requerido').max(80),
    nombre: z.string().trim().min(1, 'Requerido').max(120),
    casetas: z.array(z.string().trim().min(1).max(10)).min(1).max(20),
  })
  .refine(algunaTarifa, SIN_TARIFAS)

/** Ligar un tramo que ya existe a otra caseta de PASE. */
export const CasetaTramoCreateSchema = z.object({
  caseta: z.string().trim().min(1).max(10),
  tramo_id: z.number().int().positive(),
})

/** Marcar que una caseta no manda la clase real (EASYTRIP manda 1 a todo). */
export const CasetaPaseUpdateSchema = z.object({ ignora_clase: z.boolean() })

export type TarifaUpdate = z.infer<typeof TarifaUpdateSchema>
export type TarifaCreate = z.infer<typeof TarifaCreateSchema>
export type TramoCreate = z.infer<typeof TramoCreateSchema>
export type Cruce = z.infer<typeof CruceSchema>
export type FacturaCasetasImport = z.infer<typeof FacturaCasetasImportSchema>
export type FacturaCasetasQuery = z.infer<typeof FacturaCasetasQuerySchema>
export type TagCreate = z.infer<typeof TagCreateSchema>
export type TagUpdate = z.infer<typeof TagUpdateSchema>
