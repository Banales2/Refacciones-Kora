// Flota de vehículos: búsqueda paginada con filtros por tipo/modelo, detalle
// individual y CRUD. Según el tipo, un vehículo pertenece a una ruta
// (tractocamión, caja de trailer) o a una sucursal (camión, montacargas).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type TipoVehiculo = 'camion' | 'tractocamion' | 'caja_trailer' | 'utilitario' | 'montacargas'

// Documentos que le faltan a una unidad. Los resuelve la API: qué tipos llevan
// cada documento y qué cuenta como faltante se decide en un solo lugar (antes
// cada pantalla lo recalculaba y a una se le olvidaba filtrar por tipo).
export type AlertaDocumento = 'sin_seguro' | 'sin_tenencia'

export interface VehiculoRow {
  id:           number
  tipo:         TipoVehiculo
  modelo_id:    number
  marca:        string
  modelo:       string
  serie:        string
  placas:       string | null
  /**
   * Cómo se le dice a la unidad en el patio: torton, rabon, camioneta, carro.
   * Informativo: `tipo` es el que gobierna seguros, tenencia y odómetro.
   */
  categoria:    string | null
  status:       string | null
  /**
   * Lo que marca el tablero hoy. NO es la vida de la unidad: si el odómetro se
   * reinició, lo anterior al reinicio no está aquí. Es el número contra el que
   * compara quien captura un chequeo o una recarga.
   */
  kilometraje:  number | null
  /** Los kilómetros de verdad: el tablero más lo acumulado en los reinicios. */
  kilometraje_total: number | null
  /** Lo acumulado en reinicios anteriores. 0 si nunca se reinició. */
  km_reiniciado: number
  combustible:  string | null
  ubicacion:    string | null
  sucursal_id:  number | null
  sucursal:     string | null
  tonelaje:     number | null
  // Tenencia: solo reparto y utilitarios. En los demás tipos llega null porque
  // no la pagan. Es nada más la fecha de vencimiento: no tiene folio.
  tenencia_expiracion: string | null
  ruta_id:      number | null
  ruta:         string | null
  pies:         number | null
  fecha_compra: string | null
  seguro_id:         number | null
  seguro_poliza:     string | null
  seguro_compania:   string | null
  seguro_expiracion: string | null
  permiso_id:         number | null
  permiso_zona:       string | null
  permiso_expiracion: string | null
  modelo_anio:        string | null
  alertas:            AlertaDocumento[]
}

export interface VehiculoCreatePayload {
  tipo:          TipoVehiculo
  modelo_id:     number
  serie:         string
  placas?:       string | null
  categoria?:    string | null
  combustible?:  string
  kilometraje?:  number
  status?:       string
  ubicacion?:    string | null
  sucursal_id?:  number
  tonelaje?:     number
  tenencia_expiracion?: string | null
  ruta_id?:      number
  pies?:         number
  fecha_compra?: string | null
  seguro_id?:    number | null
  permiso_id?:   number | null
}

export type VehiculoUpdatePayload = Partial<Omit<VehiculoCreatePayload, 'tipo'>>

interface ListResponse {
  data:       VehiculoRow[]
  pagination: { page: number; pageSize: number; total: number }
}

export function vehiculoLabel(v: Pick<VehiculoRow, 'marca' | 'modelo' | 'serie'>): string {
  return `${v.marca} ${v.modelo} — ${v.serie}`
}

// Motivo por el que una unidad necesita atención, para listar justo esas. La
// tenencia solo la pagan camiones de reparto y utilitarios, así que ese filtro
// deja fuera tractocamiones, cajas de trailer y montacargas. Ninguno incluye unidades
// dadas de baja.
export type AlertaVehiculo =
  'sin_tenencia' | 'sin_seguro' | 'programa_atrasado' | 'permiso_por_vencer'

export function useVehiculos(
  page = 1, search = '', tipo?: TipoVehiculo, modeloId?: number, pageSize?: number, enabled = true,
  alerta?: AlertaVehiculo
) {
  return useQuery({
    queryKey: ['vehiculos', page, search, tipo, modeloId, pageSize, alerta],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page) })
      if (search)   qs.set('search',    search)
      if (tipo)     qs.set('tipo',      tipo)
      if (modeloId) qs.set('modelo_id', String(modeloId))
      if (pageSize) qs.set('pageSize',  String(pageSize))
      if (alerta)   qs.set('alerta',    alerta)
      return api.get<ListResponse>(`/vehiculos?${qs}`)
    },
    enabled,
  })
}

export function useVehiculo(id?: number) {
  return useQuery({
    queryKey: ['vehiculos', 'detalle', id],
    queryFn: () => api.get<{ data: VehiculoRow }>(`/vehiculos/${id}`),
    enabled: id !== undefined,
  })
}

// Se pide bajo demanda (al exportar el PDF) para traer el inventario completo
// sin importar la búsqueda o página activa en pantalla.
export function fetchTodosLosVehiculos() {
  return api.get<ListResponse>('/vehiculos?page=1&pageSize=100')
}

// Alta, cambio o baja de un vehículo mueven los avisos del tablero (tenencia y
// seguro faltantes salen de ahí), así que se invalidan junto con la lista.
function invalidarFlota(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['vehiculos'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

export function useCreateVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: VehiculoCreatePayload) =>
      api.post<{ data: VehiculoRow }>('/vehiculos', payload),
    onSuccess: () => invalidarFlota(qc),
  })
}

export function useUpdateVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: VehiculoUpdatePayload }) =>
      api.put<{ data: VehiculoRow }>(`/vehiculos/${id}`, payload),
    onSuccess: () => invalidarFlota(qc),
  })
}

// Categorías de carrocería ya usadas en la flota, para sugerirlas al capturar.
// No hay catálogo: el vocabulario se arma con lo que se escribe.
/** Un reinicio de odómetro ya registrado. */
export interface ReinicioOdometro {
  id:              number
  vehiculo_id:     number
  fecha:           string
  km_al_reiniciar: number
  motivo:          string | null
  registrado_por:  string
  created_at:      string
}

export function useReiniciosOdometro(vehiculoId: number | null) {
  return useQuery({
    queryKey: ['odometro-reinicios', vehiculoId],
    queryFn: () => api.get<{ data: ReinicioOdometro[] }>(
      `/vehiculos/${vehiculoId}/odometro/reinicios`),
    enabled: vehiculoId !== null,
  })
}

/**
 * Registra que el tablero se puso en cero.
 *
 * Invalida medio mundo a propósito: el kilometraje de vida cambia, y con él lo
 * que se calcula a partir de él —el programa de mantenimiento, las garantías
 * por límite de km y los kilómetros de cada pieza montada—.
 */
export function useReiniciarOdometro(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      fecha?: string
      km_al_reiniciar?: number
      km_nuevo?: number
      motivo?: string | null
    }) => api.post<{ data: ReinicioOdometro }>(
      `/vehiculos/${vehiculoId}/odometro/reinicio`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['odometro-reinicios', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['vehiculos'] })
      qc.invalidateQueries({ queryKey: ['programa-vehiculo'] })
      qc.invalidateQueries({ queryKey: ['garantias-vehiculo'] })
      qc.invalidateQueries({ queryKey: ['unidades-pieza'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useCategoriasVehiculo() {
  return useQuery({
    queryKey: ['vehiculos-categorias'],
    queryFn: () => api.get<{ data: string[] }>('/vehiculos/categorias'),
    staleTime: 5 * 60 * 1000,
  })
}
