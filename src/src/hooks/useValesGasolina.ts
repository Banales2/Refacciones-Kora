// Vales de gasolina: cada vale registra su folio impreso, quién lo creó, el
// chofer al que se le entregó, el vehículo y la fecha. `creado_por` es por omisión el usuario
// de la sesión; se puede elegir otra cuenta cuando se registra el vale que entregó otra persona.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/**
 * Qué le pasó al papel.
 *
 *   creado    se entregó y todavía no se gasta.
 *   usado     tiene una recarga colgando.
 *   perdido   lleva dos días sin usarse y nadie sabe de él.
 *   archivado alguien aceptó que no va a aparecer.
 *
 * Los tres primeros los calcula la API al leer; el último es el único que se
 * guarda, porque no es un hecho derivable sino la decisión de una persona.
 */
export type EstadoVale = 'creado' | 'usado' | 'perdido' | 'archivado'

export const ESTADO_VALE: Record<EstadoVale, { label: string; color: string }> = {
  creado:    { label: 'Sin usar',   color: 'blue'   },
  usado:     { label: 'Usado',      color: 'green'  },
  perdido:   { label: 'Perdido',    color: 'red'    },
  archivado: { label: 'Archivado',  color: 'gray'   },
}

export interface ValeGasolina {
  id:           number
  folio:        string
  creado_por:   string
  conductor_id: number
  vehiculo_id:  number
  /** Dónde se entregó. `null` en los vales de antes de registrarla: ANTIGUO. */
  sucursal_id:  number | null
  sucursal:     string | null
  fecha:        string
  conductor:    string
  marca:        string
  modelo:       string
  serie:        string
  placas:       string | null
  estado:       EstadoVale
  archivado_en:     string | null
  archivado_motivo: string | null
  /** La recarga que lo gastó. `null` mientras nadie lo use. */
  recarga_id:         number | null
  recarga_fecha:      string | null
  recarga_litros:     number | null
  recarga_gasolinera: string | null
  /** Días que lleva sin gastarse. `null` en cuanto se usó. */
  dias_sin_usar: number | null
}

export interface ValeGasolinaPayload {
  folio:        string
  conductor_id: number
  vehiculo_id:  number
  // Si quien captura está acotado a una sucursal, la API pone la suya e ignora
  // esta; si no, es obligatoria al crear.
  sucursal_id?: number
  fecha:        string
  /**
   * Solo al crear. El correo de la cuenta a cuyo nombre queda el vale; sin él,
   * el de la sesión. La API solo acepta las cuentas de `useCuentasVale`.
   */
  creado_por?:  string
}

/** Una cuenta a cuyo nombre se puede registrar un vale. */
export interface CuentaVale {
  email:  string
  nombre: string | null
}

export function useCuentasVale(enabled = true) {
  return useQuery({
    queryKey: ['vales-gasolina', 'cuentas'],
    queryFn: () => api.get<{ data: CuentaVale[] }>('/vales-gasolina/cuentas'),
    enabled,
    staleTime: 5 * 60_000,
  })
}

// Sin los archivados por omisión: un vale que se dio por perdido ya no es
// trabajo de nadie. El selector de la recarga usa esta misma consulta, así que
// de paso deja de ofrecer lo que la API rechazaría.
export function useValesGasolina(incluirArchivados = false) {
  return useQuery({
    queryKey: ['vales-gasolina', incluirArchivados ? 'con-archivados' : 'vigentes'],
    queryFn: () => api.get<{ data: ValeGasolina[] }>(
      `/vales-gasolina${incluirArchivados ? '?archivados=1' : ''}`),
  })
}

/**
 * Dar por perdido un vale, o deshacerlo si aparece.
 *
 * Archivar no borra: el folio se sigue resolviendo y la decisión queda firmada.
 * Lo que cambia es que sale de la lista de los que hay que perseguir y deja de
 * ofrecerse al capturar una recarga.
 */
export function useArchivarVale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, accion, motivo }: {
      id: number; accion: 'archivar' | 'restaurar'; motivo?: string
    }) => accion === 'archivar'
      ? api.post<void>(`/vales-gasolina/${id}/archivar`, motivo ? { motivo } : {})
      : api.accion<void>(`/vales-gasolina/${id}/restaurar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vales-gasolina'] }),
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

