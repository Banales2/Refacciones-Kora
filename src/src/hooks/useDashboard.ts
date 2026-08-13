// Consultas del tablero principal: resumen de costos del mes, requerimientos
// vencidos y por vencer, historial para la gráfica, mantenimientos del
// calendario y el reporte de flota completo (este último bajo demanda).
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface VehiculoConMantenimiento {
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  cantidad:        number
  costo_total:     number
}

export interface LoteMes {
  id:               number
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  proveedor:        string
  fecha_compra:     string
  cantidad_inicial: number
  costo_unitario:   number
}

export interface ResumenMes {
  rango: { start: string; end: string }
  mantenimientos: {
    count:           number
    /** Mano de obra + piezas consumidas: lo que costó el servicio visto solo. */
    costo_total:     number
    costo_mano_obra: number
    costo_piezas:    number
    por_vehiculo:    VehiculoConMantenimiento[]
  }
  piezas: {
    count:       number
    costo_total: number
    lotes:       LoteMes[]
  }
  /**
   * Gasto real del periodo: mano de obra + refacciones compradas. Las piezas
   * consumidas en mantenimientos no se suman porque ya se pagaron al comprarlas.
   */
  costo_total_periodo: number
}

export function useResumenMes() {
  return useQuery({
    queryKey: ['dashboard', 'resumen-mes'],
    queryFn: () => api.get<{ data: ResumenMes }>('/dashboard/resumen-mes'),
  })
}

export interface RequerimientoVencido {
  id:              number
  nombre:          string
  categoria:       string | null
  vehiculo_id:     number
  vehiculo_nombre: string
}

export function useRequerimientosVencidos() {
  return useQuery({
    queryKey: ['dashboard', 'requerimientos-pendientes'],
    queryFn: () => api.get<{ data: RequerimientoVencido[] }>('/dashboard/requerimientos-pendientes'),
  })
}

export function useRequerimientosPorVencer() {
  return useQuery({
    queryKey: ['dashboard', 'requerimientos-por-vencer'],
    queryFn: () => api.get<{ data: RequerimientoVencido[] }>('/dashboard/requerimientos-por-vencer'),
  })
}

export interface IncidenciaAbierta {
  id:              number
  nombre:          string
  categoria:       string | null
  severidad:       'superficial' | 'moderada' | 'grave'
  fecha:           string
  vehiculo_id:     number
  vehiculo_nombre: string
}

export function useIncidenciasAbiertas() {
  return useQuery({
    queryKey: ['dashboard', 'incidencias-abiertas'],
    queryFn: () => api.get<{ data: IncidenciaAbierta[] }>('/dashboard/incidencias-abiertas'),
  })
}

export interface SeguroPorVencer {
  id:               number
  poliza:           string
  compania:         string
  fecha_expiracion: string
  vehiculos:        number
  dias_restantes:   number
}

export interface PermisoPorVencer {
  id:               number
  zona_circulacion: string
  fecha_expiracion: string
  vehiculos:        number
  dias_restantes:   number
}

export interface LicenciaPorVencer {
  conductor_id:     number
  conductor:        string
  tipo:             'estatal' | 'federal' | 'expediente'
  numero:           string | null
  // Vigencia tal como se capturó en el catálogo…
  vigencia:         string
  // …y la misma ya interpretada como fecha.
  fecha_expiracion: string
  dias_restantes:   number
}

// Tenencia de un vehículo. Solo la pagan reparto, tractocamiones y utilitarios.
export interface TenenciaPorVencer {
  vehiculo_id:      number
  vehiculo:         string
  placas:           string | null
  tipo:             string
  folio:            string | null
  fecha_expiracion: string
  dias_restantes:   number
}

// Unidad a la que le falta el documento por completo. No tiene fecha, así que
// no puede aparecer en las listas de "por vencer": se avisa aparte.
export interface VehiculoSinDocumento {
  vehiculo_id: number
  vehiculo:    string
  placas:      string | null
  tipo:        string
}

export interface DocumentosPorVencer {
  seguros:   SeguroPorVencer[]
  permisos:  PermisoPorVencer[]
  licencias: LicenciaPorVencer[]
  tenencias: TenenciaPorVencer[]
  sin_tenencia: VehiculoSinDocumento[]
  sin_seguro:   VehiculoSinDocumento[]
}

// Seguros y permisos de circulación ya vencidos o próximos a vencer (30 días),
// más las licencias de conductor con vigencia dentro de 2 meses.
export function useDocumentosPorVencer() {
  return useQuery({
    queryKey: ['dashboard', 'documentos-por-vencer'],
    queryFn: () => api.get<{ data: DocumentosPorVencer }>('/dashboard/documentos-por-vencer'),
  })
}

export interface HistorialDia {
  fecha:      string
  vencidos:   number
  por_vencer: number
}

export function useRequerimientosHistorial(meses = 12) {
  return useQuery({
    queryKey: ['dashboard', 'requerimientos-historial', meses],
    queryFn: () => api.get<{ data: HistorialDia[] }>(`/dashboard/requerimientos-historial?meses=${meses}`),
  })
}

export interface MantenimientoCalendario {
  id:              number
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  tipo:            string | null
  tecnico:         string | null
  fecha:           string
  costo:           number
  piezas_total:    number
}

export function useMantenimientosCalendario() {
  return useQuery({
    queryKey: ['dashboard', 'mantenimientos-calendario'],
    queryFn: () => api.get<{ data: MantenimientoCalendario[] }>('/dashboard/mantenimientos-calendario'),
  })
}

export type PeriodoComparacion = 'mes' | 'semana'

export interface VehiculoReporte {
  id:                    number
  tipo:                  string
  marca:                 string
  modelo:                string
  serie:                 string
  placas:                string | null
  status:                string | null
  kilometraje:           number | null
  ubicacion:             string | null
  sucursal_id:           number | null
  sucursal:              string | null
  ruta_id:               number | null
  ruta:                  string | null
  mantenimientos_mes:    number
  costo_mano_obra_mes:   number
  costo_piezas_mes:      number
  ultimo_mantenimiento:  string | null
  vencidos:              number
  por_vencer:            number
}

export interface ReporteFlota {
  periodo:      PeriodoComparacion
  rango_costos: { start: string; end: string }
  costos: {
    mano_obra:           number
    piezas_usadas:       number
    piezas_compradas:    number
    total_mantenimiento: number
    total:               number
  }
  comparacion: {
    rango_actual:                          { start: string; end: string }
    rango_anterior:                        { start: string; end: string }
    vencidos_actual:                       number
    vencidos_anterior:                     number | null
  }
  vehiculos: VehiculoReporte[]
}

// Se pide bajo demanda (al exportar el PDF) en vez de precargarse con un hook,
// porque agrega la flota completa y solo hace falta en ese momento.
export function fetchReporteFlota(periodo: PeriodoComparacion) {
  return api.get<{ data: ReporteFlota }>(`/dashboard/reporte-flota?periodo=${periodo}`)
}
