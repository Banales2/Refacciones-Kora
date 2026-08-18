// Precios de refacciones cotizados con un proveedor.
//
// A diferencia de los lotes (lo que ya se compró), esto es lo que un proveedor
// pide por una refacción, se le compre o no: es la libreta con la que se
// comparan precios antes de decidir dónde comprar. Cada registro es una
// cotización con su fecha, así que la lista es histórica; el más reciente de
// cada refacción es el que vale hoy (`vigente`).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface PrecioProveedor {
  id:             number
  proveedor_id:   number
  pieza_id:       number
  precio:         number
  fecha:          string
  observaciones:  string | null
  registrado_por: string
  pieza_serie:    string
  pieza:          string
  tipo_pieza:     string | null
  /** El precio más reciente que este proveedor tiene para esta refacción. */
  vigente:        boolean
  /** El más barato entre los precios vigentes de todos los proveedores. */
  mejor_precio:       number | null
  mejor_proveedor_id: number | null
  mejor_proveedor:    string | null
  /** Cuántos proveedores tienen precio registrado para esta refacción. */
  proveedores_con_precio: number
}

export interface PrecioProveedorPayload {
  pieza_id:       number
  precio:         number
  fecha:          string
  observaciones?: string | null
}

// La refacción no se cambia al editar: eso sería otro registro.
export type PrecioProveedorUpdatePayload = Omit<PrecioProveedorPayload, 'pieza_id'>

export function usePreciosProveedor(proveedorId: number | null) {
  return useQuery({
    queryKey: ['precios-proveedor', proveedorId],
    queryFn: () => api.get<{ data: PrecioProveedor[] }>(`/proveedores/${proveedorId}/precios`),
    enabled: proveedorId != null,
  })
}

// Un precio nuevo cambia la comparativa de esa refacción, que se ve también
// desde la página de los demás proveedores: se invalida la clave completa.
function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['precios-proveedor'] })
}

export function useCreatePrecioProveedor(proveedorId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PrecioProveedorPayload) =>
      api.post<{ data: PrecioProveedor }>(`/proveedores/${proveedorId}/precios`, payload),
    onSuccess: () => invalidar(qc),
  })
}

export function useUpdatePrecioProveedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: PrecioProveedorUpdatePayload }) =>
      api.put<{ data: PrecioProveedor }>(`/precios-proveedor/${id}`, payload),
    onSuccess: () => invalidar(qc),
  })
}

export function useDeletePrecioProveedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/precios-proveedor/${id}`),
    onSuccess: () => invalidar(qc),
  })
}
