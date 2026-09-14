// Archivar y restaurar un renglón de catálogo (migración 033).
//
// Los ocho catálogos comparten endpoint, forma y clave de caché —el nombre del
// recurso es el mismo en la ruta y en la queryKey— así que en vez de repetir
// ocho pares de hooks idénticos hay uno solo parametrizado. Se usa
// `useArchivarCatalogo('sucursales')` y ya.
//
// ARCHIVAR NO ES BORRAR: el renglón se queda en la base y todo lo que lo
// referencia lo sigue mostrando; solo deja de ofrecerse en el catálogo y en los
// selectores del alta. Desde la aplicación ya no se borra nada.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export const CATALOGOS_ARCHIVABLES = [
  'sucursales', 'rutas', 'gasolineras', 'conductores',
  'tecnicos', 'proveedores', 'refacciones', 'tipos-pieza',
] as const

export type CatalogoArchivable = typeof CATALOGOS_ARCHIVABLES[number]

/** Campos que trae todo renglón archivable. */
export interface CamposArchivado {
  archivado_en:     string | null
  archivado_motivo: string | null
}

export function useArchivarCatalogo(recurso: CatalogoArchivable) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo?: string }) =>
      api.post<void>(`/${recurso}/${id}/archivado`, { motivo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [recurso] }),
  })
}

export function useRestaurarCatalogo(recurso: CatalogoArchivable) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/${recurso}/${id}/archivado`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [recurso] }),
  })
}
