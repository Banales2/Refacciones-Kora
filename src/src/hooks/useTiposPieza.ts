// Catálogo de tipos de pieza: lo que un modelo puede necesitar ("filtro de
// aire"), sin decir cuál pieza concreta. Cada refacción se marca con su tipo y
// cada vehículo elige, por tipo, la refacción que usa.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface TipoPieza {
  id:     number
  nombre: string
}

export function useTiposPieza() {
  return useQuery({
    queryKey: ['tipos-pieza'],
    queryFn: () => api.get<{ data: TipoPieza[] }>('/tipos-pieza'),
  })
}

export function useCreateTipoPieza() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nombre: string) => api.post<{ data: TipoPieza }>('/tipos-pieza', { nombre }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tipos-pieza'] }),
  })
}

export function useUpdateTipoPieza() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, nombre }: { id: number; nombre: string }) =>
      api.put<{ data: TipoPieza }>(`/tipos-pieza/${id}`, { nombre }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tipos-pieza'] }),
  })
}

export function useDeleteTipoPieza() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/tipos-pieza/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tipos-pieza'] }),
  })
}
