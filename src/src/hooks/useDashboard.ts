// Consultas del tablero principal: resumen de costos del mes, mantenimientos
// vencidos y por vencer, historial para la gráfica, mantenimientos del
// calendario y el reporte de flota completo (este último bajo demanda).
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { conPeriodo, type Periodo } from '../lib/reportes/periodo'
import type { TipoHallazgo } from './useFacturasCasetas'

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
  combustible: {
    count:       number
    costo_total: number
  }
  casetas: {
    /** Cruces que PASE cobró en el periodo. */
    count:       number
    costo_total: number
    /**
     * El último día con cruces facturados. PASE factura cada diez días: lo que
     * va después de esta fecha todavía no tiene casetas. Null sin facturas.
     */
    hasta:       string | null
  }
  /**
   * Gasto real del periodo: mano de obra + refacciones compradas + combustible
   * + casetas.
   * Las piezas consumidas en mantenimientos no se suman porque ya se pagaron al
   * comprarlas; el combustible sí entra completo, porque la recarga se paga
   * cuando se carga y no se vuelve a cobrar después.
   */
  costo_total_periodo: number
}

export function useResumenMes() {
  return useQuery({
    queryKey: ['dashboard', 'resumen-mes'],
    queryFn: () => api.get<{ data: ResumenMes }>('/dashboard/resumen-mes'),
  })
}

// Lo que el programa de mantenimiento de una unidad tiene atrasado.
export interface ServicioPreventivo {
  /** Negativo: la alerta no tiene un registro propio detrás, solo distingue renglones. */
  id:              number
  nombre:          string
  categoria:       string | null
  vehiculo_id:     number
  vehiculo_nombre: string
  /**
   * 'fase' es la visita completa que ya toca —toda la columna del programa—;
   * 'operacion' es un renglón que venció por su propio límite de meses, sin
   * arrastrar el resto. Se atienden distinto, y por eso se distinguen aquí.
   */
  tipo:            'fase' | 'operacion'
  /**
   * La unidad sigue en garantía y este servicio ya se pasó. Es la alerta que
   * más cuesta ignorar: el programa del fabricante existe para no perderla.
   */
  garantia_en_riesgo: boolean
}

export function usePreventivosVencidos(activo = true) {
  return useQuery({
    enabled: activo,
    queryKey: ['dashboard', 'preventivos-vencidos'],
    queryFn: () => api.get<{ data: ServicioPreventivo[] }>('/dashboard/preventivos-vencidos'),
  })
}

export function usePreventivosPorVencer() {
  return useQuery({
    queryKey: ['dashboard', 'preventivos-por-vencer'],
    queryFn: () => api.get<{ data: ServicioPreventivo[] }>('/dashboard/preventivos-por-vencer'),
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
export function useDocumentosPorVencer(activo = true) {
  return useQuery({
    enabled: activo,
    queryKey: ['dashboard', 'documentos-por-vencer'],
    queryFn: () => api.get<{ data: DocumentosPorVencer }>('/dashboard/documentos-por-vencer'),
  })
}

// Un día de la tendencia, recalculado con las reglas actuales del programa.
export interface HistorialDia {
  fecha:              string
  vencidos:           number
  por_vencer:         number
  /** De los vencidos, los de unidades que ese día seguían en garantía. */
  garantia_en_riesgo: number
  /** Unidades distintas con al menos un vencido. */
  unidades_atrasadas: number
  /** Visitas al taller registradas ese día contra el programa. */
  servicios:          number
}

export function useHistorialPreventivos(meses = 12) {
  return useQuery({
    queryKey: ['dashboard', 'preventivos-historial', meses],
    queryFn: () => api.get<{ data: HistorialDia[] }>(`/dashboard/preventivos-historial?meses=${meses}`),
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

/**
 * Una sucursal y lo que gastaron y recorrieron las unidades con base en ella.
 * `sucursal_id` null es "Sin base fija", que va al final y no se compara.
 */
export interface SucursalCosto {
  sucursal_id:        number | null
  sucursal:           string
  /** Unidades con base aquí, se hayan movido o no. */
  unidades_flota:     number
  /** Las que tuvieron gasto o cargas en el periodo. */
  unidades:           number
  km_recorridos:      number
  unidades_con_km:    number
  combustible:        number
  litros:             number
  recargas:           number
  mano_obra:          number
  refacciones:        number
  casetas:            number
  total:              number
  /** Solo con las unidades que tienen kilometraje. */
  costo_por_km:       number | null
  combustible_por_km: number | null
  precio_litro:       number | null
  gasto_por_unidad:   number | null
  /** km/L revuelto: mezcla modelos. */
  rendimiento:        number | null
  /** Contra el promedio del modelo de cada unidad, en %. Negativo = gastan de más. */
  eficiencia_pct:     number | null
  sobrecosto_anual:   number
  anomalias:          number
  sin_vale:           number
  sin_odometro:       number
}

export interface VehiculoCosto {
  vehiculo_id:        number
  vehiculo:           string
  tipo:               string
  modelo_id:          number
  modelo:             string
  /** Null: sin base fija (tractocamiones, sucursal múltiple, utilitarios sin asignar). */
  sucursal_id:        number | null
  sucursal:           string | null
  km_recorridos:      number | null
  combustible:        number
  mano_obra:          number
  refacciones:        number
  /** Lo que PASE cobró por sus cruces. */
  casetas:            number
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

// Un renglón por gasolinera y combustible: cada uno tiene su propia "más barata".
export interface GasolineraCosto {
  gasolinera_id: number
  gasolinera:    string
  /** Diesel, Magna, Premium o 'Sin especificar' (las de antes de preguntarlo). */
  producto:      string
  recargas:      number
  litros:        number
  costo:         number
  /** Sin las cargas atípicas, que sí cuentan en litros y gasto. */
  precio_litro:  number | null
  sobreprecio:   number
  /** Cargas con el litro a más de 15 % de la mediana: casi siempre, mal capturadas. */
  atipicas:      number
}

/** El litro de una gasolinera y un combustible en un mes. */
export interface PrecioMensual {
  mes:           string   // 'YYYY-MM'
  gasolinera_id: number
  gasolinera:    string
  producto:      string
  recargas:      number
  precio_litro:  number | null
}

export interface PrecioProducto {
  producto:     string
  litros:       number
  costo:        number
  precio_litro: number | null
  /** El de la gasolinera más barata del periodo; contra él se mide el sobreprecio. */
  precio_minimo: number | null
}

export type TipoAnomalia =
  | 'rendimiento_bajo' | 'odometro_retrocede' | 'precio_alto' | 'precio_bajo'
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
  casetas:     number
}

export interface AnalisisCostos {
  rango: { start: string; end: string; dias: number }
  totales: {
    combustible:           number
    mano_obra:             number
    /** Todos los cruces que PASE cobró, también los de tags sin unidad. */
    casetas:               number
    /** Hasta dónde hay cruces facturados: lo que va después no tiene casetas todavía. */
    casetas_hasta:         string | null
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
  /** El precio por litro de cada combustible, que es el que se compara. */
  precios_litro:      PrecioProducto[]
  vehiculos:          VehiculoCosto[]
  sucursales:         SucursalCosto[]
  gasolineras:        GasolineraCosto[]
  /** Últimos 12 meses, sin importar el periodo elegido. */
  precios_mensuales:  PrecioMensual[]
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


// ─── Pendientes del almacén ──────────────────────────────────────────────────

export interface TraspasoPendienteDash {
  id:            number
  numero_serie:  string
  descripcion:   string
  origen:        string
  destino:       string
  cantidad:      number
  fecha:         string
  /** Días desde que salió del almacén de origen. */
  dias:          number
  autorizado_por: string | null
}

export interface PendientesAlmacen {
  traspasos:             TraspasoPendienteDash[]
  refacciones_sin_marca: number
  /** Solicitudes de refacción que ninguna sucursal ha visto contestadas. */
  solicitudes:           number
}

/**
 * Trabajo del almacén que no alerta solo: mercancía en camino esperando que la
 * acepten, y refacciones sin marca capturada. Ninguna de las dos vence ni cae en
 * una bandeja, así que sin el tablero solo se descubren tropezando con ellas.
 */
export function usePendientesAlmacen() {
  return useQuery({
    queryKey: ['dashboard', 'pendientes-almacen'],
    queryFn: () => api.get<{ data: PendientesAlmacen }>('/dashboard/pendientes-almacen'),
  })
}

// ─── Fugas de dinero ─────────────────────────────────────────────────────────
//
// Siete cruces sobre datos ya capturados que buscan dinero perdido donde no
// aparece como gasto. El análisis de costos mide lo que se gastó; esto mide lo
// que se fue.

export interface VidaPorMarca {
  tipo_pieza_id:  number
  tipo_pieza:     string
  marca:          string
  montajes:       number
  km_promedio:    number
  costo_promedio: number
  /** Pesos por cada 1 000 km de servicio: la cifra que compara de verdad. */
  costo_por_mil:  number
}

export interface MermaMes {
  mes:      string
  sucursal: string
  /** Positivo = el sistema cuenta de más, o sea que en el estante hay menos. */
  piezas:   number
  monto:    number
}

export interface LoteInmovil {
  lote_id:        number
  pieza_id:       number
  numero_serie:   string
  descripcion:    string
  marca:          string
  sucursal:       string | null
  cantidad:       number
  costo_unitario: number
  monto:          number
  fecha_compra:   string | null
  dias_parado:    number | null
  /** Ya no queda ningún modelo vivo que use esta refacción. */
  descontinuada:  boolean
}

export interface ValeSinRecarga {
  id:        number
  folio:     string
  fecha:     string
  conductor: string
  vehiculo:  string
  dias:      number
}

export interface DerivaPrecio {
  pieza_id:      number
  numero_serie:  string
  descripcion:   string
  marca:         string
  compras:       number
  primer_precio: number
  primera_fecha: string
  ultimo_precio: number
  ultima_fecha:  string
  variacion_pct: number
}

export interface CorrectivoEnGarantia {
  mantenimiento_id: number
  vehiculo_id:      number
  vehiculo:         string
  fecha:            string
  costo:            number
  garantia:         string
  folio:            string | null
  cobertura:        string
}

export interface ComparativoGrupo {
  vehiculos:     number
  correctivos:   number
  costo:         number
  km:            number
  costo_por_mil: number | null
}

export interface PreventivoDiferido {
  con_atraso:         ComparativoGrupo
  al_corriente:       ComparativoGrupo
  sobrecosto_por_mil: number | null
}

export interface Fugas {
  ventanas: {
    merma: number; compras: number; inmovil: number
    vales: number; correctivo: number; garantia: number
  }
  /** Bloques que no se pudieron calcular, con el motivo. Vacío es que todo salió. */
  errores: string[]
  vida_por_marca:       VidaPorMarca[]
  merma:                MermaMes[]
  lotes_inmoviles:      LoteInmovil[]
  vales_sin_recarga:    ValeSinRecarga[]
  deriva_precios:       DerivaPrecio[]
  correctivos_garantia: CorrectivoEnGarantia[]
  preventivo_diferido:  PreventivoDiferido
  totales: {
    merma:                number
    capital_parado:       number
    capital_obsoleto:     number
    correctivos_garantia: number
    vales_sin_recarga:    number
  }
}

export function useFugas() {
  return useQuery({
    queryKey: ['dashboard', 'fugas'],
    queryFn: () => api.get<{ data: Fugas }>('/dashboard/fugas'),
  })
}

// ─── Facturas ────────────────────────────────────────────────────────────────
//
// Lo que el tablero sabe de las facturas de proveedores: qué falta por cuadrar,
// cuánto pudo cobrar PASE de más y qué encontró la conciliación de gasolina.
// Cada uno vive en otra pestaña, y por eso son tres consultas.

export interface BandejaFacturas {
  pendientes: number
  /** La fecha de la más vieja: es la que dice si la bandeja se atrasó. */
  mas_vieja:  string | null
}

export interface FacturasPorCuadrar {
  gasolina:    BandejaFacturas
  casetas:     BandejaFacturas
  refacciones: BandejaFacturas
  taller:      BandejaFacturas
  /** De gasolina con el total sacado de la tasa: falta capturar el IVA del papel. */
  gasolina_total_estimado: number
  tags_sin_unidad:         number
  tags_sin_unidad_monto:   number
}

export function useFacturasPorCuadrar() {
  return useQuery({
    queryKey: ['dashboard', 'facturas-por-cuadrar'],
    queryFn: () => api.get<{ data: FacturasPorCuadrar }>('/dashboard/facturas-por-cuadrar'),
  })
}

export interface FacturaConCobros {
  id:        number
  serie:     string | null
  folio:     string
  periodo:   string | null
  hasta:     string
  total:     number
  revisada:  boolean
  /** Lo que pudo cobrarse de más: la suma de sus hallazgos de cobro. */
  cobro:     number
  hallazgos: number
}

export interface HallazgoDelPeriodo {
  factura_id: number
  serie:      string | null
  folio:      string
  tipo:       TipoHallazgo
  tag:        string
  vehiculo:   string | null
  caseta:     string | null
  renglones:  number[]
  monto:      number
  detalle:    string
}

export interface CobrosCasetas {
  rango:       { start: string; end: string }
  total:       number
  por_tipo:    { tipo: TipoHallazgo; cantidad: number; monto: number }[]
  facturas:    FacturaConCobros[]
  principales: HallazgoDelPeriodo[]
  errores:     string[]
}

/** Lo que PASE pudo cobrar de más en las facturas del periodo. Con la ventana del análisis de costos. */
export function useCobrosCasetas(dias: VentanaCostos = 90) {
  return useQuery({
    queryKey: ['dashboard', 'cobros-casetas', dias],
    queryFn: () => api.get<{ data: CobrosCasetas }>(`/dashboard/cobros-casetas?dias=${dias}`),
  })
}

export interface FacturaConFaltantes {
  id:         number
  folio:      string
  gasolinera: string
  fecha:      string
  renglones:  number
  litros:     number
  /** Con IVA: lo que se le paga a la gasolinera por esas cargas. */
  monto:      number
}

export interface SinFacturarPorGasolinera {
  gasolinera_id: number
  gasolinera:    string
  tickets:       number
  costo:         number
  dias_max:      number
}

export interface OmisionesDeChofer {
  conductor_id: number
  conductor:    string
  recargas:     number
  litros:       number
  monto:        number
}

export interface OmisionesDeEncargado {
  encargado: string | null
  nombre:    string | null
  vales:     number
}

export interface CargaEnOtraGasolinera {
  factura_id:     number
  folio:          string
  /** La de la factura: donde de verdad se cargó. */
  gasolinera:     string
  conciliada:     boolean
  /** Con la que quedó capturada. */
  capturada_como: string
  fecha:          string
  litros:         number
  costo:          number
  vehiculo:       string
  conductor:      string
}

export interface ConciliacionGasolina {
  ventanas: { sin_factura: number; sin_reportar: number; otra_gasolinera: number }
  errores:  string[]
  sin_capturar: { facturas: FacturaConFaltantes[]; renglones: number; monto: number }
  sin_factura:  { gasolineras: SinFacturarPorGasolinera[]; tickets: number; costo: number }
  sin_reportar: {
    por_chofer:    OmisionesDeChofer[]
    por_encargado: OmisionesDeEncargado[]
    recargas:      number
    monto:         number
  }
  en_otra_gasolinera: CargaEnOtraGasolinera[]
}

export function useConciliacionGasolina() {
  return useQuery({
    queryKey: ['dashboard', 'conciliacion-gasolina'],
    queryFn: () => api.get<{ data: ConciliacionGasolina }>('/dashboard/conciliacion-gasolina'),
  })
}
