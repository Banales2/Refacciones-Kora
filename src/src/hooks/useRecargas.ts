// Recargas de combustible de un vehículo: cada una registra la gasolinera,
// el conductor, la fecha, los litros cargados y lo que costó.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Gasolina } from '../lib/combustible'

// Los trailers tienen varios tanques y la bomba imprime un ticket por tanque;
// la gasolinera los factura por separado. El vale sigue siendo uno.
export const TICKETS_MAX = 3

export interface TicketRecarga {
  id:     number
  litros: number
  costo:  number
}

export interface Recarga {
  id:            number
  vehiculo_id:   number
  // Null solo en las de emergencia.
  gasolinera_id: number | null
  conductor_id:  number
  // Null solo en las recargas anteriores a que el vale fuera obligatorio.
  vale_id:       number | null
  fecha:         string
  litros:        number
  costo:         number
  kilometraje:   number | null
  // La carga que el chofer hizo de su bolsa porque no le alcanzaba para ir por
  // el vale: sin gasolinera, sin vale y sin kilometraje. Solo la registra el admin.
  emergencia:    boolean
  // Diesel, Magna o Premium. Null = no se sabe: las de gasolina de antes de
  // que se preguntara, y las de gas.
  producto:      'Diesel' | Gasolina | null
  // El combustible de la unidad hoy: decide si el formulario pregunta.
  vehiculo_combustible: string | null
  gasolinera:    string | null
  ubicacion:     string | null
  conductor:     string
  // Folio impreso del vale. Null solo en las recargas que se quedaron sin vale.
  vale_folio:    string | null
  vale_fecha:    string | null
  // Quién la capturó; el practicante corrige solo las suyas. Null si no se sabe.
  capturado_por: string | null
  // Su nombre en `usuarios`; null si no tiene o no se sabe quién fue.
  capturado_por_nombre: string | null
  // De 1 a TICKETS_MAX. `litros` y `costo` de arriba son su suma.
  tickets:       TicketRecarga[]
}

export interface RecargaPayload {
  gasolinera_id: number
  conductor_id:  number
  vale_id:       number
  fecha:         string
  // `id` solo al editar uno que ya existía: si ya casó con una factura tiene
  // que conservarlo.
  tickets:       { id?: number; litros: number; costo: number }[]
  kilometraje:   number
  // Solo en las unidades de gasolina; en las de Diesel lo pone la API.
  producto?:     Gasolina
}

export interface RecargaEmergenciaPayload {
  conductor_id: number
  fecha:        string
  litros:       number
  costo:        number
  producto?:    Gasolina
}

/** Renglón del listado de toda la flota: trae además el vehículo recargado. */
export interface RecargaConVehiculo extends Recarga {
  marca:  string
  modelo: string
  serie:  string
  placas: string | null
}

// Las recargas de todos los vehículos que alcanza a ver quien está conectado:
// al responsable la API le manda sólo las de su sucursal.
export function useRecargasTodas() {
  return useQuery({
    queryKey: ['recargas', 'todas'],
    queryFn: () => api.get<{ data: RecargaConVehiculo[] }>('/recargas'),
  })
}

export function useRecargas(vehiculoId: number) {
  return useQuery({
    queryKey: ['recargas', vehiculoId],
    queryFn: () => api.get<{ data: Recarga[] }>(`/vehiculos/${vehiculoId}/recargas`),
    enabled: vehiculoId > 0,
  })
}

// El vehículo viaja con cada alta y no al crear el hook: en la pestaña Recargas
// de Vales de gasolina se elige en el mismo formulario.
export function useCreateRecarga() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, payload }: { vehiculoId: number; payload: RecargaPayload }) =>
      api.post<{ data: Recarga }>(`/vehiculos/${vehiculoId}/recargas`, payload),
    onSuccess: () => {
      // Todas: la del vehículo y el listado de la flota.
      qc.invalidateQueries({ queryKey: ['recargas'] })
      // Registrar la recarga avanza el odómetro del vehículo (solo si el km
      // capturado es mayor al que ya tenía).
      qc.invalidateQueries({ queryKey: ['vehiculos'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

// No avanza el odómetro: la de emergencia no lleva kilometraje.
export function useCreateRecargaEmergencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, payload }: { vehiculoId: number; payload: RecargaEmergenciaPayload }) =>
      api.post<{ data: Recarga }>(`/vehiculos/${vehiculoId}/recargas/emergencia`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recargas'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateRecarga() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: {
      id: number
      payload: Partial<RecargaPayload> | RecargaEmergenciaPayload
    }) =>
      api.put<{ data: Recarga }>(`/recargas/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recargas'] })
      // Quitar un ticket suelta el renglón de factura que lo cobraba.
      qc.invalidateQueries({ queryKey: ['facturas-gasolina'] })
    },
  })
}

