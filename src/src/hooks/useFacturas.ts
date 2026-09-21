// Las facturas de compra de refacciones.
//
// Desde la migración 026 son una tabla, con su cabecera —folio, proveedor,
// fecha, IVA, descuento— guardada una sola vez. Antes eran el conjunto de lotes
// que compartían folio, con esa cabecera copiada en cada renglón, y de ahí venían
// las tasas disparejas entre renglones de una misma factura. Eso ya no puede
// pasar.
//
// La llave sigue siendo (folio, proveedor), ahora impuesta por un UNIQUE en la
// base: dos proveedores pueden emitir un "A-100" cada uno y no son la misma
// compra, pero el mismo proveedor no puede emitirlo dos veces.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface FacturaRenglon {
  lote_id:             number
  pieza_id:            number
  numero_serie:        string
  descripcion:         string
  cantidad_inicial:    number
  cantidad_disponible: number
  costo_unitario:      number
  sucursal:            string | null
  /** Quién tecleó este renglón. Es a quien se le carga un error de captura. */
  capturado_por:       string | null
  /** null = todavía no se ha cuadrado contra la factura original. */
  revisado_en:         string | null
  revisado_por:        string | null
}

export interface Factura {
  id:           number
  num_factura:  string
  proveedor_id: number
  proveedor:    string
  fecha_compra: string
  renglones:    number
  /**
   * Todo lo que cobra el papel según lo capturado, sin IVA ni descuento: sus
   * refacciones más la mano de obra de los mantenimientos que reclama. Las dos
   * mitades van juntas porque el IVA y el descuento son del documento entero.
   */
  subtotal:     number
  /** La parte del subtotal que es mano de obra. 0 en una factura de refacciones. */
  subtotal_mano_obra: number
  /** Cuántos servicios de taller cobra este papel. */
  mano_obra:    number
  /** Cuántos de esos servicios ya están sellados. */
  mano_obra_revisada: number
  /** null = los precios ya incluyen IVA (o la compra es exenta). */
  tasa_iva:     number | null
  /**
   * Descuento del proveedor sobre el total, en por ciento. null = no trae. Se
   * resta al subtotal ANTES del IVA, que es como lo emite el proveedor: ver
   * `totalesFactura` en `lib/totales`.
   */
  descuento_pct: number | null
  comprado_por:  string
  autorizado_por: string
  /**
   * Se cargó de un histórico: la compra es real y su gasto cuenta, pero las
   * piezas ya se habían usado cuando se capturó y nacieron con existencia cero.
   */
  historica:     boolean
  /**
   * Nadie la había capturado: apareció al revisar el fajo de papeles. Es el
   * error más caro de todos —un gasto completo fuera de los libros—.
   */
  hallada_en_revision: boolean
  /** null = la cabecera no se ha cuadrado contra el papel. */
  cabecera_revisada_en:  string | null
  cabecera_revisada_por: string | null
  /** Lo que el verificador dejó dicho del documento. */
  revision_nota:         string | null
  /** Cuántos de sus renglones ya están sellados. */
  renglones_revisados:   number
  /**
   * Cabecera sellada y nada pendiente, ni refacciones ni mano de obra. Lo
   * calcula la API.
   */
  cerrada:               boolean
  detalle:      FacturaRenglon[]
}

export interface FacturasFiltros {
  page?:     number
  pageSize?: number
  search?:   string
  desde?:    string
  hasta?:    string
  /**
   * Solo lo que falta por cuadrar contra el papel. Cuenta como pendiente tanto
   * la cabecera sin sellar como cualquier renglón sin sellar: son las dos
   * mitades del mismo trabajo.
   */
  por_revisar?: boolean
  /**
   * Solo las que cobran mano de obra: la vista de facturas de mantenimientos.
   * No hay una tabla aparte para ellas — el taller cobra las refacciones y el
   * trabajo en el mismo papel, y ese papel es una sola factura.
   */
  con_mano_obra?: boolean
  /**
   * Solo las de refacciones. No es la negación de `con_mano_obra`: una factura
   * vacía puede ser una hallada al revisar —que sí va aquí, porque es donde se
   * le capturan las compras— o la cabecera de un taller sin transcribir, que no.
   */
  con_refacciones?: boolean
}

interface FacturasResponse {
  data: Factura[]
  pagination: { page: number; pageSize: number; total: number }
}

export function useFacturas(filtros: FacturasFiltros, enabled = true) {
  return useQuery({
    queryKey: ['facturas', filtros],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filtros)) {
        if (v !== undefined && v !== '') qs.set(k, String(v))
      }
      return api.get<FacturasResponse>(`/facturas?${qs}`)
    },
    enabled,
  })
}

export interface FacturaTotalesPayload {
  num_factura:  string
  proveedor_id: number
  /** null devuelve la factura a "el precio ya incluye IVA". */
  tasa_iva:     number | null
  /** null la devuelve a "sin descuento". */
  descuento_pct: number | null
}

/**
 * Fija la tasa y el descuento de la factura. Desde que la cabecera es una fila,
 * es un UPDATE de un renglón y no de N.
 *
 * Los dos viajan siempre juntos, aunque solo cambie uno: la API escribe ambos
 * y el que no cambia se manda con el valor que ya tenía. Juntos son el total de
 * la factura, y guardarlos por separado deja el desglose a medias.
 */
export function useSetTotalesFactura() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: FacturaTotalesPayload) =>
      api.put<{ data: { lotes_actualizados: number } }>('/facturas/totales', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facturas'] })
      // Los lotes cambiaron: el drawer de la refacción y cualquier lista que
      // los muestre traen la tasa y el descuento viejos.
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
    },
  })
}

export interface FacturaFolioPayload {
  num_factura:       string
  proveedor_id:      number
  nuevo_num_factura: string
  /**
   * Usar un folio que ese proveedor ya tiene, a sabiendas: las dos compras
   * quedan como una sola factura. Sin esto la API responde 409 con el código
   * FOLIO_EXISTENTE, que es la señal para preguntarle al usuario.
   */
  confirmar_fusion?: boolean
}

/** El 409 que pide confirmar antes de juntar dos compras en una factura. */
export const FOLIO_EXISTENTE = 'FOLIO_EXISTENTE'

/**
 * Corrige el folio mal capturado de la compra, reescribiéndolo en todos sus
 * lotes.
 */
export function useSetFolioFactura() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: FacturaFolioPayload) =>
      api.put<{ data: { num_factura: string; lotes_actualizados: number } }>(
        '/facturas/folio', payload,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facturas'] })
      // El folio se ve en el drawer de la refacción, en el inventario y en las
      // compras del proveedor: todas esas listas traen el viejo.
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      qc.invalidateQueries({ queryKey: ['inventario-existencias'] })
      qc.invalidateQueries({ queryKey: ['proveedor-gastos'] })
    },
  })
}

/**
 * Cambia el folio de UN renglón. Es lo que permite sacar de la factura un lote
 * que no pertenecía a ella —o que se juntó al fusionar dos compras— sin tocar
 * los demás. Reusa el update del lote: el folio es un campo suyo.
 */
export function useSetFolioLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lote_id, num_factura }: { lote_id: number; num_factura: string }) =>
      api.put<{ data: { id: number } }>(`/lotes/${lote_id}`, { num_factura }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facturas'] })
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      qc.invalidateQueries({ queryKey: ['inventario-existencias'] })
      qc.invalidateQueries({ queryKey: ['proveedor-gastos'] })
    },
  })
}
