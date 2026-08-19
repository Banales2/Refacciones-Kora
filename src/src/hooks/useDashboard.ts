// Consultas del tablero principal: resumen de costos del mes, requerimientos
// vencidos y por vencer, historial para la gráfica, mantenimientos del
// calendario y el reporte de flota completo (este último bajo demanda).
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { conPeriodo, type Periodo } from '../lib/reportes/periodo'

export interface VehiculoConMantenimiento {
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  cantidad:        number
  costo_total:     number
}

export interface LoteMes {
  id:               number
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  proveedor:        string
  fecha_compra:     string
  cantidad_inicial: number
  costo_unitario:   number
}

export interface ResumenMes {
  rango: { start: string; end: string }
  mantenimientos: {
    count:           number
    /** Mano de obra + piezas consumidas: lo que costó el servicio visto solo. */
    costo_total:     number
    costo_mano_obra: number
    costo_piezas:    number
    por_vehiculo:    VehiculoConMantenimiento[]
  }
  piezas: {
    count:       number
    costo_total: number
    lotes:       LoteMes[]
  }
  /**
   * Gasto real del periodo: mano de obra + refacciones compradas. Las piezas
   * consumidas en mantenimientos no se suman porque ya se pagaron al comprarlas.
   */
  costo_total_periodo: number
}

export function useResumenMes() {
  return useQuery({
    queryKey: ['dashboard', 'resumen-mes'],
    queryFn: () => api.get<{ data: ResumenMes }>('/dashboard/resumen-mes'),
  })
}

export interface RequerimientoVencido {
  id:              number
  nombre:          string
  categoria:       string | null
  vehiculo_id:     number
  vehiculo_nombre: string
}

export function useRequerimientosVencidos() {
  return useQuery({
    queryKey: ['dashboard', 'requerimientos-pendientes'],
    queryFn: () => api.get<{ data: RequerimientoVencido[] }>('/dashboard/requerimientos-pendientes'),
  })
}

export function useRequerimientosPorVencer() {
  return useQuery({
    queryKey: ['dashboard', 'requerimientos-por-vencer'],
    queryFn: () => api.get<{ data: RequerimientoVencido[] }>('/dashboard/requerimientos-por-vencer'),
  })
}

export interface IncidenciaAbierta {
  id:              number
  nombre:          string
  categoria:       string | null
  severidad:       'superficial' | 'moderada' | 'grave'
  fecha:           string
  vehiculo_id:     number
  vehiculo_nombre: string
}

export function useIncidenciasAbiertas() {
  return useQuery({
    queryKey: ['dashboard', 'incidencias-abiertas'],
    queryFn: () => api.get<{ data: IncidenciaAbierta[] }>('/dashboard/incidencias-abiertas'),
  })
}

export interface SeguroPorVencer {
  id:               number
  poliza:           string
  compania:         string
  fecha_expiracion: string
  vehiculos:        number
  dias_restantes:   number
}

export interface PermisoPorVencer {
  id:               number
  zona_circulacion: string
  fecha_expiracion: string
  vehiculos:        number
  dias_restantes:   number
}

export interface LicenciaPorVencer {
  conductor_id:     number
  conductor:        string
  tipo:             'estatal' | 'federal' | 'expediente'
  numero:           string | null
  // Vigencia tal como se capturó en el catálogo…
  vigencia:         string
  // …y la misma ya interpretada como fecha.
  fecha_expiracion: string
  dias_restantes:   number
}

// Tenencia de un vehículo. Solo la pagan reparto y utilitarios, y no trae folio:
// lo único que se vigila es cuándo vence.
export interface TenenciaPorVencer {
  vehiculo_id:      number
  vehiculo:         string
  placas:           string | null
  tipo:             string
  fecha_expiracion: string
  dias_restantes:   number
}

// Unidad a la que le falta el documento por completo. No tiene fecha, así que
// no puede aparecer en las listas de "por vencer": se avisa aparte.
export interface VehiculoSinDocumento {
  vehiculo_id: number
  vehiculo:    string
  placas:      string | null
  tipo:        string
}

export interface DocumentosPorVencer {
  seguros:   SeguroPorVencer[]
  permisos:  PermisoPorVencer[]
  licencias: LicenciaPorVencer[]
  tenencias: TenenciaPorVencer[]
  sin_tenencia: VehiculoSinDocumento[]
  sin_seguro:   VehiculoSinDocumento[]
}

// Seguros y permisos de circulación ya vencidos o próximos a vencer (30 días),
// más las licencias de conductor con vigencia dentro de 2 meses.
export function useDocumentosPorVencer() {
  return useQuery({
    queryKey: ['dashboard', 'documentos-por-vencer'],
    queryFn: () => api.get<{ data: DocumentosPorVencer }>('/dashboard/documentos-por-vencer'),
  })
}

export interface HistorialDia {
  fecha:      string
  vencidos:   number
  por_vencer: number
}

export function useRequerimientosHistorial(meses = 12) {
  return useQuery({
    queryKey: ['dashboard', 'requerimientos-historial', meses],
    queryFn: () => api.get<{ data: HistorialDia[] }>(`/dashboard/requerimientos-historial?meses=${meses}`),
  })
}

export interface MantenimientoCalendario {
  id:              number
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  tipo:            string | null
  tecnico:         string | null
  fecha:           string
  costo:           number
  piezas_total:    number
}

export function useMantenimientosCalendario() {
  return useQuery({
    queryKey: ['dashboard', 'mantenimientos-calendario'],
    queryFn: () => api.get<{ data: MantenimientoCalendario[] }>('/dashboard/mantenimientos-calendario'),
  })
}

export type PeriodoComparacion = 'mes' | 'semana'

export interface VehiculoReporte {
  id:                    number
  tipo:                  string
  marca:                 string
  modelo:                string
  serie:                 string
  placas:                string | null
  status:                string | null
  kilometraje:           number | null
  ubicacion:             string | null
  sucursal_id:           number | null
  sucursal:              string | null
  ruta_id:               number | null
  ruta:                  string | null
  mantenimientos_mes:    number
  costo_mano_obra_mes:   number
  costo_piezas_mes:      number
  ultimo_mantenimiento:  string | null
  vencidos:              number
  por_vencer:            number
}

export interface ReporteFlota {
  periodo:      PeriodoComparacion
  rango_costos: { start: string; end: string }
  costos: {
    mano_obra:           number
    piezas_usadas:       number
    piezas_compradas:    number
    total_mantenimiento: number
    total:               number
  }
  comparacion: {
    rango_actual:                          { start: string; end: string }
    rango_anterior:                        { start: string; end: string }
    /** `null` cuando el periodo ya cerró y no hay snapshot histórico de esa fecha. */
    vencidos_actual:                       number | null
    vencidos_anterior:                     number | null
    /** `vivo` = conteo de hoy (el periodo sigue abierto); `historico` = al cierre. */
    origen_actual:                         'vivo' | 'historico'
  }
  vehiculos: VehiculoReporte[]
}

// Se pide bajo demanda (al exportar el PDF) en vez de precargarse con un hook,
// porque agrega la flota completa y solo hace falta en ese momento.
export function fetchReporteFlota(periodo: PeriodoComparacion, rango: Periodo = { modo: 'default' }) {
  return api.get<{ data: ReporteFlota }>(
    conPeriodo(`/dashboard/reporte-flota?periodo=${periodo}`, rango))
}

// ─── Consultas bajo demanda para los reportes ────────────────────────────────
// El tablero ya trae estos datos por su ventana de siempre; cuando el reporte
// se pide por un año o por dos fechas hay que volver a preguntar, porque lo que
// está en pantalla es de otro periodo. Se piden al momento de exportar y no con
// un hook para no dejar en caché un corte que se usó una sola vez.

export function fetchResumen(rango: Periodo) {
  return api.get<{ data: ResumenMes }>(conPeriodo('/dashboard/resumen-mes', rango))
}

export function fetchAnalisisCostos(rango: Periodo, dias: VentanaCostos = 90) {
  return api.get<{ data: AnalisisCostos }>(
    conPeriodo(`/dashboard/analisis-costos?dias=${dias}`, rango))
}

export function fetchDocumentosPorVencer(rango: Periodo) {
  return api.get<{ data: DocumentosPorVencer }>(
    conPeriodo('/dashboard/documentos-por-vencer', rango))
}

// ─── Análisis de costos ──────────────────────────────────────────────────────
// El resumen del mes dice cuánto se gastó; esto dice si estuvo bien gastado.
// Todo se calcula en el backend (`costosService`) porque son cruces entre
// recargas, mantenimientos y compras que no vale la pena bajar completos.

export type VentanaCostos = 30 | 90 | 180 | 365

export interface VehiculoCosto {
  vehiculo_id:        number
  vehiculo:           string
  tipo:               string
  modelo_id:          number
  modelo:             string
  km_recorridos:      number | null
  combustible:        number
  mano_obra:          number
  refacciones:        number
  total:              number
  costo_por_km:       number | null
  litros:             number
  rendimiento:        number | null
  rendimiento_modelo: number | null
  desviacion_pct:     number | null
  sobrecosto_anual:   number | null
  mantenimientos:     number
  recargas:           number
}

export interface GasolineraCosto {
  gasolinera_id: number
  gasolinera:    string
  recargas:      number
  litros:        number
  costo:         number
  precio_litro:  number | null
  sobreprecio:   number
}

export type TipoAnomalia =
  | 'rendimiento_bajo' | 'odometro_retrocede' | 'precio_alto'
  | 'carga_duplicada'  | 'sin_vale'           | 'sin_odometro'

export interface Anomalia {
  key:         string
  tipo:        TipoAnomalia
  severidad:   'alta' | 'media'
  vehiculo_id: number
  vehiculo:    string
  fecha:       string
  detalle:     string
  monto:       number | null
}

export interface Retrabajo {
  vehiculo_id:  number
  vehiculo:     string
  tipo:         string
  fecha_previa: string
  fecha:        string
  dias:         number
  costo:        number
}

export interface OportunidadAhorro {
  pieza_id:        number
  numero_serie:    string
  descripcion:     string
  proveedor:       string
  mejor_proveedor: string
  pagado:          number
  mejor_precio:    number
  cantidad:        number
  ahorro:          number
}

export interface GastoMes {
  mes:         string
  mano_obra:   number
  refacciones: number
  combustible: number
}

export interface AnalisisCostos {
  rango: { start: string; end: string; dias: number }
  totales: {
    combustible:           number
    mano_obra:             number
    refacciones_compradas: number
    refacciones_usadas:    number
    total_caja:            number
    total_operacion:       number
    km_recorridos:         number
    costo_por_km:          number | null
    litros:                number
    rendimiento:           number | null
    precio_litro:          number | null
    ahorro_refacciones:    number
    ahorro_combustible:    number
    ahorro_total:          number
    vehiculos_analizados:  number
  }
  vehiculos:          VehiculoCosto[]
  gasolineras:        GasolineraCosto[]
  gasto_mensual:      GastoMes[]
  ahorro_refacciones: OportunidadAhorro[]
  anomalias:          Anomalia[]
  anomalias_resumen:  { tipo: TipoAnomalia; cantidad: number; monto: number }[]
  retrabajos:         Retrabajo[]
}

export function useAnalisisCostos(dias: VentanaCostos = 90) {
  return useQuery({
    queryKey: ['dashboard', 'analisis-costos', dias],
    queryFn: () => api.get<{ data: AnalisisCostos }>(`/dashboard/analisis-costos?dias=${dias}`),
  })
}
