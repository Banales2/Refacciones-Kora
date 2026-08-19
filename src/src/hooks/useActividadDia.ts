// Bitácora de un día concreto (todo lo que la flota registró con esa fecha) y
// el resumen por día del mes que el calendario usa para marcar los cuadros.
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface MantenimientoDia {
  id:              number
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  tipo:            string | null
  tecnico:         string | null
  costo:           number
  piezas_total:    number
  km_actual:       number | null
  observaciones:   string | null
}

export interface RecargaDia {
  id:              number
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  gasolinera:      string
  ubicacion:       string
  conductor:       string
  litros:          number
  costo:           number
  kilometraje:     number | null
  vale_folio:      string | null
}

export interface ValeDia {
  id:              number
  folio:           string
  creado_por:      string
  conductor:       string
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  usado:           boolean
}

export interface IncidenciaDia {
  id:              number
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  nombre:          string
  categoria:       string | null
  severidad:       'superficial' | 'moderada' | 'grave'
  status:          'activo' | 'completado' | 'pausado' | 'cancelado'
  hora:            string | null
  ubicacion:       string
  reportado_por:   string
}

export interface IncidenciaCerradaDia extends IncidenciaDia {
  mantenimiento_id: number
}

export interface CompraDia {
  id:               number
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  proveedor:        string
  sucursal:         string | null
  cantidad_inicial: number
  costo_unitario:   number
  num_factura:      string | null
  comprado_por:     string | null
}

export interface TraspasoDia {
  id:            number
  numero_serie:  string
  descripcion:   string
  origen:        string
  destino:       string
  cantidad:      number
  usuario_email: string | null
}

export interface TotalesDia {
  mano_obra:     number
  refacciones:   number
  combustible:   number
  /** Lo que salió de caja ese día: mano de obra + refacciones + combustible. */
  total:         number
  litros:        number
  /** Informativo: ya se pagó al comprar las piezas, por eso no entra en `total`. */
  piezas_usadas: number
}

export interface ActividadDelDia {
  fecha:                string
  totales:              TotalesDia
  mantenimientos:       MantenimientoDia[]
  recargas:             RecargaDia[]
  vales:                ValeDia[]
  incidencias_abiertas: IncidenciaDia[]
  incidencias_cerradas: IncidenciaCerradaDia[]
  compras:              CompraDia[]
  traspasos:            TraspasoDia[]
}

// Solo consulta cuando hay un día seleccionado: el detalle se abre al hacer
// clic, no al cargar la página.
export function useActividadDia(fecha: string | null) {
  return useQuery({
    queryKey: ['dashboard', 'actividad-dia', fecha],
    queryFn: () => api.get<{ data: ActividadDelDia }>(`/dashboard/actividad-dia?fecha=${fecha}`),
    enabled: fecha !== null,
  })
}

export interface ActividadDia {
  dia:                  string
  mantenimientos:       number
  recargas:             number
  vales:                number
  incidencias_abiertas: number
  incidencias_cerradas: number
  compras:              number
  traspasos:            number
  mano_obra:            number
  refacciones:          number
  combustible:          number
}

export interface ActividadDelMes {
  mes:   string
  rango: { start: string; end: string }
  dias:  ActividadDia[]
}

/** @param mes 'YYYY-MM' */
export function useActividadMes(mes: string) {
  return useQuery({
    queryKey: ['dashboard', 'actividad-mes', mes],
    queryFn: () => api.get<{ data: ActividadDelMes }>(`/dashboard/actividad-mes?mes=${mes}`),
  })
}
