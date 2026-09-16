// Inventario por sucursal: qué hay en cada una, los traspasos entre ellas y los
// mínimos que cada una debe mantener.
//
// La existencia se guarda por (lote, sucursal). Que la llave incluya el lote es
// lo que permite saber de qué compra salió cada pieza de una sucursal
// —proveedor, factura, costo— sin llegar todavía a identificarlas una por una.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface ExistenciaEnSucursal {
  lote_id:        number
  sucursal_id:    number
  sucursal:       string
  cantidad:       number
  pieza_id:       number
  numero_serie:   string
  descripcion:    string
  tipo_pieza_id:  number | null
  tipo_pieza:     string | null
  /** `null` en el lote de recuperación: la pieza no salió de una compra. */
  proveedor:      string | null
  num_factura:    string | null
  costo_unitario: number
  fecha_compra:   string
  /**
   * Piezas de este lote que salieron de esta sucursal en un traspaso que nadie
   * ha aceptado. No están contadas en `cantidad`: ya no están en el estante.
   */
  en_camino:      number
}

export type EstadoTraspaso = 'pendiente' | 'aceptado' | 'rechazado' | 'cancelado'

export const ESTADO_TRASPASO: Record<EstadoTraspaso, { label: string; color: string }> = {
  pendiente: { label: 'Por aceptar', color: 'yellow' },
  aceptado:  { label: 'Aceptado',    color: 'green'  },
  rechazado: { label: 'Rechazado',   color: 'red'    },
  cancelado: { label: 'Cancelado',   color: 'gray'   },
}

export interface Traspaso {
  id:                  number
  lote_id:             number
  origen_sucursal_id:  number
  origen:              string
  destino_sucursal_id: number
  destino:             string
  cantidad:            number
  fecha:               string
  // Quién lo capturó (la cuenta de la sesión) y quién lo autorizó. El segundo es
  // NULL solo en los traspasos anteriores a que se empezara a pedir.
  usuario_email:       string | null
  autorizado_por:      string | null
  /**
   * Mientras siga 'pendiente', la mercancía va en camino: ya salió del estante
   * de origen y no ha entrado al de destino, así que no aparece en el
   * inventario de ninguna de las dos sucursales.
   */
  estado:              EstadoTraspaso
  resuelto_por:        string | null
  resuelto_en:         string | null
  motivo_resolucion:   string | null
  observaciones:       string | null
  pieza_id:            number
  numero_serie:        string
  descripcion:         string
}

export interface MinimoSucursal {
  id:            number
  sucursal_id:   number
  sucursal:      string
  pieza_id:      number
  numero_serie:  string
  descripcion:   string
  tipo_pieza:    string | null
  minimo:        number
  observaciones: string | null
  /** Lo que hay hoy de esa refacción en esa sucursal. */
  existencia:    number
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function useExistencias(sucursalId?: number) {
  return useQuery({
    queryKey: ['inventario-existencias', sucursalId],
    queryFn: () =>
      api.get<{ data: ExistenciaEnSucursal[] }>(`/inventario/existencias${qs({ sucursal: sucursalId })}`),
  })
}

export function useTraspasos(sucursalId?: number) {
  return useQuery({
    queryKey: ['inventario-traspasos', sucursalId],
    queryFn: () => api.get<{ data: Traspaso[] }>(`/inventario/traspasos${qs({ sucursal: sucursalId })}`),
  })
}

export interface TraspasoPayload {
  lote_id:             number
  origen_sucursal_id:  number
  destino_sucursal_id: number
  cantidad:            number
  fecha:               string
  autorizado_por:      string
  observaciones?:      string | null
}

// Nombres ya usados al autorizar, para ofrecerlos en el formulario.
export function useTraspasoAutorizadores() {
  return useQuery({
    queryKey: ['inventario-traspaso-autorizadores'],
    queryFn: () => api.get<{ data: string[] }>('/inventario/traspasos/autorizadores'),
  })
}

export function useCreateTraspaso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: TraspasoPayload) =>
      api.post<{ data: Traspaso }>('/inventario/traspasos', payload),
    onSuccess: () => {
      // Un traspaso mueve existencias, así que toca todo lo que las lee: el
      // inventario, los mínimos (que se comparan contra ellas) y el selector de
      // lotes del mantenimiento.
      qc.invalidateQueries({ queryKey: ['inventario-existencias'] })
      qc.invalidateQueries({ queryKey: ['inventario-traspasos'] })
      qc.invalidateQueries({ queryKey: ['inventario-traspaso-autorizadores'] })
      qc.invalidateQueries({ queryKey: ['unidades-pieza'] })
      qc.invalidateQueries({ queryKey: ['inventario-minimos'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['dashboard', 'pendientes-almacen'] })
    },
  })
}

// Aceptar, rechazar o cancelar un traspaso pendiente. Las tres mueven
// existencias —al destino o de vuelta al origen—, así que invalidan lo mismo
// que el alta.
export function useResolverTraspaso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, accion, motivo }: {
      id: number
      accion: 'aceptar' | 'rechazar' | 'cancelar'
      motivo?: string | null
    }) =>
      api.post<{ data: Traspaso }>(`/inventario/traspasos/${id}/${accion}`,
        motivo ? { motivo } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventario-existencias'] })
      qc.invalidateQueries({ queryKey: ['inventario-traspasos'] })
      qc.invalidateQueries({ queryKey: ['inventario-minimos'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['dashboard', 'pendientes-almacen'] })
      // Las piezas identificadas cambian de estante al aceptar, y dejan de
      // estar «en traspaso» en los tres desenlaces.
      qc.invalidateQueries({ queryKey: ['unidades-pieza'] })
      qc.invalidateQueries({ queryKey: ['unidades-cuadre'] })
    },
  })
}

export function useMinimos(sucursalId?: number, soloFaltantes = false) {
  return useQuery({
    queryKey: ['inventario-minimos', sucursalId, soloFaltantes],
    queryFn: () =>
      api.get<{ data: MinimoSucursal[] }>(
        `/inventario/minimos${qs({ sucursal: sucursalId, faltantes: soloFaltantes ? 1 : undefined })}`
      ),
  })
}

export interface MinimoPayload {
  sucursal_id:    number
  pieza_id:       number
  minimo:         number
  observaciones?: string | null
}

export function useCreateMinimo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: MinimoPayload) => api.post<{ data: MinimoSucursal }>('/inventario/minimos', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventario-minimos'] }),
  })
}

export function useUpdateMinimo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number; minimo?: number; observaciones?: string | null }) =>
      api.put<{ data: MinimoSucursal }>(`/inventario/minimos/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventario-minimos'] }),
  })
}

export function useDeleteMinimo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.accion<void>(`/inventario/minimos/${id}/quitar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventario-minimos'] }),
  })
}
