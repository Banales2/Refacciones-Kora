// Mantenimientos realizados a un vehículo: fecha, técnico, costo de mano de
// obra, kilometraje y los requerimientos que satisface. El costo de piezas
// (piezas_total) viene del detalle asociado (useDetalleMtto).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Mantenimiento {
  id:               number
  vehiculo_id:      number
  fecha:            string | null
  tipo:             string | null
  tecnico_id:       number | null
  // Nombre del catálogo; null si el técnico fue eliminado.
  tecnico:          string | null
  costo:            number
  km_actual:        number
  observaciones:    string | null
  pendiente_ids: number[]
  piezas_total:     number
  /**
   * La marca de la columna del programa que este mantenimiento cerró: lo que la
   * ficha de la unidad llama "la visita de los 45,000 km". Null = no cerró
   * ninguna, que es lo normal. Borrar el mantenimiento deshace ese avance.
   */
  servicio_programa_km: number | null
  /**
   * Por qué entró la unidad al taller. Varias a la vez: la visita de un
   * servicio del programa entra por PREVENCIÓN y de paso se le atiende la fuga
   * que traía. Es distinto de `tipo`, que clasifica el gasto.
   *
   * Hoy puede venir vacío; va a ser obligatorio.
   */
  razones:          string[]
}

/** Va siempre en el selector, aunque nadie la haya escrito todavía. */
export const RAZON_PREVENCION = 'PREVENCIÓN'

export interface MantenimientoPayload {
  fecha:              string
  tipo?:              string | null
  tecnico_id?:        number | null
  costo?:             number
  km_actual?:         number
  observaciones?:     string | null
  pendiente_ids:  number[]
  razones:            string[]
}

/** Mantenimiento con su unidad resuelta: el historial de toda la flota. */
export interface MantenimientoDeFlota extends Mantenimiento {
  vehiculo_serie:  string
  vehiculo_placas: string | null
  vehiculo_tipo:   string
}

export function useMantenimientos(vehiculoId: number) {
  return useQuery({
    queryKey: ['mantenimientos', vehiculoId],
    queryFn: () => api.get<{ data: Mantenimiento[] }>(`/vehiculos/${vehiculoId}/mantenimientos`),
    enabled: vehiculoId > 0,
  })
}

// Historial completo, sin pasar por el detalle de cada vehículo. Comparte el
// prefijo 'mantenimientos' a propósito: cualquier alta o baja lo invalida.
export function useTodosLosMantenimientos() {
  return useQuery({
    queryKey: ['mantenimientos', 'todos'],
    queryFn: () => api.get<{ data: MantenimientoDeFlota[] }>('/mantenimientos'),
  })
}

// Borrar un mantenimiento devuelve al inventario las refacciones que consumió y
// reabre los pendientes que cerraba: casi todo el caché queda obsoleto.
function invalidarTrasBorrado(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['mantenimientos'] })
  qc.invalidateQueries({ queryKey: ['incidencias'] })
  qc.invalidateQueries({ queryKey: ['pendientes'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
  qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
  qc.invalidateQueries({ queryKey: ['lotes'] })
  qc.invalidateQueries({ queryKey: ['refacciones'] })
  // Si era el único que usaba una razón, esa razón deja de sugerirse.
  qc.invalidateQueries({ queryKey: ['mantenimientos-razones'] })
}

export function useDeleteMantenimiento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/mantenimientos/${id}`),
    onSuccess: () => invalidarTrasBorrado(qc),
  })
}

export function useCreateMantenimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: MantenimientoPayload) =>
      api.post<{ data: Mantenimiento }>(`/vehiculos/${vehiculoId}/mantenimientos`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mantenimientos'] })
      qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] })
      // Una razón escrita por primera vez tiene que salir en el siguiente
      // formulario: el catálogo se arma con lo que se captura.
      qc.invalidateQueries({ queryKey: ['mantenimientos-razones'] })
      // El mantenimiento cierra las incidencias que atendió, así que sus listas
      // (la del vehículo, la de la flota y la de pendientes) quedan obsoletas.
      qc.invalidateQueries({ queryKey: ['incidencias'] })
      qc.invalidateQueries({ queryKey: ['pendientes', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      // Registrar el mantenimiento avanza el odómetro del vehículo.
      qc.invalidateQueries({ queryKey: ['vehiculos'] })
    },
  })
}

export function useUpdateMantenimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<MantenimientoPayload> }) =>
      api.put<{ data: Mantenimiento }>(`/mantenimientos/${id}`, payload),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['mantenimientos'] })
      qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['mantenimientos-razones'] })
      // Cambiar qué atiende (o mover su fecha) abre o cierra incidencias.
      qc.invalidateQueries({ queryKey: ['incidencias'] })
      qc.invalidateQueries({ queryKey: ['pendientes', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      // El drawer de detalle trae su propia copia del mantenimiento (técnico,
      // fecha, costo…); sin esto seguiría mostrando la versión anterior.
      qc.invalidateQueries({ queryKey: ['detalle-mtto', id] })
    },
  })
}


// Razones ya escritas en la flota, para sugerirlas en el formulario. No hay
// catálogo: el vocabulario se arma con lo que se captura, igual que las
// categorías y el "reportado por".
export function useRazonesMantenimiento() {
  return useQuery({
    queryKey: ['mantenimientos-razones'],
    queryFn: () => api.get<{ data: string[] }>('/mantenimientos/razones'),
  })
}
