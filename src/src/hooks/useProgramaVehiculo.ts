// El programa de mantenimiento visto desde una unidad: en qué punto del
// recorrido va, qué le toca en la próxima visita al taller y qué renglones se
// le vencieron por su cuenta.
//
// El kilometraje es grupal —la visita cierra toda la columna de un golpe— y el
// tiempo es individual: cada renglón trae su "o cada N meses" y puede vencer
// mucho antes de que llegue el kilometraje de su columna.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FasePrograma, OperacionPrograma, Programa } from './usePrograma'

export interface VinculoPrograma {
  vehiculo_id:  number
  programa_id:  number
  /** Odómetro desde el que se cuenta el recorrido. Una unidad usada no arranca en cero. */
  km_inicio:    number
  fecha_inicio: string | null
}

export interface VisitaPrograma {
  id:               number
  vehiculo_id:      number
  fase_id:          number
  /** Posición en el recorrido desde el arranque: la columna sola no la identifica. */
  indice:           number
  fecha:            string
  km:               number | null
  mantenimiento_id: number | null
}

export interface OperacionDeFase {
  operacion: OperacionPrograma
  accion:    string
}

export interface ServicioPendiente {
  indice:       number
  fase:         FasePrograma
  km_recorrido: number
  km_odometro:  number
  intervalo:    number
  km_faltantes: number | null
  vencida:      boolean
  por_vencer:   boolean
  operaciones:  OperacionDeFase[]
}

export interface OperacionPorTiempo {
  operacion:    OperacionPrograma
  /** Nulo = nunca se ha atendido; se cuenta desde el arranque del programa. */
  ultima_fecha: string | null
  meses:        number | null
  vencida:      boolean
  por_vencer:   boolean
}

export interface EstadoProgramaVehiculo {
  vinculo:            VinculoPrograma
  programa:           Programa
  visitas:            VisitaPrograma[]
  estados:            { operacion_id: number; ultima_fecha: string; ultimo_km: number | null; visita_id: number | null }[]
  servicios_hechos:   number
  kilometraje:        number | null
  km_recorrido:       number | null
  proxima:            ServicioPendiente | null
  siguientes:         ServicioPendiente[]
  operaciones_tiempo: OperacionPorTiempo[]
}

export function useProgramaVehiculo(vehiculoId: number) {
  return useQuery({
    // `data` viene en null cuando la unidad no sigue ningún programa: no es un
    // error, es la ficha ofreciendo asignarlo.
    queryKey: ['programa-vehiculo', vehiculoId],
    queryFn: () => api.get<{ data: EstadoProgramaVehiculo | null }>(`/vehiculos/${vehiculoId}/programa`),
  })
}

// Cerrar una visita mueve el tablero (deja de estar vencida) y toca el
// mantenimiento con el que se pagó, así que se invalidan las tres cosas.
function invalidar(qc: ReturnType<typeof useQueryClient>, vehiculoId: number) {
  qc.invalidateQueries({ queryKey: ['programa-vehiculo', vehiculoId] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

function guardar(
  qc: ReturnType<typeof useQueryClient>, vehiculoId: number, data: EstadoProgramaVehiculo | null,
) {
  qc.setQueryData(['programa-vehiculo', vehiculoId], { data })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

export interface AsignarProgramaPayload {
  programa_id?:  number
  km_inicio?:    number | null
  fecha_inicio?: string | null
}

export function useAsignarPrograma(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: AsignarProgramaPayload) =>
      api.put<{ data: EstadoProgramaVehiculo }>(`/vehiculos/${vehiculoId}/programa`, payload),
    onSuccess: (r) => guardar(qc, vehiculoId, r.data),
  })
}

export function useQuitarPrograma(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(`/vehiculos/${vehiculoId}/programa`),
    onSuccess: () => invalidar(qc, vehiculoId),
  })
}

export interface VisitaPayload {
  fecha:             string
  km?:               number | null
  mantenimiento_id?: number | null
}

export function useRegistrarVisita(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: VisitaPayload) =>
      api.post<{ data: EstadoProgramaVehiculo }>(`/vehiculos/${vehiculoId}/programa/visitas`, payload),
    onSuccess: (r) => guardar(qc, vehiculoId, r.data),
  })
}

export function useDeshacerVisita(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (visitaId: number) =>
      api.delete<{ data: EstadoProgramaVehiculo }>(`/programa-visitas/${visitaId}`),
    onSuccess: (r) => guardar(qc, vehiculoId, r.data),
  })
}

// Atender un renglón solo: su límite de meses venció antes que el kilometraje
// de su columna. No cuenta como visita.
export function useAtenderOperacion(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ operacionId, fecha, km }: {
      operacionId: number; fecha: string; km?: number | null
    }) => api.post<{ data: EstadoProgramaVehiculo }>(
      `/vehiculos/${vehiculoId}/programa/operaciones/${operacionId}/atender`, { fecha, km }
    ),
    onSuccess: (r) => guardar(qc, vehiculoId, r.data),
  })
}
