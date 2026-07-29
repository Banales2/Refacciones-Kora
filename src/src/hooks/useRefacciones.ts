// Catálogo e inventario de piezas (refacciones): búsqueda paginada por número
// de serie o descripción y CRUD. El stock (cantidad_total) es la suma de los
// lotes de compra de cada pieza (useLotes).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Pieza {
  id: number
  numero_serie: string
  descripcion: string
  // Única clasificación de la pieza: qué tipo cubre ("filtro de aire").
  // Obligatorio al crear; null solo en las piezas anteriores al catálogo de
  // tipos. Solo las tipificadas pueden asignarse a un vehículo
  // (usePiezasVehiculo).
  tipo_pieza_id: number | null
  tipo_pieza: string | null
  cantidad_total: number
}

type PiezaBody = {
  numero_serie?:  string
  descripcion?:   string
  // No admite null: el tipo es obligatorio y no se puede quitar una vez puesto.
  tipo_pieza_id?: number
}

interface ListResponse {
  data: Pieza[]
  pagination: { page: number; pageSize: number; total: number }
}

export type SearchBy = 'all' | 'numero_serie' | 'descripcion'

export function useRefacciones(
  page = 1, search = '', searchBy: SearchBy = 'all', pageSize?: number, enabled = true
) {
  return useQuery({
    queryKey: ['refacciones', page, search, searchBy, pageSize],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page) })
      if (search) { qs.set('search', search); qs.set('searchBy', searchBy) }
      if (pageSize) qs.set('pageSize', String(pageSize))
      return api.get<ListResponse>(`/refacciones?${qs}`)
    },
    enabled,
  })
}

// Tope de la API por petición (RefaccionQuerySchema.pageSize).
const MAX_PAGE_SIZE = 100

// Catálogo completo, sin importar la búsqueda o página activa en pantalla. Como
// la API no entrega más de 100 por petición, se recorren las páginas hasta
// juntar el total: pedir solo la primera dejaba fuera las piezas del 101 en
// adelante en los selectores y en el PDF.
export async function fetchTodasLasPiezas(): Promise<ListResponse> {
  const primera = await api.get<ListResponse>(`/refacciones?page=1&pageSize=${MAX_PAGE_SIZE}`)
  const total = primera.pagination.total
  const paginas = Math.ceil(total / MAX_PAGE_SIZE)

  const data = [...primera.data]
  for (let page = 2; page <= paginas; page++) {
    const siguiente = await api.get<ListResponse>(`/refacciones?page=${page}&pageSize=${MAX_PAGE_SIZE}`)
    data.push(...siguiente.data)
  }

  return { data, pagination: { page: 1, pageSize: data.length, total } }
}

// Misma carga completa, pero cacheada por react-query para las pantallas que
// necesitan el catálogo entero (selectores de pieza por tipo).
export function useTodasLasPiezas(enabled = true) {
  return useQuery({
    queryKey: ['refacciones', 'todas'],
    queryFn: fetchTodasLasPiezas,
    enabled,
  })
}

export function useCreateRefaccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PiezaBody & { numero_serie: string; descripcion: string; tipo_pieza_id: number }) =>
      api.post<{ data: Pieza }>('/refacciones', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['refacciones'] }),
  })
}

export function useUpdateRefaccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: PiezaBody & { id: number }) =>
      api.put<{ data: Pieza }>(`/refacciones/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['refacciones'] }),
  })
}

export function useDeleteRefaccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/refacciones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['refacciones'] }),
  })
}
