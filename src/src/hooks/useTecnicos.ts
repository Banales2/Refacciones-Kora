// Catálogo de técnicos (nombre, ubicación y contacto): quién realiza los
// mantenimientos. Por ahora es un catálogo suelto; el campo `tecnico` de los
// mantenimientos sigue siendo texto libre y no apunta aquí.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CamposArchivado } from './useArchivado'
import type { Factura } from './useFacturas'

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

/**
 * Las facturas de un taller.
 *
 * Entra un taller y salen sus facturas: el endpoint resuelve por dentro que un
 * taller factura como proveedor, para que esta pantalla no tenga que saberlo.
 * Un taller que nunca ha facturado devuelve una lista vacía, no un error.
 *
 * Salen las facturas COMPLETAS, no solo las de mano de obra. Si a ese mismo
 * taller se le compraron refacciones, esas facturas son suyas igual — y una
 * mixta es un solo papel que cobra las dos cosas.
 */
export function useFacturasDeTaller(tecnicoId: number | null, page = 1, pageSize = 10) {
  return useQuery({
    queryKey: ['tecnico-facturas', tecnicoId, page, pageSize],
    queryFn: () => api.get<{
      data: Factura[]
      pagination: { page: number; pageSize: number; total: number }
    }>(`/tecnicos/${tecnicoId}/facturas?page=${page}&pageSize=${pageSize}`),
    enabled: tecnicoId !== null,
  })
}

export interface MantenimientoDeTaller {
  id:            number
  vehiculo_id:   number
  fecha:         string | null
  tipo:          string | null
  km_actual:     number | null
  /** La mano de obra: lo que el taller cobró por el trabajo. */
  costo:         number
  observaciones: string | null
  vehiculo:      string
  /** Lo que el servicio consumió en refacciones del almacén. */
  piezas_total:  number
  /** El folio que cobra este trabajo. null = ninguna factura lo reclama. */
  factura_folio: string | null
  /** null = su mano de obra todavía no se ha cuadrado contra ningún papel. */
  revisado_en:   string | null
  revisado_por:  string | null
}

/**
 * Los mantenimientos que hizo un taller.
 *
 * El gemelo de `useFacturasDeTaller`: aquel enseña lo que el taller ha cobrado,
 * este lo que ha hecho. La pregunta interesante está en el cruce — un trabajo
 * sin folio que lo reclame es mano de obra que todavía no se ha facturado.
 */
export function useMantenimientosDeTaller(tecnicoId: number | null, page = 1, pageSize = 10) {
  return useQuery({
    queryKey: ['tecnico-mantenimientos', tecnicoId, page, pageSize],
    queryFn: () => api.get<{
      data: MantenimientoDeTaller[]
      costo_total: number
      pagination: { page: number; pageSize: number; total: number }
    }>(`/tecnicos/${tecnicoId}/mantenimientos?page=${page}&pageSize=${pageSize}`),
    enabled: tecnicoId !== null,
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

