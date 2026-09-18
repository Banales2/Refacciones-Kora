// Las facturas de la gasolinera, desglosadas por ticket.
//
// La factura SÍ viene detallada: un renglón por carga, con sus litros, su precio
// unitario y su importe. Lo que no trae es a qué vehículo fue, qué chofer la hizo
// ni contra qué vale — eso solo lo sabe el sistema. Conciliar es casar cada
// renglón del papel con su recarga.
//
// SE CASA POR LITROS, NO POR IMPORTE. El importe del renglón es sin IVA (los
// renglones suman el subtotal, no el total) y el costo de la recarga es lo que se
// pagó en la bomba, que sí lo incluye: compararlos da 16% de diferencia siempre.
// Los litros son el mismo número de los dos lados.
//
// Ver `docs/facturas-de-gasolina.md`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** Quedaron tickets sin casar y no se confirmó cerrar así. */
export const RENGLONES_SIN_CASAR = 'RENGLONES_SIN_CASAR'

export type MetodoCasado = 'ticket' | 'litros' | 'manual'

export interface FacturaGasolina {
  id:             number
  gasolinera_id:  number
  gasolinera:     string
  serie:          string | null
  folio:          string
  fecha:          string
  /** Suma de los renglones, sin IVA. */
  subtotal:       number
  iva:            number
  total:          number
  uuid:           string | null
  capturado_por:  string
  conciliada_en:  string | null
  conciliada_por: string | null
  nota:           string | null
  /** Cuántos tickets trae el papel. */
  renglones:      number
  /** Cuántos de esos ya casaron con una recarga. */
  casados:        number
  litros_factura: number
}

export interface RenglonFactura {
  id:              number
  ticket:          string | null
  producto:        string | null
  litros:          number
  precio_unitario: number | null
  /** Sin IVA. No es comparable con `recarga_costo`. */
  importe:         number
  recarga_id:      number | null
  metodo:          MetodoCasado | null
  recarga_fecha:   string | null
  recarga_litros:  number | null
  /** Lo que se pagó en la bomba: CON IVA. */
  recarga_costo:   number | null
  vehiculo:        string | null
  conductor:       string | null
  vale_folio:      string | null
  /** Lo que el sistema propone para un renglón todavía sin casar. */
  sugerida_recarga_id: number | null
  sugerido_metodo: 'ticket' | 'litros' | null
}

export interface RecargaCandidata {
  id:         number
  fecha:      string
  litros:     number
  costo:      number
  ticket:     string | null
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

export interface RenglonNuevo {
  ticket?:          string | null
  producto?:        string | null
  litros:           number
  precio_unitario?: number | null
  importe:          number
}

export interface FacturaGasolinaCreatePayload {
  gasolinera_id: number
  serie?:        string | null
  folio:         string
  fecha:         string
  subtotal:      number
  iva:           number
  total:         number
  uuid?:         string | null
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
  casados: { renglon_id: number; recarga_id: number | null; metodo?: MetodoCasado }[]
  nota?: string
  /** Sellar aunque queden tickets sin casar. Sin esto la API responde 409. */
  confirmar_sin_casar?: boolean
}

export interface ResultadoConciliacion {
  factura_id:        number
  renglones:         number
  casados:           number
  /** Tickets del papel que no corresponden a ninguna recarga capturada. */
  sin_casar:         number
  /** Lo que esos tickets valen, sin IVA: el gasto que no está registrado. */
  importe_sin_casar: number
  litros_sin_casar:  number
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
