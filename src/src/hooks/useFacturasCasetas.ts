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
}

export type TipoHallazgo =
  | 'cobrado_antes' | 'doble_cobro' | 'clase_mayor' | 'ajuste' | 'fuera_de_periodo'
  | 'tag_sin_unidad' | 'caseta_inusual'

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
