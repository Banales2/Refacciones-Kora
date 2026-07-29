// Vales de gasolina: cada vale registra quién lo creó, el chofer al que se le
// entregó, el vehículo y la fecha. `creado_por` lo asigna la API a partir del
// usuario de la sesión, por eso no viaja en el payload.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface ValeGasolina {
  id:           number
  creado_por:   string
  conductor_id: number
  vehiculo_id:  number
  fecha:        string
  conductor:    string
  marca:        string
  modelo:       string
  serie:        string
  placas:       string | null
}

export interface ValeGasolinaPayload {
  conductor_id: number
  vehiculo_id:  number
  fecha:        string
}

export function useValesGasolina() {
  return useQuery({
    queryKey: ['vales-gasolina'],
    queryFn: () => api.get<{ data: ValeGasolina[] }>('/vales-gasolina'),
  })
}

export function useCreateValeGasolina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ValeGasolinaPayload) =>
      api.post<{ data: ValeGasolina }>('/vales-gasolina', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vales-gasolina'] }),
  })
}

export function useUpdateValeGasolina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ValeGasolinaPayload }) =>
      api.put<{ data: ValeGasolina }>(`/vales-gasolina/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vales-gasolina'] }),
  })
}

export function useDeleteValeGasolina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/vales-gasolina/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vales-gasolina'] }),
  })
}
