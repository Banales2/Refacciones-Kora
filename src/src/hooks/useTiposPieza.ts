// Catálogo de tipos de pieza: lo que un modelo puede necesitar ("filtro de
// aire"), sin decir cuál pieza concreta. Cada refacción se marca con su tipo y
// cada vehículo elige, por tipo, la refacción que usa.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CamposArchivado } from './useArchivado'

export interface TipoPieza extends CamposArchivado {
  id:     number
  nombre: string
  /**
   * Las piezas de este tipo se identifican una por una —cada llanta con su
   * historia— en vez de contarse a granel. Decide cómo se lleva su existencia.
   * Ver `docs/piezas-identificadas.md`.
   */
  rastreo_individual: boolean
}

// Por defecto solo lo que está en uso. `incluirArchivados` es para la pantalla
// del catálogo, que necesita verlos para poder restaurarlos.
export function useTiposPieza(incluirArchivados = false) {
  return useQuery({
    queryKey: ['tipos-pieza', incluirArchivados ? 'con-archivados' : 'en-uso'],
    queryFn: () => api.get<{ data: TipoPieza[] }>(
      incluirArchivados ? '/tipos-pieza?archivados=1' : '/tipos-pieza'),
  })
}

export function useCreateTipoPieza() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nombre: string) => api.post<{ data: TipoPieza }>('/tipos-pieza', { nombre }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tipos-pieza'] }),
  })
}

/**
 * Corrige un tipo. Nombre e interruptor viajan por separado y solo cuando
 * cambian: renombrar desde el catálogo no debe apagarle el rastreo sin querer,
 * ni al revés.
 */
export function useUpdateTipoPieza() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...campos }: {
      id: number; nombre?: string; rastreo_individual?: boolean
    }) => api.put<{ data: TipoPieza }>(`/tipos-pieza/${id}`, campos),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tipos-pieza'] }),
  })
}

