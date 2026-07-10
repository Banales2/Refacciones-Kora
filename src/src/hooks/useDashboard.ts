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
