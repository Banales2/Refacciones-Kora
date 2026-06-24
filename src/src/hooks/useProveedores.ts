import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Proveedor {
  id:       number
  nombre:   string
  contacto: string | null
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
