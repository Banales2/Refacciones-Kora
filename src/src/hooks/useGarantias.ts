// Garantías: el catálogo de lo que trae un modelo y la garantía real de cada
// unidad, con su vigencia ya calculada por la API.
//
// Importan por lo que arrastran: un requerimiento preventivo puede existir solo
// para no perder una garantía, y cuando esa garantía caduca el servicio deja de
// pedirse. Por eso tocar una garantía invalida también los requerimientos, los
// pendientes y el tablero.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type TriggerMode = 'km' | 'meses' | 'ambos'

// Con 'ambos' la garantía se acaba con lo que ocurra primero ("3 años o 100,000
// km"). Es la lectura contraria a la de un requerimiento, donde 'ambos' es el
// intervalo que se cumple más seguido.
export const TRIGGER_GARANTIA: Record<TriggerMode, string> = {
  km:    'Por kilometraje',
  meses: 'Por tiempo',
  ambos: 'Por tiempo o kilometraje (lo que pase primero)',
}

export interface GarantiaModelo {
  id:             number
  modelo_id:      number
  nombre:         string
  descripcion:    string | null
  trigger_mode:   TriggerMode
  duracion_meses: number | null
  limite_km:      number | null
  activo:         boolean
  created_at:     string
  updated_at:     string
}

export interface GarantiaModeloPayload {
  nombre:          string
  descripcion?:    string | null
  trigger_mode:    TriggerMode
  duracion_meses?: number | null
  limite_km?:      number | null
  activo?:         boolean
}

/** Lo que la API calcula: no se guarda en la base, se deriva de la fecha y el odómetro. */
export interface EstadoGarantia {
  vigente:         boolean
  motivo:          'cancelada' | 'tiempo' | 'kilometraje' | null
  vence_el:        string | null
  vence_a_los_km:  number | null
  meses_restantes: number | null
  km_restantes:    number | null
  /** Qué le falta al registro para poder calcularse; con datos incompletos se trata como vigente. */
  faltan_datos:    string[]
}

export interface GarantiaVehiculo {
  id:                 number
  vehiculo_id:        number
  /** De qué garantía del modelo salió. Null = capturada a mano en esta unidad. */
  garantia_origen_id: number | null
  nombre:             string
  descripcion:        string | null
  trigger_mode:       TriggerMode
  duracion_meses:     number | null
  limite_km:          number | null
  fecha_inicio:       string | null
  km_inicio:          number | null
  folio:              string | null
  observaciones:      string | null
  cancelada_en:       string | null
  motivo_cancelacion: string | null
  created_at:         string
  updated_at:         string
  kilometraje:        number | null
  /** Cuántos requerimientos preventivos dependen de ella. */
  requerimientos:     number
  estado:             EstadoGarantia
}

export interface GarantiaVehiculoPayload {
  nombre:              string
  descripcion?:        string | null
  trigger_mode:        TriggerMode
  duracion_meses?:     number | null
  limite_km?:          number | null
  fecha_inicio?:       string | null
  km_inicio?:          number | null
  folio?:              string | null
  observaciones?:      string | null
  cancelada_en?:       string | null
  motivo_cancelacion?: string | null
}

// ─── Catálogo del modelo ────────────────────────────────────────────────────

export function useGarantiasModelo(modeloId: number) {
  return useQuery({
    queryKey: ['garantias-modelo', modeloId],
    queryFn: () => api.get<{ data: GarantiaModelo[] }>(`/modelos/${modeloId}/garantias`),
  })
}

// Tocar el catálogo no se queda en el modelo: la API copia o sincroniza la
// garantía en todas sus unidades, y eso puede silenciar o revivir sus
// requerimientos. Se invalidan las claves completas, sin id, para que caigan las
// de todos los vehículos.
function invalidarModelo(qc: ReturnType<typeof useQueryClient>, modeloId: number) {
  qc.invalidateQueries({ queryKey: ['garantias-modelo', modeloId] })
  qc.invalidateQueries({ queryKey: ['garantias-vehiculo'] })
  qc.invalidateQueries({ queryKey: ['plantilla', modeloId] })
  qc.invalidateQueries({ queryKey: ['requerimientos'] })
  qc.invalidateQueries({ queryKey: ['pendientes'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

export function useCreateGarantiaModelo(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GarantiaModeloPayload) =>
      api.post<{ data: GarantiaModelo }>(`/modelos/${modeloId}/garantias`, payload),
    onSuccess: () => invalidarModelo(qc, modeloId),
  })
}

export function useUpdateGarantiaModelo(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<GarantiaModeloPayload> }) =>
      api.put<{ data: GarantiaModelo }>(`/garantias-modelo/${id}`, payload),
    onSuccess: () => invalidarModelo(qc, modeloId),
  })
}

export function useDeleteGarantiaModelo(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/garantias-modelo/${id}`),
    onSuccess: () => invalidarModelo(qc, modeloId),
  })
}

// ─── Garantías de una unidad ────────────────────────────────────────────────

// `vehiculoId` puede llegar en 0 desde un formulario que todavía no sabe de qué
// unidad habla (el alta de un requerimiento suelto): ahí no se pide nada.
export function useGarantiasVehiculo(vehiculoId: number) {
  return useQuery({
    queryKey: ['garantias-vehiculo', vehiculoId],
    queryFn: () => api.get<{ data: GarantiaVehiculo[] }>(`/vehiculos/${vehiculoId}/garantias`),
    enabled: vehiculoId > 0,
  })
}

function invalidarVehiculo(qc: ReturnType<typeof useQueryClient>, vehiculoId: number) {
  qc.invalidateQueries({ queryKey: ['garantias-vehiculo', vehiculoId] })
  // Cambiar el arranque de una garantía cambia qué requerimientos siguen
  // pidiéndose en esa unidad.
  qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] })
  qc.invalidateQueries({ queryKey: ['pendientes', vehiculoId] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

export function useCreateGarantiaVehiculo(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GarantiaVehiculoPayload) =>
      api.post<{ data: GarantiaVehiculo }>(`/vehiculos/${vehiculoId}/garantias`, payload),
    onSuccess: () => invalidarVehiculo(qc, vehiculoId),
  })
}

export function useUpdateGarantiaVehiculo(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<GarantiaVehiculoPayload> }) =>
      api.put<{ data: GarantiaVehiculo }>(`/garantias/${id}`, payload),
    onSuccess: () => invalidarVehiculo(qc, vehiculoId),
  })
}

export function useDeleteGarantiaVehiculo(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/garantias/${id}`),
    onSuccess: () => invalidarVehiculo(qc, vehiculoId),
  })
}

// ─── Cómo se lee una garantía en pantalla ───────────────────────────────────

/** "3 años", "18 meses", "100,000 km", "3 años o 100,000 km". */
export function textoCobertura(g: Pick<GarantiaVehiculo, 'trigger_mode' | 'duracion_meses' | 'limite_km'>): string {
  const partes: string[] = []
  if (g.duracion_meses != null && g.trigger_mode !== 'km') {
    partes.push(g.duracion_meses % 12 === 0
      ? `${g.duracion_meses / 12} año${g.duracion_meses === 12 ? '' : 's'}`
      : `${g.duracion_meses} meses`)
  }
  if (g.limite_km != null && g.trigger_mode !== 'meses') {
    partes.push(`${g.limite_km.toLocaleString('es-MX')} km`)
  }
  return partes.join(' o ') || '—'
}

export interface EtiquetaGarantia {
  color: string
  label: string
  /** Lo que explica el badge: por qué se acabó o cuánto le queda. */
  detalle: string
}

const MOTIVO: Record<'cancelada' | 'tiempo' | 'kilometraje', string> = {
  cancelada:   'Cancelada',
  tiempo:      'Venció por tiempo',
  kilometraje: 'Venció por kilometraje',
}

// Amarillo cuando le queda poco: seis meses o 10,000 km son el margen con el que
// todavía da tiempo de meter la unidad a un servicio antes de perderla.
export function etiquetaGarantia(g: GarantiaVehiculo): EtiquetaGarantia {
  const e = g.estado
  if (!e.vigente) {
    return {
      color: 'gray',
      label: e.motivo === 'cancelada' ? 'Cancelada' : 'Vencida',
      detalle: e.motivo ? MOTIVO[e.motivo] : 'Vencida',
    }
  }

  const restantes: string[] = []
  if (e.meses_restantes != null) restantes.push(`${e.meses_restantes} mes${e.meses_restantes === 1 ? '' : 'es'}`)
  if (e.km_restantes   != null) restantes.push(`${e.km_restantes.toLocaleString('es-MX')} km`)
  const detalle = restantes.length ? `Le quedan ${restantes.join(' y ')}` : 'Vigente'

  const porVencer =
    (e.meses_restantes != null && e.meses_restantes <= 6) ||
    (e.km_restantes    != null && e.km_restantes    <= 10_000)

  return porVencer
    ? { color: 'yellow', label: 'Por vencer', detalle }
    : { color: 'green',  label: 'Vigente',    detalle }
}
