// Solicitudes de refacción: el canal del patio hacia oficina.
//
// Quien está a cargo de una sucursal pide lo que le falta y alguien de oficina
// lo aprueba o lo niega. Aprobar NO la cierra: la pieza todavía no está en el
// patio, y ese hueco —entre el sí y el "aquí está"— es donde se pierden las
// cosas. Se cierra al surtirla.
//
// El responsable ve las de su sucursal, que es lo que le permite no volver a
// pedir lo que su compañero ya pidió.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type EstadoSolicitud = 'pendiente' | 'aprobada' | 'rechazada' | 'surtida'

export interface RenglonSolicitud {
  pieza_id:     number
  numero_serie: string
  descripcion:  string
  tipo_pieza:   string | null
  cantidad:     number
  /** Lo que hay de esa refacción en la sucursal que la pide. */
  existencia:   number
}

export interface Solicitud {
  id:             number
  sucursal_id:    number
  sucursal:       string
  motivo:         string
  estado:         EstadoSolicitud
  solicitado_por: string
  fecha:          string
  resuelto_por:    string | null
  resuelto_en:     string | null
  resolucion_nota: string | null
  surtido_por:    string | null
  surtida_en:     string | null
  created_at:     string
  renglones:      RenglonSolicitud[]
}

export const ESTADO_SOLICITUD: Record<EstadoSolicitud, { label: string; color: string }> = {
  pendiente: { label: 'Esperando respuesta', color: 'orange' },
  aprobada:  { label: 'Aprobada, sin surtir', color: 'blue'   },
  surtida:   { label: 'Surtida',              color: 'green'  },
  rechazada: { label: 'Rechazada',            color: 'red'    },
}

export function useSolicitudes(estado?: EstadoSolicitud) {
  return useQuery({
    queryKey: ['solicitudes', estado ?? 'todas'],
    queryFn: () => api.get<{ data: Solicitud[] }>(
      `/solicitudes-refaccion${estado ? `?estado=${estado}` : ''}`),
  })
}

export interface SolicitudPayload {
  /** Solo quien no está acotado a una sucursal la manda: al resto se la pone la API. */
  sucursal_id?: number
  motivo:       string
  renglones:    { pieza_id: number; cantidad: number }[]
}

// Las tres mutaciones invalidan también el tablero: el contador de solicitudes
// sin contestar vive ahí, y es lo que hace las veces de notificación.
function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['solicitudes'] })
  qc.invalidateQueries({ queryKey: ['dashboard', 'pendientes-almacen'] })
}

export function useCreateSolicitud() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SolicitudPayload) =>
      api.post<{ data: Solicitud }>('/solicitudes-refaccion', payload),
    onSuccess: () => invalidar(qc),
  })
}

export function useResolverSolicitud() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, estado, nota }: {
      id: number; estado: 'aprobada' | 'rechazada'; nota?: string | null
    }) => api.post<{ data: Solicitud }>(`/solicitudes-refaccion/${id}/resolver`, { estado, nota }),
    onSuccess: () => invalidar(qc),
  })
}

export function useSurtirSolicitud() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.accion<{ data: Solicitud }>(`/solicitudes-refaccion/${id}/surtir`),
    onSuccess: () => invalidar(qc),
  })
}
