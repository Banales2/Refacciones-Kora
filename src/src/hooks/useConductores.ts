// Catálogo de conductores; se referencian desde las recargas de combustible
// de cada vehículo.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CamposArchivado } from './useArchivado'

export interface Conductor extends CamposArchivado {
  id:        number
  nombre:    string
  // Base desde donde opera. Etiqueta corta, no un domicilio.
  ubicacion: string | null
  // Licencia estatal: número y vigencia, ambos texto. Null mientras no se
  // capturen.
  licencia_estatal_numero:   string | null
  licencia_estatal_vigencia: string | null
  // Licencia federal: mismo par más el número de expediente.
  licencia_federal_numero:     string | null
  licencia_federal_expediente: string | null
  licencia_federal_vigencia:   string | null
  // El expediente se renueva aparte de la licencia que lo ampara, así que
  // lleva su propia vigencia.
  licencia_federal_expediente_vigencia: string | null
}

export interface ConductorPayload {
  nombre:                    string
  ubicacion:                 string | null
  licencia_estatal_numero:   string | null
  licencia_estatal_vigencia: string | null
  licencia_federal_numero:     string | null
  licencia_federal_expediente: string | null
  licencia_federal_vigencia:   string | null
  // El expediente se renueva aparte de la licencia que lo ampara, así que
  // lleva su propia vigencia.
  licencia_federal_expediente_vigencia: string | null
}

// Por defecto solo lo que está en uso. `incluirArchivados` es para la pantalla
// del catálogo, que necesita verlos para poder restaurarlos.
export function useConductores(incluirArchivados = false) {
  return useQuery({
    queryKey: ['conductores', incluirArchivados ? 'con-archivados' : 'en-uso'],
    queryFn: () => api.get<{ data: Conductor[] }>(
      incluirArchivados ? '/conductores?archivados=1' : '/conductores'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateConductor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ConductorPayload) =>
      api.post<{ data: Conductor }>('/conductores', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conductores'] }),
  })
}

export function useUpdateConductor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ConductorPayload }) =>
      api.put<{ data: Conductor }>(`/conductores/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conductores'] })
      // El nombre del conductor viene embebido en cada recarga.
      qc.invalidateQueries({ queryKey: ['recargas'] })
    },
  })
}

