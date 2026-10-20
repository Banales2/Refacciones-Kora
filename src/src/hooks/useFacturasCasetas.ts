// Las facturas de casetas de PASE, sus cruces y el catálogo de tags.
//
// La factura se importa del XML (ver `lib/xmlPase.ts`) y la API comprueba que
// los cruces sumen el total impreso antes de guardar. Aquí no se casa contra
// nada capturado: lo que se revisa son los hallazgos que la API saca del
// documento y de la historia de cada tag.
//
// Ver `db/migrations/064_facturas_de_casetas.sql`.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FacturaPase } from '../lib/xmlPase'

/** Ya se importó una factura con ese folio fiscal. */
export const FACTURA_DUPLICADA = 'FACTURA_DUPLICADA'

export interface FacturaCasetas {
  id:                number
  uuid:              string
  serie:             string | null
  folio:             string
  fecha_emision:     string
  fecha_limite_pago: string | null
  periodo:           string | null
  periodo_desde:     string | null
  periodo_hasta:     string | null
  subtotal:          number
  iva:               number
  total:             number
  capturado_por:     string
  revisada_en:       string | null
  revisada_por:      string | null
  nota:              string | null
  cruces:            number
  /** Cruces de tags que nadie ha ligado a una unidad. */
  sin_unidad:        number
  unidades:          number
}

export interface CruceCaseta {
  id:            number
  renglon:       number
  tag:           string
  vehiculo_id:   number | null
  vehiculo:      string | null
  tipo_vehiculo: string | null
  fecha_hora:    string
  evento:        string | null
  carril:        string | null
  caseta:        string
  descripcion:   string
  clase:         number
  importe:       number
  iva:           number
  total:         number
  /** El tramo que su importe identifica; null si la caseta no tiene tarifa cargada. */
  tramo:         string | null
}

export type TipoHallazgo =
  | 'cobrado_antes' | 'fuera_de_tarifa' | 'doble_cobro' | 'clase_en_recorrido' | 'clase_mayor'
  | 'clase_atipica' | 'ajuste' | 'corregido' | 'fuera_de_periodo' | 'tag_sin_unidad' | 'caseta_inusual'

export interface Hallazgo {
  tipo:      TipoHallazgo
  /** `cobro`: lo que PASE pudo cobrar de más. `uso`: cómo se usan las unidades. */
  grupo:     'cobro' | 'uso'
  renglones: number[]
  tag:       string
  vehiculo:  string | null
  caseta:    string | null
  monto:     number
  detalle:   string
  /** Solo en `cobrado_antes`: el mismo cruce en las otras facturas, de la más vieja a la más nueva. */
  otras?:    CruceEnOtra[]
  /** Solo en `ajuste`: el cruce que corrige, cuando se encontró. */
  corrige?:  CorreccionDeClase
  /** Solo en `corregido`: la factura donde vino el ajuste. */
  ajuste_en?: { factura_id: number; serie: string | null; folio: string }
  /** Solo en `clase_en_recorrido`: el recorrido entero, para ver qué cobraron las demás. */
  recorrido?: Recorrido
}

/**
 * Los cruces seguidos de un tag (menos de tres horas entre uno y otro). Sirve
 * para comparar cada caseta contra las demás del mismo viaje.
 */
export interface Recorrido {
  tag:      string
  vehiculo: string | null
  /** La clase que cobró la mayoría de las casetas; null si no hay mayoría. */
  clase:    number | null
  pasos:    PasoRecorrido[]
}

export interface PasoRecorrido {
  /** La partida en esta factura; null si el cruce vino en otra. */
  renglon:     number | null
  otra:        { factura_id: number; serie: string | null; folio: string; renglon: number } | null
  fecha_hora:  string
  caseta:      string
  descripcion: string
  clase:       number
  total:       number
  /** La caseta no manda la clase real (EASYTRIP). */
  sin_clase:   boolean
  /** Cobró una clase arriba de la del recorrido. */
  arriba:      boolean
}

export interface CorreccionDeClase {
  factura_id:     number
  serie:          string | null
  folio:          string
  misma_factura:  boolean
  renglon:        number
  fecha_hora:     string
  clase:          number
  total:          number
  /** Con tarifa: el tramo y las clasificaciones de antes y después; sin tarifa, null. */
  tramo:          string | null
  de:             string | null
  a:              string | null
  /** Original + ajuste. */
  suma:           number
  clase_habitual: number | null
  /** Lo que debió quedar según la clase que el tag suele pagar ahí; null si no hay historia. */
  esperado:       number | null
  segun:          'tarifa' | 'historial' | null
}

export interface CruceEnOtra {
  factura_id:    number
  serie:         string | null
  folio:         string
  periodo:       string | null
  fecha_emision: string
  /** Si la otra se emitió antes que esta. */
  anterior:      boolean
  revisada:      boolean
  renglon:       number
  fecha_hora:    string
  clase:         number
  total:         number
}

export interface ResumenUnidad {
  vehiculo_id:   number | null
  vehiculo:      string | null
  tipo_vehiculo: string | null
  tags:          string[]
  cruces:        number
  total:         number
  casetas:       number
}

export interface DetalleFacturaCasetas {
  factura:    FacturaCasetas
  cruces:     CruceCaseta[]
  hallazgos:  Hallazgo[]
  por_unidad: ResumenUnidad[]
  /** Las casetas de la factura sin tarifa cargada: lo que no se pudo revisar contra precio. */
  sin_tarifa: CasetaSinTarifa[]
  /** Los recorridos de cada tag que tocan esta factura, del más viejo al más nuevo. */
  recorridos: Recorrido[]
}

export interface CasetaSinTarifa {
  caseta:      string
  descripcion: string
  cruces:      number
  total:       number
}

export interface TagCaseta {
  id:            number
  tag:           string
  vehiculo_id:   number | null
  vehiculo:      string | null
  tipo_vehiculo: string | null
  nota:          string | null
  cruces:        number
  total:         number
  ultimo_cruce:  string | null
}

interface Lista<T> {
  data: T[]
  pagination: { page: number; pageSize: number; total: number }
}

export function useFacturasCasetas(f: {
  page: number; pageSize: number; search?: string; por_revisar?: boolean
}) {
  return useQuery({
    queryKey: ['facturas-casetas', f],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(f.page), pageSize: String(f.pageSize) })
      if (f.search) qs.set('search', f.search)
      if (f.por_revisar) qs.set('por_revisar', '1')
      return api.get<Lista<FacturaCasetas>>(`/facturas-casetas?${qs}`)
    },
    placeholderData: keepPreviousData,
  })
}

export function useFacturaCasetas(id: number | null) {
  return useQuery({
    queryKey: ['facturas-casetas', 'detalle', id],
    queryFn: () => api.get<{ data: DetalleFacturaCasetas }>(`/facturas-casetas/${id}`),
    enabled: id !== null,
  })
}

/** Todo lo que cambia cuando entra una factura o se le pone unidad a un tag. */
function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['facturas-casetas'] })
  qc.invalidateQueries({ queryKey: ['tags-casetas'] })
  // Lo cobrado en cada caseta cambia con cada factura.
  qc.invalidateQueries({ queryKey: ['tarifas-casetas'] })
}

/** Lo leído del XML, sin lo que solo sirve para la vista previa. */
export function useImportarFacturaCasetas() {
  const qc = useQueryClient()
  return useMutation({
    // Cientos de cruces en una transacción: el tope normal de 30 s podría
    // cortarla en el cliente mientras el servidor la termina.
    mutationFn: (f: FacturaPase) =>
      api.post<{ data: { id: number } }>('/facturas-casetas', {
        uuid: f.uuid, serie: f.serie, folio: f.folio,
        fecha_emision: f.fecha_emision, fecha_limite_pago: f.fecha_limite_pago,
        periodo: f.periodo, periodo_desde: f.periodo_desde, periodo_hasta: f.periodo_hasta,
        subtotal: f.subtotal, iva: f.iva, total: f.total, cruces: f.cruces,
      }, 120_000),
    onSuccess: () => invalidar(qc),
  })
}

export function useRevisarFacturaCasetas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, nota }: { id: number; nota?: string }) =>
      api.post(`/facturas-casetas/${id}/revisar`, { nota }),
    onSuccess: () => invalidar(qc),
  })
}

export function useReabrirFacturaCasetas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post(`/facturas-casetas/${id}/reabrir`, {}),
    onSuccess: () => invalidar(qc),
  })
}

export interface TarifaTramo {
  /** La vigencia que se muestra: es la que se corrige al editar. */
  tarifa_id:     number
  /** Cuántas vigencias tiene el tramo en total. */
  vigencias:     number
  /** Las casetas de PASE que cobran este tramo: editarlo les cambia a todas. */
  casetas:       string[]
  tramo_id:      number
  autopista:     string
  tramo:         string
  vigente_desde: string
  moto:          number | null
  auto:          number | null
  autobus_2:     number | null
  autobus_3:     number | null
  autobus_4:     number | null
  camion_2:      number | null
  camion_3:      number | null
  camion_4:      number | null
  camion_5:      number | null
  camion_6:      number | null
  camion_7:      number | null
  camion_8:      number | null
  camion_9:      number | null
  eje_ligero:    number | null
  eje_pesado:    number | null
}

export interface ImporteCobrado {
  clase:  number
  total:  number
  cruces: number
  /** Los tramos que cuestan eso para esa clase; vacío = fuera de tarifa. */
  tramos: string[]
  /** En las casetas sin clase real: cuántos ejes dice el importe que se cobraron. */
  ejes:   string | null
  /** Fuera de tarifa: la tarifa de hoy más parecida para su clase. */
  cercana:      TarifaCercana | null
  /** Fuera de tarifa: la más parecida de cualquier clasificación, si no es la misma. */
  cercana_otra: TarifaCercana | null
}

/** La tarifa más parecida a un importe que no es de ningún tramo. */
export interface TarifaCercana {
  tramo:         string
  /** Las clasificaciones que pagan ese importe: "camión 2-4 ejes". */
  clases:        string
  total:         number
  vigente_desde: string
}

/** Un cruce cobrado con cierto importe, revisado contra la tarifa de su fecha. */
export interface CruceCobrado {
  factura_id:   number
  serie:        string | null
  folio:        string
  periodo:      string | null
  revisada:     boolean
  renglon:      number
  fecha_hora:   string
  tag:          string
  vehiculo:     string | null
  carril:       string | null
  evento:       string | null
  clase:        number
  total:        number
  /** Los tramos que cuestan eso el día que cruzó; vacío = fuera de tarifa. */
  tramos:       string[]
  cercana:      TarifaCercana | null
  cercana_otra: TarifaCercana | null
}

/** Los cruces de una caseta cobrados con esa clase y ese importe: rastrear un fuera de tarifa. */
export function useCrucesDeImporte(q: { caseta: string; clase: number; total: number } | null) {
  return useQuery({
    queryKey: ['tarifas-casetas', 'cruces', q],
    queryFn: () => {
      const qs = new URLSearchParams({ clase: String(q!.clase), total: String(q!.total) })
      return api.get<{ data: CruceCobrado[] }>(
        `/tarifas-casetas/${encodeURIComponent(q!.caseta)}/cruces?${qs}`)
    },
    enabled: q !== null,
  })
}

export interface TarifasDeCaseta {
  caseta:   string
  nombre:   string | null
  /** La caseta no manda la clase real (EASYTRIP manda 1 a todo). */
  ignora_clase: boolean
  cruces:   number
  total:    number
  tramos:   TarifaTramo[]
  cobrados: ImporteCobrado[]
}

/** Las casetas con sus tarifas de hoy y lo cobrado en cada una. */
export function useTarifasCasetas() {
  return useQuery({
    queryKey: ['tarifas-casetas'],
    queryFn: () => api.get<{ data: TarifasDeCaseta[] }>('/tarifas-casetas'),
  })
}

/** Los precios de una vigencia; null = el operador no publica esa clasificación. */
export interface ValoresTarifa {
  vigente_desde: string
  moto:          number | null
  auto:          number | null
  autobus_2:     number | null
  autobus_3:     number | null
  autobus_4:     number | null
  camion_2:      number | null
  camion_3:      number | null
  camion_4:      number | null
  camion_5:      number | null
  camion_6:      number | null
  camion_7:      number | null
  camion_8:      number | null
  camion_9:      number | null
  eje_ligero:    number | null
  eje_pesado:    number | null
}

export interface TramoCaseta {
  id:        number
  autopista: string
  nombre:    string
  /** Las casetas de PASE que lo cobran; vacío = cargado sin caseta todavía. */
  casetas:   string[]
}

export function useTramosCasetas(enabled = true) {
  return useQuery({
    queryKey: ['tarifas-casetas', 'tramos'],
    queryFn: () => api.get<{ data: TramoCaseta[] }>('/tramos-casetas'),
    enabled,
  })
}

/** Liga un tramo que ya existe a una caseta. */
export function useLigarTramoCaseta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { caseta: string; tramo_id: number }) =>
      api.post<{ data: { caseta: string; tramo_id: number } }>('/casetas-tramos', body),
    onSuccess: () => invalidarTarifas(qc),
  })
}

// Cambiar una tarifa cambia los hallazgos de todas las facturas, no solo la
// pestaña de tarifas.
function invalidarTarifas(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['tarifas-casetas'] })
  qc.invalidateQueries({ queryKey: ['facturas-casetas'] })
}

/** Corregir una vigencia que ya existe. */
export function useActualizarTarifaCaseta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: ValoresTarifa & { id: number }) =>
      api.put<{ data: { id: number } }>(`/tarifas-casetas/${id}`, body),
    onSuccess: () => invalidarTarifas(qc),
  })
}

/** Un aumento: una vigencia nueva del tramo. */
export function useCrearTarifaCaseta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ValoresTarifa & { tramo_id: number }) =>
      api.post<{ data: { id: number } }>('/tarifas-casetas', body),
    onSuccess: () => invalidarTarifas(qc),
  })
}

/** Un tramo nuevo para una caseta, con su primera tarifa. */
export function useCrearTramoCaseta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ValoresTarifa & { autopista: string; nombre: string; casetas: string[] }) =>
      api.post<{ data: { tramo_id: number; tarifa_id: number } }>('/tramos-casetas', body),
    onSuccess: () => invalidarTarifas(qc),
  })
}

/** Marca que una caseta no manda la clase real: se compara contra todas las clasificaciones. */
export function useIgnoraClaseCaseta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ caseta, ignora_clase }: { caseta: string; ignora_clase: boolean }) =>
      api.put<{ data: { caseta: string; ignora_clase: boolean } }>(`/casetas-pase/${caseta}`, { ignora_clase }),
    onSuccess: () => invalidarTarifas(qc),
  })
}

export function useTagsCasetas() {
  return useQuery({
    queryKey: ['tags-casetas'],
    queryFn: () => api.get<{ data: TagCaseta[] }>('/tags-casetas'),
  })
}

export function useCrearTagCaseta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { tag: string; vehiculo_id: number | null; nota?: string | null }) =>
      api.post<{ data: { id: number } }>('/tags-casetas', body),
    onSuccess: () => invalidar(qc),
  })
}

/** Devuelve cuántos cruces sin unidad quedaron ligados a la nueva. */
export function useActualizarTagCaseta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; vehiculo_id: number | null; nota?: string | null }) =>
      api.put<{ data: { id: number; cruces_ligados: number } }>(`/tags-casetas/${id}`, body),
    onSuccess: () => invalidar(qc),
  })
}
