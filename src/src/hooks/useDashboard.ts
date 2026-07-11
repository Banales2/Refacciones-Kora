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
    count:        number
    costo_total:  number
    por_vehiculo: VehiculoConMantenimiento[]
  }
  piezas: {
    count:       number
    costo_total: number
    lotes:       LoteMes[]
  }
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
    requerimientos_unicos_nuevos_actual:   number
    requerimientos_unicos_nuevos_anterior: number
  }
  vehiculos: VehiculoReporte[]
}

// Se pide bajo demanda (al exportar el PDF) en vez de precargarse con un hook,
// porque agrega la flota completa y solo hace falta en ese momento.
export function fetchReporteFlota(periodo: PeriodoComparacion) {
  return api.get<{ data: ReporteFlota }>(`/dashboard/reporte-flota?periodo=${periodo}`)
}
