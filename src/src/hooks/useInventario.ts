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
  proveedor:      string
  num_factura:    string | null
  costo_unitario: number
  fecha_compra:   string
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
  usuario_email:       string | null
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
  observaciones?:      string | null
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
      qc.invalidateQueries({ queryKey: ['inventario-minimos'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      qc.invalidateQueries({ queryKey: ['lotes'] })
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
    mutationFn: (id: number) => api.delete<void>(`/inventario/minimos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventario-minimos'] }),
  })
}
