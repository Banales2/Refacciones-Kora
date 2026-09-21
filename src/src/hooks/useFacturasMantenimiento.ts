// Las facturas de taller: la mano de obra del papel.
//
// NO HAY UNA TABLA DE FACTURAS DE MANTENIMIENTO, y eso es lo primero que hay que
// saber para no buscarla. El taller cobra las refacciones y la mano de obra en el
// MISMO papel, con un folio, un IVA y un descuento; si la mano de obra tuviera su
// propia cabecera, el mismo folio quedaría partido en dos con la tasa capturada
// dos veces y "cuánto cobra este papel" dejaría de tener una respuesta.
//
// Así que la factura es la misma de siempre y tiene dos clases de renglón:
//
//   lotes_pieza          las refacciones capturadas
//   facturas_mano_obra   la mano de obra del papel → mantenimiento
//
// Una factura de puro taller es una sin refacciones; una mixta es la misma fila
// apareciendo en las dos pantallas.
//
// Ver `docs/facturas-de-mantenimiento.md`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Cuadre } from './useCuadreFactura'

/** El papel cobra un servicio que otra factura ya cobró. */
export const MANTENIMIENTO_YA_FACTURADO = 'MANTENIMIENTO_YA_FACTURADO'

export interface MantenimientoCandidato {
  id:            number
  fecha:         string | null
  tipo:          string | null
  costo:         number
  km_actual:     number | null
  vehiculo:      string
  taller:        string | null
  observaciones: string | null
}

interface CandidatosResponse {
  data:   MantenimientoCandidato[]
  /** El taller que emitió la factura. null = no es de ningún taller. */
  taller: { id: number; nombre: string } | null
}

/**
 * Los mantenimientos que esta factura podría estar cobrando: los de su taller,
 * con fecha menor o igual a la suya, que ninguna otra factura haya reclamado.
 *
 * No viene nada propuesto por importe. Dos servicios del mismo taller pueden
 * costar lo mismo sin ser el mismo trabajo, y un emparejamiento inventado que
 * nadie revisa es peor que ninguno: lo elige una persona viendo la unidad y la
 * fecha.
 */
export function useCandidatosManoObra(facturaId: number | null) {
  return useQuery({
    queryKey: ['mano-obra-candidatos', facturaId],
    queryFn: () => api.get<CandidatosResponse>(`/facturas/${facturaId}/mano-obra/candidatos`),
    enabled: facturaId !== null,
  })
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  for (const key of [
    ['factura-cuadre'], ['facturas'], ['mano-obra-candidatos'],
    ['mantenimientos-sin-facturar'], ['mantenimientos'], ['mantenimiento-detalle'],
    ['correcciones-factura'], ['revision-errores'], ['revision-correcciones'],
    ['dashboard'], ['actividad-dia'],
  ]) {
    qc.invalidateQueries({ queryKey: key })
  }
}

export interface RenglonManoObraPayload {
  /** El servicio que cobra. null = el papel cobra algo que nadie registró. */
  mantenimiento_id: number | null
  importe:          number
}

/**
 * Guarda la mano de obra que cobra el papel y devuelve el cuadre recalculado.
 *
 * Va la transcripción COMPLETA, no lo que se agrega: la pantalla manda la verdad
 * entera y el servidor reemplaza. Es el mismo trato que en refacciones.
 */
export function useGuardarManoObra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ factura_id, renglones }: {
      factura_id: number
      renglones:  RenglonManoObraPayload[]
    }) => api.put<{ data: Cuadre }>(`/facturas/${factura_id}/mano-obra`, { renglones }),
    onSuccess: () => invalidar(qc),
  })
}

export interface FacturaTallerPayload {
  /** El TALLER. Que por debajo cuelgue de un proveedor no es cosa de quien captura. */
  tecnico_id:    number
  num_factura:   string
  fecha_compra:  string
  tasa_iva:      number | null
  descuento_pct: number | null
  /** Quién autorizó el trabajo, según el papel. */
  comprado_por:  string
}

/**
 * Da de alta la factura de un taller.
 *
 * Si ese taller ya tiene ese folio devuelve la que existía con `ya_existia` en
 * true, en vez de fallar: el caso normal de un papel mixto es que sus
 * refacciones ya se hayan capturado como compra, y entonces lo que falta es
 * colgarle la mano de obra, no abrir un segundo documento con el mismo folio.
 */
export function useCrearFacturaTaller() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FacturaTallerPayload) =>
      api.post<{ data: { id: number; ya_existia: boolean } }>('/facturas/taller', body),
    onSuccess: () => invalidar(qc),
  })
}

export interface MantenimientoSinFacturar {
  id:       number
  fecha:    string | null
  tipo:     string | null
  costo:    number
  vehiculo: string
  taller:   string | null
  /** Cuántos días lleva esperando su factura. */
  dias:     number | null
}

export interface SinFacturarFiltros {
  page?:       number
  pageSize?:   number
  tecnico_id?: number
  search?:     string
  desde?:      string
  hasta?:      string
}

interface SinFacturarResponse {
  data:        MantenimientoSinFacturar[]
  costo_total: number
  pagination:  { page: number; pageSize: number; total: number }
}

/**
 * Los mantenimientos que ninguna factura ha reclamado.
 *
 * Es el reverso del cuadre, y aquí sí se puede tener: un servicio se registra
 * cuando el camión vuelve del taller, exista o no el papel, así que la ausencia
 * de factura se detecta sola. En refacciones no hay equivalente — un lote no
 * existe hasta que alguien captura la compra.
 *
 * Casi nunca es un problema, el papel llega después del servicio. Uno de hace
 * tres meses sin facturar sí lo es, y de ahí que cada renglón traiga los días que
 * lleva esperando.
 */
export function useMantenimientosSinFacturar(filtros: SinFacturarFiltros, enabled = true) {
  return useQuery({
    queryKey: ['mantenimientos-sin-facturar', filtros],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filtros)) {
        if (v !== undefined && v !== '') qs.set(k, String(v))
      }
      return api.get<SinFacturarResponse>(`/mantenimientos/sin-facturar?${qs}`)
    },
    enabled,
  })
}
