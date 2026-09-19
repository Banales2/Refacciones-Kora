// Las facturas de la gasolinera y a qué recarga corresponde cada renglón.
//
// Esto NO guarda la factura: el documento se archiva por otro lado. Aquí vive lo
// justo para comprobar que el gasto está bien capturado — descripción, cantidad
// e importe por renglón, y la tasa de IVA en la cabecera. Los importes se
// calculan, igual que en las facturas de refacciones.
//
// SE CASA POR CANTIDAD, NO POR IMPORTE. El importe del renglón suele venir sin
// IVA y el costo de la recarga es lo que se pagó en la bomba, que sí lo incluye:
// compararlos da 16% de diferencia siempre. Los litros son el mismo número de los
// dos lados.
//
// Ver `docs/facturas-de-gasolina.md`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** Quedaron renglones sin casar y no se confirmó cerrar así. */
export const RENGLONES_SIN_CASAR = 'RENGLONES_SIN_CASAR'

export interface FacturaGasolina {
  id:             number
  gasolinera_id:  number
  gasolinera:     string
  folio:          string
  fecha:          string
  /** null = los importes de los renglones ya incluyen IVA. */
  tasa_iva:       number | null
  capturado_por:  string
  conciliada_en:  string | null
  conciliada_por: string | null
  nota:           string | null
  /** Cuántos renglones trae el papel. */
  renglones:      number
  /** Cuántos de esos ya casaron con una recarga. */
  casados:        number
  /** Suma de los importes de los renglones. El total se calcula con la tasa. */
  subtotal:       number
}

export interface RenglonFactura {
  id:             number
  descripcion:    string | null
  cantidad:       number
  importe:        number
  recarga_id:     number | null
  recarga_fecha:  string | null
  recarga_litros: number | null
  /** Lo que se pagó en la bomba. No comparable con `importe` si hay tasa. */
  recarga_costo:  number | null
  vehiculo:       string | null
  conductor:      string | null
  vale_folio:     string | null
  /** Lo que el sistema propone para un renglón todavía sin casar. */
  sugerida_recarga_id: number | null
}

export interface RecargaCandidata {
  id:         number
  fecha:      string
  litros:     number
  costo:      number
  vehiculo:   string
  conductor:  string
  vale_folio: string | null
}

export interface FacturasGasolinaFiltros {
  page?:          number
  pageSize?:      number
  gasolinera_id?: number
  search?:        string
  desde?:         string
  hasta?:         string
  por_conciliar?: boolean
}

interface FacturasGasolinaResponse {
  data: FacturaGasolina[]
  pagination: { page: number; pageSize: number; total: number }
}

export function useFacturasGasolina(filtros: FacturasGasolinaFiltros, enabled = true) {
  return useQuery({
    queryKey: ['facturas-gasolina', filtros],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filtros)) {
        if (v !== undefined && v !== '') qs.set(k, String(v))
      }
      return api.get<FacturasGasolinaResponse>(`/facturas-gasolina?${qs}`)
    },
    enabled,
  })
}

export interface Candidatas {
  factura:   FacturaGasolina
  renglones: RenglonFactura[]
  recargas:  RecargaCandidata[]
}

/** Los renglones de la factura con su propuesta, y las recargas elegibles. */
export function useCandidatas(facturaId: number | null) {
  return useQuery({
    queryKey: ['facturas-gasolina', 'candidatas', facturaId],
    queryFn: () => api.get<{ data: Candidatas }>(`/facturas-gasolina/${facturaId}/candidatas`),
    enabled: facturaId !== null,
  })
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['facturas-gasolina'] })
  // Las recargas cambian de "sin facturar" a "facturada", y eso se ve en las
  // listas de consumos.
  qc.invalidateQueries({ queryKey: ['recargas'] })
  qc.invalidateQueries({ queryKey: ['gasolinera-consumos'] })
}

/**
 * Lo que una gasolinera despacha, y lo único que puede decir un renglón.
 *
 * Lista cerrada y no texto libre porque son tres y no cambian: dejarlo abierto
 * solo produce "DIESEL", "diesel" y "Diésel" como si fueran cosas distintas.
 * La API valida contra esta misma lista.
 */
export const PRODUCTOS = ['Diesel', 'Magna', 'Premium'] as const
export type Producto = typeof PRODUCTOS[number]

export interface RenglonNuevo {
  descripcion: Producto
  cantidad:    number
  importe:     number
}

export interface FacturaGasolinaCreatePayload {
  gasolinera_id: number
  folio:         string
  fecha:         string
  /** null = los importes ya incluyen IVA. No es cero. */
  tasa_iva:      number | null
  renglones:     RenglonNuevo[]
}

export function useCrearFacturaGasolina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FacturaGasolinaCreatePayload) =>
      api.post<{ data: { id: number } }>('/facturas-gasolina', body),
    onSuccess: () => invalidar(qc),
  })
}

export interface ConciliarPayload {
  factura_id: number
  /** El conjunto COMPLETO, con los renglones sin casar y su recarga en null. */
  casados: { renglon_id: number; recarga_id: number | null }[]
  nota?: string
  /** Sellar aunque queden renglones sin casar. Sin esto la API responde 409. */
  confirmar_sin_casar?: boolean
}

export interface ResultadoConciliacion {
  factura_id:        number
  renglones:         number
  casados:           number
  /** Renglones del papel que no corresponden a ninguna recarga capturada. */
  sin_casar:         number
  /** Lo que valen: el gasto que no está registrado. */
  importe_sin_casar: number
  cantidad_sin_casar: number
}

/** Guarda los casados y sella la factura. Solo admin. */
export function useConciliar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ factura_id, ...body }: ConciliarPayload) =>
      api.post<{ data: ResultadoConciliacion }>(
        `/facturas-gasolina/${factura_id}/conciliar`, body,
      ),
    onSuccess: () => invalidar(qc),
  })
}

/**
 * Suelta el sello para volver a cuadrar.
 *
 * Los casados no se deshacen: al reabrir solo hay que ajustar lo que faltaba. Es
 * lo que hace falta cuando aparece la recarga que no estaba.
 */
export function useReabrirFacturaGasolina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (facturaId: number) =>
      api.post<{ data: { id: number } }>(`/facturas-gasolina/${facturaId}/reabrir`, {}),
    onSuccess: () => invalidar(qc),
  })
}
