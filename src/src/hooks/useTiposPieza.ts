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
  /**
   * Las piezas de este tipo se miden con profundímetro en el chequeo diario:
   * llantas, balatas. Ver la migración 052.
   */
  mide_desgaste: boolean
  /**
   * Los milímetros en los que la lectura ya cuenta como falla, y de ahí para
   * abajo. `null` = se mide pero sin mínimo: se guarda el dato y no se abre
   * ningún pendiente.
   */
  desgaste_minimo_mm: number | null
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
    // `mide_desgaste` y su mínimo viajan juntos: apagar la medición limpia el
    // umbral, y mandarlos por separado dejaría un número huérfano que nadie
    // compara contra nada.
    mutationFn: ({ id, ...campos }: {
      id: number
      nombre?: string
      rastreo_individual?: boolean
      mide_desgaste?: boolean
      desgaste_minimo_mm?: number | null
    }) => api.put<{ data: TipoPieza }>(`/tipos-pieza/${id}`, campos),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tipos-pieza'] }),
  })
}

