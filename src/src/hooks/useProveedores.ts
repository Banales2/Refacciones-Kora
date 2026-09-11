// Catálogo de proveedores de refacciones; se referencian desde los lotes de compra.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Proveedor {
  id:       number
  nombre:   string
  contacto: string | null
  // Número telefónico tal como se captura, con o sin separadores.
  telefono: string | null
}

export function useProveedores() {
  return useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<{ data: Proveedor[] }>('/proveedores'),
    staleTime: 5 * 60 * 1000,
  })
}

export interface ProveedorPayload {
  nombre:    string
  contacto?: string | null
  telefono?: string | null
}

export function useCreateProveedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ProveedorPayload) =>
      api.post<{ data: Proveedor }>('/proveedores', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proveedores'] }),
  })
}

export function useUpdateProveedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ProveedorPayload }) =>
      api.put<{ data: Proveedor }>(`/proveedores/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proveedores'] }),
  })
}

export function useDeleteProveedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/proveedores/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proveedores'] }),
  })
}

// Todo lo que se le ha comprado a un proveedor: los lotes que entraron con su
// nombre. Es el gasto real, distinto de los precios que pide (usePreciosProveedor),
// que existen aunque nunca se le haya comprado.
export interface GastoProveedor {
  lote_id:        number
  fecha_compra:   string
  pieza_id:       number
  pieza:          string
  pieza_serie:    string
  tipo_pieza:     string | null
  cantidad:       number
  costo_unitario: number
  /** Lo que costó la compra completa: cantidad por costo unitario. */
  total:          number
  num_factura:    string | null
  sucursal:       string | null
  comprado_por:   string
  /**
   * La factura se cargó de un histórico: la compra es real y el gasto cuenta,
   * pero las piezas ya se habían usado cuando entraron y su existencia nació en
   * cero. Ver `docs/importacion-historica.md`.
   */
  historica:      boolean
}

export function useGastosProveedor(proveedorId: number) {
  return useQuery({
    queryKey: ['proveedor-gastos', proveedorId],
    queryFn: () => api.get<{ data: GastoProveedor[] }>(`/proveedores/${proveedorId}/gastos`),
    enabled: proveedorId > 0,
  })
}
