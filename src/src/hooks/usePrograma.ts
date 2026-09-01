// Programa de mantenimiento de un modelo: la tabla que publica el fabricante,
// con fases (columnas de kilometraje) y operaciones (renglones sobre piezas).
// Cada celda dice qué se le hace a esa pieza en ese servicio.
//
// Se lee y se invalida siempre completo: la cuadrícula que lo captura necesita
// las tres cosas a la vez, y casi todas las mutaciones (celdas, fases, orden)
// devuelven ya el programa entero.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface AccionPrograma {
  codigo:      string
  nombre:      string
  descripcion: string | null
  orden:       number
}

export interface FasePrograma {
  id:    number
  orden: number
  /** La marca de odómetro tal como la publica el fabricante. */
  km:    number
  /** Se hace una sola vez, en la primera pasada: el asentamiento. */
  unica: boolean
}

export interface OperacionPrograma {
  id:            number
  orden:         number
  nombre:        string
  descripcion:   string | null
  categoria:     string | null
  tipo_pieza_id: number | null
  /** El "o cada N meses" del renglón: vence solo, sin arrastrar la fase. */
  limite_meses:  number | null
  /** Qué se le hace en cada fase, por id de fase. Lo que no está, no se hace. */
  celdas:        Record<number, string>
}

export interface Programa {
  id:          number
  modelo_id:   number
  nombre:      string
  descripcion: string | null
  activo:      boolean
  created_at:  string
  updated_at:  string
  fases:       FasePrograma[]
  operaciones: OperacionPrograma[]
}

export interface ProgramaPayload {
  nombre:       string
  descripcion?: string | null
  activo?:      boolean
}

export interface OperacionPayload {
  nombre:         string
  descripcion?:   string | null
  categoria?:     string | null
  tipo_pieza_id?: number | null
  limite_meses?:  number | null
}

export interface FasePayload {
  km:    number
  unica: boolean
}

// ─── Lectura ────────────────────────────────────────────────────────────────

export function useProgramaModelo(modeloId: number) {
  return useQuery({
    // `data` viene en null mientras el modelo no tenga programa: no es un error,
    // es la pantalla ofreciendo crearlo.
    queryKey: ['programa', modeloId],
    queryFn: () => api.get<{ data: Programa | null }>(`/modelos/${modeloId}/programa`),
  })
}

// El catálogo de la leyenda (I, A, R, T, L). Es global y casi nunca cambia, así
// que se queda cacheado toda la sesión.
export function useAccionesPrograma() {
  return useQuery({
    queryKey: ['programa-acciones'],
    queryFn: () => api.get<{ data: AccionPrograma[] }>('/programa-acciones'),
    staleTime: Infinity,
  })
}

// ─── Mutaciones ─────────────────────────────────────────────────────────────

function invalidar(qc: ReturnType<typeof useQueryClient>, modeloId: number) {
  qc.invalidateQueries({ queryKey: ['programa', modeloId] })
}

// Las mutaciones sobre la cuadrícula devuelven ya el programa entero, así que
// se escribe la caché en vez de invalidarla: marcar una celda no tiene por qué
// costar un viaje de vuelta, y sin refetch la casilla no parpadea entre lo que
// se acaba de marcar y lo que contesta el servidor.
function guardar(qc: ReturnType<typeof useQueryClient>, modeloId: number, data: Programa) {
  qc.setQueryData(['programa', modeloId], { data })
}

export function useCreatePrograma(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ProgramaPayload) =>
      api.post<{ data: Programa }>(`/modelos/${modeloId}/programa`, payload),
    onSuccess: () => invalidar(qc, modeloId),
  })
}

export function useUpdatePrograma(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ProgramaPayload> }) =>
      api.put<{ data: Programa }>(`/programa/${id}`, payload),
    onSuccess: () => invalidar(qc, modeloId),
  })
}

export function useDeletePrograma(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/programa/${id}`),
    onSuccess: () => invalidar(qc, modeloId),
  })
}

// Las columnas van en bloque: agregar, quitar o reordenar una cambia el
// recorrido completo. La API empata por kilometraje, así que mover una de lugar
// no tira sus celdas.
export function useSetFases(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ programaId, fases }: { programaId: number; fases: FasePayload[] }) =>
      api.put<{ data: Programa }>(`/programa/${programaId}/fases`, { fases }),
    onSuccess: (r) => guardar(qc, modeloId, r.data),
  })
}

export function useCreateOperacion(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ programaId, payload }: { programaId: number; payload: OperacionPayload }) =>
      api.post<{ data: OperacionPrograma }>(`/programa/${programaId}/operaciones`, payload),
    onSuccess: () => invalidar(qc, modeloId),
  })
}

export function useUpdateOperacion(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<OperacionPayload> }) =>
      api.put<{ data: OperacionPrograma }>(`/programa-operaciones/${id}`, payload),
    onSuccess: () => invalidar(qc, modeloId),
  })
}

export function useDeleteOperacion(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/programa-operaciones/${id}`),
    onSuccess: () => invalidar(qc, modeloId),
  })
}

// Un renglón entero de la cuadrícula. Se manda completo porque así se edita:
// marcando y desmarcando celdas; lo que no viene queda en blanco.
export function useSetCeldas(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ operacionId, celdas }: {
      operacionId: number
      celdas: { fase_id: number; accion: string }[]
    }) => api.put<{ data: Programa }>(`/programa-operaciones/${operacionId}/celdas`, { celdas }),
    onSuccess: (r) => guardar(qc, modeloId, r.data),
  })
}

export function useReordenarOperaciones(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ programaId, ids }: { programaId: number; ids: number[] }) =>
      api.put<{ data: Programa }>(`/programa/${programaId}/operaciones/orden`, { ids }),
    onSuccess: (r) => guardar(qc, modeloId, r.data),
  })
}

// ─── Recorrido derivado ─────────────────────────────────────────────────────

export interface ServicioProgramado {
  indice: number
  /** Kilometraje de odómetro, contado desde el arranque del programa. */
  km:     number
  fase:   FasePrograma
}

// Los siguientes servicios del programa, en orden. Espeja proximosServicios de
// la API (api/src/services/programaService.ts), que es quien manda; aquí sirve
// para que la captura muestre a qué kilometraje va a caer cada columna sin
// tener que preguntar.
//
// Las fases marcadas como únicas solo existen en la primera pasada; agotadas,
// el recorrido se queda dando vueltas sobre el resto: en el ELF, después de los
// 105,000 el siguiente servicio es a los 120,000 con la columna de los 30,000.
export function proximosServicios(
  fases:           FasePrograma[],
  serviciosHechos: number,
  cuantos:         number = 1,
): ServicioProgramado[] {
  if (!fases.length || cuantos <= 0) return []
  const bucle = fases.filter((f) => !f.unica)
  if (!bucle.length) return []

  const salida: ServicioProgramado[] = []
  let km = 0
  for (let i = 0; salida.length < cuantos; i++) {
    const posicion = i < fases.length
      ? i
      : fases.length - bucle.length + ((i - fases.length) % bucle.length)
    km += posicion === 0 ? fases[0].km : fases[posicion].km - fases[posicion - 1].km
    if (i >= serviciosHechos) salida.push({ indice: i, km, fase: fases[posicion] })
    if (i > serviciosHechos + cuantos + fases.length * 2) break
  }
  return salida
}
