import { z } from 'zod'
import { permisoCre, rfc } from './gasolineraSchema'

// La factura de la gasolinera, desglosada en renglones.
//
// Esto no guarda la factura —el documento se archiva por otro lado—: guarda lo
// justo para comprobar que el gasto está bien capturado. De ahí que el renglón
// tenga tres campos y no diez.
//
// Ver `db/migrations/041_facturas_de_gasolina.sql`.

// Fecha local (no UTC) para no rechazar "hoy" en zonas horarias detrás de UTC.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
  .refine((v) => v <= todayIso(), 'No puede ser una fecha futura')

// El patrón es más ancho que el del vale —admite minúsculas, espacios y
// diagonales— y la diferencia es deliberada: el vale sale de un talonario con
// formato propio, la factura la emite quien quiera.
const folio = z
  .string()
  .trim()
  .min(1, 'Folio requerido')
  .max(30, 'Máximo 30 caracteres')
  .regex(/^[A-Za-z0-9/\- ]+$/, 'Solo letras, números, espacios, guiones y diagonales')

// Igual que en `recargaSchema`: la bomba despacha en milésimas y la columna
// guarda DECIMAL(10,3). Aquí importa el doble, porque la cantidad es la llave
// del cuadre.
const cantidad = z.coerce
  .number()
  .positive('Debe ser mayor a 0')
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Máximo 3 decimales')

const ivaDelPapel = z.coerce
  .number()
  .min(0, 'No puede ser negativo')
  .max(99999999, 'Fuera de rango')

/**
 * Lo que una gasolinera despacha, y lo único que puede decir un renglón.
 *
 * Es una lista cerrada y no texto libre porque son tres y no cambian: dejarlo
 * abierto solo produce "DIESEL", "diesel" y "Diésel" como si fueran cosas
 * distintas, y entonces cualquier corte por producto miente.
 *
 * Los renglones que vengan de la 042 —convertidos de la columna `producto`—
 * pueden traer otra cosa; la columna sigue admitiéndolo. Esto valida lo que
 * entra de aquí en adelante.
 */
export const PRODUCTOS = ['Diesel', 'Magna', 'Premium'] as const

export const RenglonFacturaSchema = z.object({
  descripcion: z.enum(PRODUCTOS, { message: 'Elige Diesel, Magna o Premium' }),
  cantidad,
  importe: z.coerce.number().min(0, 'No puede ser negativo').max(99999999, 'Fuera de rango'),
})

export const FacturaGasolinaCreateSchema = z.object({
  gasolinera_id: z.coerce.number().int().min(1, 'Gasolinera requerida'),
  folio,
  /** El corte del cuadre: se ofrecen las recargas de ese día hacia atrás. */
  fecha,
  /**
   * Solo la tasa; el subtotal y el total se calculan. Ausente (o null) significa
   * que los importes de los renglones YA incluyen IVA, no que la tasa sea cero
   * — mismo criterio que `lotes_pieza.tasa_iva` (migración 020).
   */
  tasa_iva: z.coerce
    .number()
    .positive('La tasa debe ser mayor a 0')
    .max(100, 'La tasa no puede pasar de 100%')
    .nullish(),
  /**
   * El IVA como viene en el papel. Es lo que se manda ahora en vez de la tasa:
   * en combustible el IVA no se cobra sobre el IEPS, así que el total es
   * subtotal + IVA y no subtotal * 1.16. Ver la migración 065.
   */
  iva: ivaDelPapel.nullish(),
  /**
   * El tope no es arbitrario: una factura de gasolinera con más de 300 renglones
   * es más probable que sea un error de pegado que un mes real.
   */
  renglones: z
    .array(RenglonFacturaSchema)
    .min(1, 'La factura tiene que traer al menos un renglón')
    .max(300, 'Máximo 300 renglones por factura'),
})

/**
 * Un concepto del CFDI. La cantidad puede traer seis decimales (90.451852); se
 * guarda a tres, que es como guarda el ticket la bomba y como se casan.
 */
export const RenglonImportadoSchema = z.object({
  descripcion: z.enum(PRODUCTOS),
  cantidad: z.coerce.number().positive('Debe ser mayor a 0').max(99999),
  importe: z.coerce.number().min(0).max(99999999),
  iva: z.coerce.number().min(0).max(99999999),
  /** El número de despacho de la bomba, de `NoIdentificacion`. */
  despacho: z.string().trim().max(30).nullable(),
})

/**
 * La factura leída de su XML (CFDI 4.0 con el complemento de Hidrocarburos).
 *
 * La gasolinera se reconoce por el PERMISO de la estación, no por el nombre ni
 * por el RFC: una razón social puede tener varias estaciones. Si el permiso no
 * está ligado a ninguna, `gasolinera_id` dice de cuál es y el permiso se le
 * queda. Ver la migración 066.
 */
export const FacturaGasolinaImportSchema = z.object({
  uuid: z.string().trim().toUpperCase()
    .regex(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/, 'UUID inválido'),
  serie: z.string().trim().max(25).nullable(),
  folio: z.string().trim().min(1).max(40),
  fecha,
  permiso_cre: permisoCre,
  emisor_rfc: rfc,
  gasolinera_id: z.coerce.number().int().positive().optional(),
  subtotal: z.coerce.number().min(0).max(99999999),
  iva: ivaDelPapel,
  total: z.coerce.number().min(0).max(99999999),
  renglones: z.array(RenglonImportadoSchema)
    .min(1, 'La factura no trae renglones')
    .max(300, 'Máximo 300 renglones por factura'),
})

/** Corregir con el papel el IVA de una factura capturada con tasa. */
export const IvaFacturaSchema = z.object({ iva: ivaDelPapel })

export const FacturaGasolinaQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  gasolinera_id: z.coerce.number().int().min(1).optional(),
  search: z.string().max(100).optional(),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  /** Solo las que faltan por cuadrar: la bandeja de quien concilia. */
  por_conciliar: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true' || v === '1')
    .optional(),
})

/** Los tickets que ninguna factura ha reclamado. Reusa los filtros del listado. */
export const SinFacturarQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  gasolinera_id: z.coerce.number().int().min(1).optional(),
  /** Busca en gasolinera, número de serie de la unidad, chofer y folio del vale. */
  search: z.string().max(100).optional(),
  desde: fecha.optional(),
  hasta: fecha.optional(),
})

export const ConciliarGasolinaSchema = z.object({
  /**
   * A qué ticket de recarga corresponde cada renglón. Va el conjunto COMPLETO,
   * con los renglones sin casar incluidos y su `ticket_id` en null: la pantalla manda
   * la verdad entera y el servidor reemplaza. Mandar altas y bajas por separado
   * solo agrega una forma de que las dos versiones discrepen.
   */
  casados: z
    .array(z.object({
      renglon_id: z.coerce.number().int().positive(),
      ticket_id:  z.coerce.number().int().positive().nullable(),
    }))
    .max(300),
  nota: z.string().trim().max(255, 'Máximo 255 caracteres').optional(),
  /**
   * Sellar aunque queden renglones sin casar. Sin esto la API responde 409 con
   * cuántos son y cuánto valen: cerrar con huecos es legítimo —la recarga puede
   * capturarse la semana que viene— pero no puede pasar por descuido.
   */
  confirmar_sin_casar: z.boolean().optional().default(false),
})

export type FacturaGasolinaCreate = z.infer<typeof FacturaGasolinaCreateSchema>
export type FacturaGasolinaQueryIn = z.infer<typeof FacturaGasolinaQuerySchema>
export type ConciliarGasolina = z.infer<typeof ConciliarGasolinaSchema>
export type IvaFactura = z.infer<typeof IvaFacturaSchema>
export type FacturaGasolinaImport = z.infer<typeof FacturaGasolinaImportSchema>
export type SinFacturarQuery = z.infer<typeof SinFacturarQuerySchema>
