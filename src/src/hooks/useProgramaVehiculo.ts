// El programa de mantenimiento visto desde una unidad: en qué etapa va, en qué
// punto del recorrido está, qué le toca en la próxima visita al taller y qué
// renglones se le vencieron por su cuenta.
//
// El kilometraje es grupal —la visita cierra toda la columna de un golpe— y el
// tiempo es individual: cada renglón trae su "o cada N meses" y puede vencer
// mucho antes de que llegue el kilometraje de su columna.
//
// La etapa la decide la API contra la garantía principal del modelo, y aquí
// solo se pinta. Lo que sí se manda desde aquí es forzarla a mano.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FasePrograma, OperacionPrograma, Programa, TipoPrograma } from './usePrograma'
import type { EstadoGarantia } from './useGarantias'

/** La etapa se llama igual que el programa que se sigue en ella. */
export type Etapa = TipoPrograma

export interface VinculoPrograma {
  vehiculo_id:  number
  etapa:        Etapa
  programa_id:  number
  /** Nulo en posgarantía = derivado; ver `arranque`. */
  km_inicio:    number | null
  fecha_inicio: string | null
  /** Una persona fijó esta etapa: el cálculo contra la garantía no manda. */
  forzada:      boolean
}

/**
 * Una columna del programa ya cerrada. Hacia el usuario es "la visita al
 * taller"; por debajo es el mantenimiento con el que se pagó, así que `id` y
 * `mantenimiento_id` son el mismo número y la fecha, el odómetro y el costo
 * salen de él.
 */
export interface VisitaPrograma {
  id:               number
  vehiculo_id:      number
  etapa:            Etapa
  fase_id:          number
  /** Posición en el recorrido de su etapa: la columna sola no la identifica. */
  indice:           number
  fecha:            string
  km:               number | null
  mantenimiento_id: number
  /** Lo que costó de verdad, no lo que la fase tenía cotizado. */
  costo:            number
  tipo:             string | null
}

/**
 * De dónde salió el punto cero del recorrido de la etapa activa. Lo normal al
 * pasar a posgarantía es `ultimo_servicio`: el reloj arranca donde quedó el
 * último preventivo que la unidad realmente recibió.
 */
export type OrigenArranque =
  | 'capturado' | 'ultimo_servicio' | 'vencimiento_garantia' | 'arranque_anterior'

export const ORIGEN_ARRANQUE_LABEL: Record<OrigenArranque, string> = {
  capturado:            'Capturado a mano',
  ultimo_servicio:      'Desde el último servicio recibido',
  vencimiento_garantia: 'Desde el vencimiento de la garantía',
  arranque_anterior:    'Heredado de la etapa anterior',
}

export interface Arranque {
  km:     number
  fecha:  string | null
  origen: OrigenArranque
}

export interface GarantiaDeEtapa {
  id:     number
  nombre: string
  estado: EstadoGarantia
}

/** Lo que esta unidad hace distinto del programa de su modelo. */
export interface ExcepcionFase {
  fase_id: number
  km:      number | null
  costo:   number | null
  omitida: boolean
}

export interface ExcepcionOperacion {
  operacion_id: number
  activa:       boolean
  limite_meses: number | null
}

export interface Excepciones {
  fases:       ExcepcionFase[]
  operaciones: ExcepcionOperacion[]
}

export interface OperacionDeFase {
  operacion: OperacionPrograma
  accion:    string
}

export interface ServicioPendiente {
  indice:       number
  fase:         FasePrograma
  km_recorrido: number
  km_odometro:  number
  intervalo:    number
  km_faltantes: number | null
  vencida:      boolean
  por_vencer:   boolean
  operaciones:  OperacionDeFase[]
}

export interface OperacionPorTiempo {
  operacion:    OperacionPrograma
  /** Nulo = nunca se ha atendido; se cuenta desde el arranque del programa. */
  ultima_fecha: string | null
  meses:        number | null
  vencida:      boolean
  por_vencer:   boolean
}

// Lo que va a costar el mantenimiento programado de aquí en adelante. Las
// columnas sin cotizar no cuentan como cero: se dicen aparte para que el total
// se lea sabiendo qué tanto le falta.
export interface ProyeccionCostos {
  visitas:   number
  costo:     number
  sin_costo: number
  hasta_km:  number | null
}

export interface EstadoProgramaVehiculo {
  etapa:              Etapa
  etapa_forzada:      boolean
  /** La garantía principal del modelo copiada en esta unidad. Null = no hay. */
  garantia:           GarantiaDeEtapa | null
  /** Hay servicio vencido y la garantía sigue viva: se puede perder. */
  garantia_en_riesgo: boolean
  /** Salió de garantía pero su modelo no tiene capturado el segundo programa. */
  falta_posgarantia:  boolean
  vinculo:            VinculoPrograma
  arranque:           Arranque
  /** El del modelo, ya con las excepciones de esta unidad aplicadas. */
  programa:           Programa
  excepciones:        Excepciones
  visitas:            VisitaPrograma[]
  estados:            {
    operacion_id: number
    ultima_fecha: string
    ultimo_km:    number | null
    /** El mantenimiento que lo cerró; nulo si se atendió suelto, por tiempo. */
    mantenimiento_id: number | null
  }[]
  servicios_hechos:   number
  kilometraje:        number | null
  km_recorrido:       number | null
  proxima:            ServicioPendiente | null
  siguientes:         ServicioPendiente[]
  proyeccion:         ProyeccionCostos
  operaciones_tiempo: OperacionPorTiempo[]
}

export function useProgramaVehiculo(vehiculoId: number) {
  return useQuery({
    // `data` viene en null cuando la unidad no sigue ningún programa: no es un
    // error, es la ficha ofreciendo asignarlo.
    queryKey: ['programa-vehiculo', vehiculoId],
    queryFn: () => api.get<{ data: EstadoProgramaVehiculo | null }>(`/vehiculos/${vehiculoId}/programa`),
  })
}

// Cerrar una visita mueve el tablero (deja de estar vencida) y toca el
// mantenimiento con el que se pagó, así que se invalidan las tres cosas.
function invalidar(qc: ReturnType<typeof useQueryClient>, vehiculoId: number) {
  qc.invalidateQueries({ queryKey: ['programa-vehiculo', vehiculoId] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

function guardar(
  qc: ReturnType<typeof useQueryClient>, vehiculoId: number, data: EstadoProgramaVehiculo | null,
) {
  qc.setQueryData(['programa-vehiculo', vehiculoId], { data })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

export interface AsignarProgramaPayload {
  etapa?:        Etapa
  programa_id?:  number
  km_inicio?:    number | null
  fecha_inicio?: string | null
}

export function useAsignarPrograma(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: AsignarProgramaPayload) =>
      api.put<{ data: EstadoProgramaVehiculo }>(`/vehiculos/${vehiculoId}/programa`, payload),
    onSuccess: (r) => guardar(qc, vehiculoId, r.data),
  })
}

export function useQuitarPrograma(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (etapa: Etapa = 'fabricante') =>
      api.delete(`/vehiculos/${vehiculoId}/programa?etapa=${etapa}`),
    onSuccess: () => invalidar(qc, vehiculoId),
  })
}

// Fijar la etapa a mano, o soltarla (null) para que vuelva a decidirla la
// garantía. Sirve en los dos sentidos: retener a la unidad en el programa del
// fabricante con la garantía ya vencida, o adelantarla al de después cuando la
// perdió antes de tiempo.
export function useForzarEtapa(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (etapa: Etapa | null) =>
      api.put<{ data: EstadoProgramaVehiculo }>(`/vehiculos/${vehiculoId}/programa/etapa`, { etapa }),
    onSuccess: (r) => guardar(qc, vehiculoId, r.data),
  })
}

// Lo que esta unidad hace distinto del programa de su modelo. Va entero: es un
// reemplazo, no un parche.
export function useSetExcepciones(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (excepciones: Excepciones) =>
      api.put<{ data: EstadoProgramaVehiculo }>(
        `/vehiculos/${vehiculoId}/programa/excepciones`, excepciones
      ),
    onSuccess: (r) => guardar(qc, vehiculoId, r.data),
  })
}

// Solo el mantenimiento: la fecha y el odómetro del servicio son los suyos.
export interface VisitaPayload {
  mantenimiento_id: number
}

// Declara que un mantenimiento ya registrado cerró la columna que tocaba.
export function useRegistrarVisita(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: VisitaPayload) =>
      api.post<{ data: EstadoProgramaVehiculo }>(`/vehiculos/${vehiculoId}/programa/visitas`, payload),
    onSuccess: (r) => {
      guardar(qc, vehiculoId, r.data)
      qc.invalidateQueries({ queryKey: ['mantenimientos'] })
    },
  })
}

// Suelta el vínculo con la columna; el mantenimiento se queda, porque la unidad
// sí entró al taller. El id es el del mantenimiento: la visita no tiene propio.
export function useDeshacerVisita(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mantenimientoId: number) =>
      api.delete<{ data: EstadoProgramaVehiculo }>(`/programa-visitas/${mantenimientoId}`),
    onSuccess: (r) => {
      guardar(qc, vehiculoId, r.data)
      qc.invalidateQueries({ queryKey: ['mantenimientos'] })
    },
  })
}

// Atender un renglón solo: su límite de meses venció antes que el kilometraje
// de su columna. No cuenta como visita.
export function useAtenderOperacion(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ operacionId, fecha, km }: {
      operacionId: number; fecha: string; km?: number | null
    }) => api.post<{ data: EstadoProgramaVehiculo }>(
      `/vehiculos/${vehiculoId}/programa/operaciones/${operacionId}/atender`, { fecha, km }
    ),
    onSuccess: (r) => guardar(qc, vehiculoId, r.data),
  })
}
