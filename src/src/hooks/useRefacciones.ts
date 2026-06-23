import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

interface Refaccion {
  Id: number
  Codigo: string
  Descripcion: string
  Precio: number
  Stock: number
}

interface ListResponse {
  data: Refaccion[]
  pagination: { page: number; pageSize: number; total: number }
}

export function useRefacciones(page = 1, search = '') {
  return useQuery({
    queryKey: ['refacciones', page, search],
    queryFn: () =>
      api.get<ListResponse>(
        `/refacciones?page=${page}${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
  })
}

export function useCreateRefaccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<Refaccion, 'Id'>) =>
      api.post<{ data: Refaccion }>('/refacciones', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['refacciones'] })
    },
  })
}