// Bitácora de cambios. Sólo admin: la API responde 403 al resto y la ruta
// /api/registros-cambios* está restringida en staticwebapp.config.json.
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api } from '../lib/api'

export type Accion = 'CREAR' | 'EDITAR' | 'ELIMINAR' | 'LOGIN'

export interface Cambio {
  campo:   string
  antes:   unknown
  despues: unknown
}

export interface DetallesRegistro {
  /** Sólo en EDITAR: qué campos se movieron y entre qué valores. */
  cambios?:   Cambio[]
  /** Frase que identifica el registro editado. */
  registro?:  string
  /** Fila completa tal como estaba justo antes del DELETE. */
  eliminado?: Record<string, unknown>
  /** Fila completa recién insertada. */
  creado?:    Record<string, unknown>
  /** Contexto que añadió el endpoint (ids relacionados, etc.). */
  contexto?:  Record<string, unknown>
}

export interface RegistroCambio {
  id:             number
  /** ISO en UTC; se convierte a hora de México al mostrar. */
  fecha_hora:     string
  usuario_email:  string
  usuario_nombre: string | null
  accion:         Accion
  tabla:          string
  /** Nombre legible de la tabla: «Vehículo», «Vale de gasolina». */
  etiqueta:       string
  registro_id:    string | null
  descripcion:    string | null
  detalles:       DetallesRegistro | null
  ip:             string | null
}

export interface FiltrosRegistros {
  usuario?: string
  accion?:  string
  tabla?:   string
  desde?:   string
  hasta?:   string
  texto?:   string
  pagina:   number
  tamano:   number
}

interface Respuesta {
  data:   RegistroCambio[]
  total:  number
  pagina: number
  tamano: number
}

function queryString(f: FiltrosRegistros): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  return p.toString()
}

export function useRegistrosCambios(filtros: FiltrosRegistros) {
  return useQuery({
    queryKey: ['registros-cambios', filtros],
    queryFn: () => api.get<Respuesta>(`/registros-cambios?${queryString(filtros)}`),
    // Sin esto la tabla parpadea en blanco al cambiar de página o de filtro.
    placeholderData: keepPreviousData,
  })
}

export interface OpcionesFiltro {
  usuarios: { email: string; nombre: string | null }[]
  tablas:   { tabla: string; etiqueta: string }[]
}

export function useFiltrosRegistros() {
  return useQuery({
    queryKey: ['registros-cambios', 'filtros'],
    queryFn: () => api.get<OpcionesFiltro>('/registros-cambios/filtros'),
    // Los desplegables sólo crecen cuando aparece un usuario o módulo nuevo.
    staleTime: 5 * 60 * 1000,
  })
}
