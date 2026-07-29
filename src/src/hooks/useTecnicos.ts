// Catálogo de técnicos (nombre, ubicación y contacto): quién realiza los
// mantenimientos. Por ahora es un catálogo suelto; el campo `tecnico` de los
// mantenimientos sigue siendo texto libre y no apunta aquí.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Tecnico {
  id:        number
  nombre:    string
  ubicacion: string
  contacto:  string | null
}

export interface TecnicoPayload {
  nombre:    string
  ubicacion: string
  contacto:  string | null
}

export function useTecnicos() {
  return useQuery({
    queryKey: ['tecnicos'],
    queryFn: () => api.get<{ data: Tecnico[] }>('/tecnicos'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateTecnico() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: TecnicoPayload) =>
      api.post<{ data: Tecnico }>('/tecnicos', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tecnicos'] }),
  })
}

export function useUpdateTecnico() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: TecnicoPayload }) =>
      api.put<{ data: Tecnico }>(`/tecnicos/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tecnicos'] }),
  })
}

export function useDeleteTecnico() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/tecnicos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tecnicos'] }),
  })
}
