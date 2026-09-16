// Catálogo e inventario de piezas (refacciones): búsqueda paginada por número
// de serie o descripción y CRUD. El stock (cantidad_total) es la suma de los
// lotes de compra de cada pieza (useLotes).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CamposArchivado } from './useArchivado'

/**
 * Lo que dice una refacción a la que nadie le ha capturado la marca. No es lo
 * mismo que una genérica que de verdad no trae marca: esa se escribe como tal.
 * Espeja el valor de la migración 036 y el del schema de la API.
 */
export const MARCA_FALTANTE = 'Marca Faltante'

export interface Pieza extends CamposArchivado {
  id: number
  numero_serie: string
  descripcion: string
  /** Nunca vacía. `MARCA_FALTANTE` mientras nadie la capture. */
  marca: string
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
  marca?:         string
  // No admite null: el tipo es obligatorio y no se puede quitar una vez puesto.
  tipo_pieza_id?: number
}

interface ListResponse {
  data: Pieza[]
  pagination: { page: number; pageSize: number; total: number }
}

export type SearchBy = 'all' | 'numero_serie' | 'descripcion' | 'tipo_pieza' | 'marca'

// Marcas ya capturadas, para ofrecerlas en el formulario. Sin el centinela: la
// lista existe para no escribir Bosch de cinco formas, no para dejar una
// refacción nueva sin marca con un clic.
export function useMarcasRefaccion() {
  return useQuery({
    queryKey: ['refacciones-marcas'],
    queryFn: () => api.get<{ data: string[] }>('/refacciones/marcas'),
  })
}

// `incluirArchivados` es para la pantalla del catálogo, que necesita verlas
// para poder restaurarlas. Los selectores usan la lista normal.
export function useRefacciones(
  page = 1, search = '', searchBy: SearchBy = 'all', pageSize?: number, enabled = true,
  incluirArchivados = false,
) {
  return useQuery({
    queryKey: ['refacciones', page, search, searchBy, pageSize, incluirArchivados],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page) })
      if (search) { qs.set('search', search); qs.set('searchBy', searchBy) }
      if (pageSize) qs.set('pageSize', String(pageSize))
      if (incluirArchivados) qs.set('archivados', '1')
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
    // `marca` va en los obligatorios y no en `PiezaBody`: la API la exige al
    // crear, y dejarla opcional aquí solo conseguía que el error saliera en
    // tiempo de ejecucion en vez de al compilar.
    mutationFn: (body: PiezaBody & {
      numero_serie: string; descripcion: string; marca: string; tipo_pieza_id: number
    }) =>
      api.post<{ data: Pieza }>('/refacciones', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['refacciones'] })
      qc.invalidateQueries({ queryKey: ['refacciones-marcas'] })
      qc.invalidateQueries({ queryKey: ['dashboard', 'pendientes-almacen'] })
    },
  })
}

export function useUpdateRefaccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: PiezaBody & { id: number }) =>
      api.put<{ data: Pieza }>(`/refacciones/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['refacciones'] })
      qc.invalidateQueries({ queryKey: ['refacciones-marcas'] })
      qc.invalidateQueries({ queryKey: ['dashboard', 'pendientes-almacen'] })
    },
  })
}

