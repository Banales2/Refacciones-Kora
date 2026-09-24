// Recargas de combustible de un vehículo: cada una registra la gasolinera,
// el conductor, la fecha, los litros cargados y lo que costó.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Recarga {
  id:            number
  vehiculo_id:   number
  gasolinera_id: number
  conductor_id:  number
  // Null solo en las recargas anteriores a que el vale fuera obligatorio.
  vale_id:       number | null
  fecha:         string
  litros:        number
  costo:         number
  kilometraje:   number | null
  gasolinera:    string
  ubicacion:     string
  conductor:     string
  // Folio impreso del vale. Null solo en las recargas que se quedaron sin vale.
  vale_folio:    string | null
  vale_fecha:    string | null
}

export interface RecargaPayload {
  gasolinera_id: number
  conductor_id:  number
  vale_id:       number
  fecha:         string
  litros:        number
  costo:         number
  kilometraje:   number
}

/** Renglón del listado de toda la flota: trae además el vehículo recargado. */
export interface RecargaConVehiculo extends Recarga {
  marca:  string
  modelo: string
  serie:  string
  placas: string | null
}

// Las recargas de todos los vehículos que alcanza a ver quien está conectado:
// al responsable la API le manda sólo las de su sucursal.
export function useRecargasTodas() {
  return useQuery({
    queryKey: ['recargas', 'todas'],
    queryFn: () => api.get<{ data: RecargaConVehiculo[] }>('/recargas'),
  })
}

export function useRecargas(vehiculoId: number) {
  return useQuery({
    queryKey: ['recargas', vehiculoId],
    queryFn: () => api.get<{ data: Recarga[] }>(`/vehiculos/${vehiculoId}/recargas`),
    enabled: vehiculoId > 0,
  })
}

// El vehículo viaja con cada alta y no al crear el hook: en la pestaña Recargas
// de Vales de gasolina se elige en el mismo formulario.
export function useCreateRecarga() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, payload }: { vehiculoId: number; payload: RecargaPayload }) =>
      api.post<{ data: Recarga }>(`/vehiculos/${vehiculoId}/recargas`, payload),
    onSuccess: () => {
      // Todas: la del vehículo y el listado de la flota.
      qc.invalidateQueries({ queryKey: ['recargas'] })
      // Registrar la recarga avanza el odómetro del vehículo (solo si el km
      // capturado es mayor al que ya tenía).
      qc.invalidateQueries({ queryKey: ['vehiculos'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateRecarga() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<RecargaPayload> }) =>
      api.put<{ data: Recarga }>(`/recargas/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recargas'] }),
  })
}

