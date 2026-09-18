import { z } from 'zod'

// La factura de la gasolinera, desglosada por ticket.
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

const importe = z.coerce.number().min(0, 'No puede ser negativo').max(99999999, 'Fuera de rango')

// Igual que en `recargaSchema`: la bomba despacha en milésimas y la columna
// guarda DECIMAL(10,3), así que un cuarto decimal se redondearía en silencio.
// Aquí importa el doble, porque los litros son la llave del cuadre.
const litros = z.coerce
  .number()
  .positive('Debe ser mayor a 0')
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Máximo 3 decimales')

export const RenglonFacturaSchema = z.object({
  /**
   * El número del ticket de la bomba. En el CFDI viene al final del
   * "No. Identificación" ("PL/6809/EXP/ES/2015-8367437") y otra vez en la lista
   * de "Tickets:". Se puede pegar entero: el servidor compara por el último
   * tramo.
   */
  ticket: z.string().trim().max(40).optional().nullable(),
  /** DIESEL, MAGNA, PREMIUM. Se guarda como viene. */
  producto: z.string().trim().max(40).optional().nullable(),
  litros,
  precio_unitario: z.coerce.number().min(0).max(9999).optional().nullable(),
  /** SIN IVA, que es como lo emite el CFDI. */
  importe,
})

export const FacturaGasolinaCreateSchema = z.object({
  gasolinera_id: z.coerce.number().int().min(1, 'Gasolinera requerida'),
  /** La serie del CFDI ("G"). Puede faltar. */
  serie: z.string().trim().max(10).optional().nullable(),
  folio,
  fecha,
  /** Suma de los renglones, sin IVA. El servicio comprueba que cuadre. */
  subtotal: importe,
  iva: importe.default(0),
  total: z.coerce.number().positive('Debe ser mayor a 0').max(99999999, 'Fuera de rango'),
  /** El UUID del CFDI, si se tiene. Es lo que detecta la factura capturada dos veces. */
  uuid: z.string().trim().max(36).optional().nullable(),
  /**
   * Un renglón por ticket. El tope no es arbitrario: una factura de gasolinera
   * con más de 300 cargas es más probable que sea un error de captura o de
   * pegado que un mes real.
   */
  renglones: z
    .array(RenglonFacturaSchema)
    .min(1, 'La factura tiene que traer al menos un ticket')
    .max(300, 'Máximo 300 tickets por factura'),
})

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

export const ConciliarGasolinaSchema = z.object({
  /**
   * A qué recarga corresponde cada renglón. Va el conjunto COMPLETO, con los
   * renglones sin casar incluidos y su `recarga_id` en null: la pantalla manda
   * la verdad entera y el servidor reemplaza. Mandar altas y bajas por separado
   * solo agrega una forma de que las dos versiones discrepen.
   */
  casados: z
    .array(z.object({
      renglon_id: z.coerce.number().int().positive(),
      recarga_id: z.coerce.number().int().positive().nullable(),
      /** Cómo se casó. Sirve para saber en cuáles confiar sin volver a mirar. */
      metodo: z.enum(['ticket', 'litros', 'manual']).optional(),
    }))
    .max(300),
  nota: z.string().trim().max(255, 'Máximo 255 caracteres').optional(),
  /**
   * Sellar aunque queden tickets sin casar. Sin esto la API responde 409 con
   * cuántos son y cuánto valen: cerrar con huecos es legítimo —la recarga puede
   * capturarse la semana que viene— pero no puede pasar por descuido.
   */
  confirmar_sin_casar: z.boolean().optional().default(false),
})

export type FacturaGasolinaCreate = z.infer<typeof FacturaGasolinaCreateSchema>
export type FacturaGasolinaQueryIn = z.infer<typeof FacturaGasolinaQuerySchema>
export type ConciliarGasolina = z.infer<typeof ConciliarGasolinaSchema>
