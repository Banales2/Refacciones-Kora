// Catálogo de técnicos (nombre, ubicación y contacto): quién realiza los
// mantenimientos. Por ahora es un catálogo suelto; el campo `tecnico` de los
// mantenimientos sigue siendo texto libre y no apunta aquí.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CamposArchivado } from './useArchivado'

export interface Tecnico extends CamposArchivado {
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

// Por defecto solo lo que está en uso. `incluirArchivados` es para la pantalla
// del catálogo, que necesita verlos para poder restaurarlos.
export function useTecnicos(incluirArchivados = false) {
  return useQuery({
    queryKey: ['tecnicos', incluirArchivados ? 'con-archivados' : 'en-uso'],
    queryFn: () => api.get<{ data: Tecnico[] }>(
      incluirArchivados ? '/tecnicos?archivados=1' : '/tecnicos'),
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

