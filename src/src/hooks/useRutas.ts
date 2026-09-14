// Catálogo de rutas de transporte; se asignan a tractocamiones y cajas de trailer.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CamposArchivado } from './useArchivado'

export interface Ruta extends CamposArchivado {
  id:        number
  nombre:    string
  ubicacion: string
}

export interface RutaPayload {
  nombre:    string
  ubicacion: string
}

// Por defecto solo lo que está en uso. `incluirArchivados` es para la pantalla
// del catálogo, que necesita verlos para poder restaurarlos.
export function useRutas(incluirArchivados = false) {
  return useQuery({
    queryKey: ['rutas', incluirArchivados ? 'con-archivados' : 'en-uso'],
    queryFn: () => api.get<{ data: Ruta[] }>(
      incluirArchivados ? '/rutas?archivados=1' : '/rutas'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useCreateRuta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: RutaPayload) =>
      api.post<{ data: Ruta }>('/rutas', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutas'] }),
  })
}

export function useUpdateRuta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<RutaPayload> }) =>
      api.put<{ data: Ruta }>(`/rutas/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutas'] }),
  })
}

