// Las facturas de la gasolinera y a qué recarga corresponde cada renglón.
//
// Esto NO guarda la factura: el documento se archiva por otro lado. Aquí vive lo
// justo para comprobar que el gasto está bien capturado — descripción, cantidad
// e importe por renglón, y la tasa de IVA en la cabecera. Los importes se
// calculan, igual que en las facturas de refacciones.
//
// SE CASA POR CANTIDAD, NO POR IMPORTE. El importe del renglón suele venir sin
// IVA y el costo de la recarga es lo que se pagó en la bomba, que sí lo incluye:
// compararlos da 16% de diferencia siempre. Los litros son el mismo número de los
// dos lados.
//
// SE CASA CON EL TICKET, NO CON LA RECARGA: un tráiler carga cada tanque aparte
// y la gasolinera cobra cada ticket en su propio renglón (migración 059).
//
// Ver `docs/facturas-de-gasolina.md`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FacturaGasolinaXml } from '../lib/xmlGasolina'

/** Quedaron renglones sin casar y no se confirmó cerrar así. */
export const RENGLONES_SIN_CASAR = 'RENGLONES_SIN_CASAR'

export interface FacturaGasolina {
  id:             number
  gasolinera_id:  number
  gasolinera:     string
  folio:          string
  fecha:          string
  /** null = los importes de los renglones ya incluyen IVA. */
  tasa_iva:       number | null
  capturado_por:  string
  conciliada_en:  string | null
  conciliada_por: string | null
  nota:           string | null
  /** Cuántos renglones trae el papel. */
  renglones:      number
  /** Cuántos de esos ya casaron con una recarga. */
  casados:        number
  /** Suma de los importes de los renglones. */
  subtotal:       number
  /** El IVA del papel (migración 065). null en las capturadas antes de ella. */
  iva:            number | null
  /** Lo calcula la API: subtotal + IVA. */
  total:          number
  /**
   * El total salió de la tasa porque falta el IVA del papel. En combustible eso
   * da de más: el IVA no se cobra sobre el IEPS.
   */
  total_estimado: boolean
}

export interface RenglonFactura {
  id:             number
  descripcion:    string | null
  cantidad:       number
  /** Como lo imprime el papel: en combustible, sin IVA. */
  importe:        number
  /** Con su IVA: lo comparable con el costo del ticket, que se pagó con IVA. */
  importe_con_iva: number
  /** El IVA del renglón no viene en el papel: se repartió o salió de la tasa. */
  iva_estimado:   boolean
  ticket_id:      number | null
  recarga_id:     number | null
  recarga_fecha:  string | null
  ticket_litros:  number | null
  /** Lo que se pagó en la bomba, con IVA: se compara con `importe_con_iva`. */
  ticket_costo:   number | null
  vehiculo:       string | null
  conductor:      string | null
  vale_folio:     string | null
  /** Lo que el sistema propone para un renglón todavía sin casar. */
  sugerido_ticket_id: number | null
  /** Litros exactos, o el mismo importe con IVA y litros casi iguales. */
  sugerido_por:   'cantidad' | 'importe' | null
  /**
   * Tickets idénticos a este renglón registrados con otra gasolinera: casi
   * seguro la recarga se capturó en la estación equivocada. Solo se avisa.
   */
  en_otra_gasolinera: TicketEnOtraGasolinera[]
}

/** Un ticket de otra gasolinera idéntico a un renglón sin casar. */
export interface TicketEnOtraGasolinera {
  ticket_id:  number
  recarga_id: number
  gasolinera: string
  fecha:      string
  litros:     number
  costo:      number
  vehiculo:   string
  conductor:  string
}

/** Un ticket de recarga que algún renglón podría estar cobrando. */
export interface TicketCandidato {
  /** El del ticket: es lo que se casa. */
  id:         number
  recarga_id: number
  /** Cuál de los tickets de su recarga es, y cuántos trae. */
  ticket_n:   number
  tickets:    number
  fecha:      string
  litros:     number
  costo:      number
  vehiculo:   string
  conductor:  string
  vale_folio: string | null
  /**
   * Días que quedó registrada después de la fecha de la factura (0 si antes).
   * Se admiten unos días de gracia: la carga del sábado se registra el lunes.
   */
  dias_despues: number
}

export interface FacturasGasolinaFiltros {
  page?:          number
  pageSize?:      number
  gasolinera_id?: number
  search?:        string
  desde?:         string
  hasta?:         string
  por_conciliar?: boolean
  /** `con_faltantes`: con renglones sin casar, abiertas o ya selladas. */
  estado?:        'por_conciliar' | 'conciliada' | 'con_faltantes'
  /** Rango del total del papel, con IVA. */
  total_min?:     number
  total_max?:     number
}

interface FacturasGasolinaResponse {
  data: FacturaGasolina[]
  pagination: { page: number; pageSize: number; total: number }
  /** Lo que suman todas las que pasan el filtro, no solo la página. */
  suma: number
}

export function useFacturasGasolina(filtros: FacturasGasolinaFiltros, enabled = true) {
  return useQuery({
    queryKey: ['facturas-gasolina', filtros],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filtros)) {
        if (v !== undefined && v !== '') qs.set(k, String(v))
      }
      return api.get<FacturasGasolinaResponse>(`/facturas-gasolina?${qs}`)
    },
    enabled,
  })
}

export interface Candidatas {
  factura:   FacturaGasolina
  renglones: RenglonFactura[]
  tickets:   TicketCandidato[]
}

/** Los renglones de la factura con su propuesta, y los tickets elegibles. */
export function useCandidatas(facturaId: number | null) {
  return useQuery({
    queryKey: ['facturas-gasolina', 'candidatas', facturaId],
    queryFn: () => api.get<{ data: Candidatas }>(`/facturas-gasolina/${facturaId}/candidatas`),
    enabled: facturaId !== null,
  })
}

/** Un ticket que ninguna factura ha cobrado. */
export interface RecargaSinFacturar {
  /** El del ticket. */
  id:            number
  recarga_id:    number
  ticket_n:      number
  tickets:       number
  fecha:         string
  gasolinera_id: number
  gasolinera:    string
  litros:        number
  costo:         number
  vehiculo:      string
  conductor:     string
  vale_folio:    string | null
  /** Días desde la carga. Es lo que dice si ya se tardó la factura. */
  dias:          number
}

export interface SinFacturarFiltros {
  page?:          number
  pageSize?:      number
  gasolinera_id?: number
  search?:        string
  desde?:         string
  hasta?:         string
}

interface SinFacturarResponse {
  data: RecargaSinFacturar[]
  costo_total: number
  pagination: { page: number; pageSize: number; total: number }
}

/**
 * Las recargas que ninguna factura ha reclamado.
 *
 * Es el reverso de lo que enseña la conciliación: allá se ve lo que la
 * gasolinera cobra y no está capturado; aquí, lo que está capturado y la
 * gasolinera no ha cobrado. Casi nunca es un problema —la factura llega después
 * de la carga— pero una de hace tres meses sí lo es, y por eso cada renglón trae
 * los días que lleva esperando.
 */
export function useRecargasSinFacturar(filtros: SinFacturarFiltros, enabled = true) {
  return useQuery({
    queryKey: ['facturas-gasolina', 'sin-facturar', filtros],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filtros)) {
        if (v !== undefined && v !== '') qs.set(k, String(v))
      }
      return api.get<SinFacturarResponse>(`/facturas-gasolina/sin-facturar?${qs}`)
    },
    enabled,
  })
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['facturas-gasolina'] })
  // Las recargas cambian de "sin facturar" a "facturada", y eso se ve en las
  // listas de consumos.
  qc.invalidateQueries({ queryKey: ['recargas'] })
  qc.invalidateQueries({ queryKey: ['gasolinera-consumos'] })
}

/**
 * Lo que una gasolinera despacha, y lo único que puede decir un renglón.
 *
 * Lista cerrada y no texto libre porque son tres y no cambian: dejarlo abierto
 * solo produce "DIESEL", "diesel" y "Diésel" como si fueran cosas distintas.
 * La API valida contra esta misma lista.
 */
export const PRODUCTOS = ['Diesel', 'Magna', 'Premium'] as const
export type Producto = typeof PRODUCTOS[number]

export interface RenglonNuevo {
  descripcion: Producto
  cantidad:    number
  importe:     number
}

export interface FacturaGasolinaCreatePayload {
  gasolinera_id: number
  folio:         string
  fecha:         string
  /**
   * El IVA como lo imprime el papel. No la tasa: en combustible el IVA no se
   * cobra sobre el IEPS, así que no es el 16% del subtotal. Ver la migración 065.
   */
  iva:           number
  renglones:     RenglonNuevo[]
}

export function useCrearFacturaGasolina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FacturaGasolinaCreatePayload) =>
      api.post<{ data: { id: number } }>('/facturas-gasolina', body),
    onSuccess: () => invalidar(qc),
  })
}

/** Ya se importó una factura con ese folio fiscal. */
export const FACTURA_DUPLICADA = 'FACTURA_DUPLICADA'

/**
 * Importa la factura leída de su XML (ver `lib/xmlGasolina.ts`). La API reconoce
 * la gasolinera por el permiso de la estación; `gasolinera_id` solo se manda la
 * primera vez, cuando el permiso no es de nadie, y entonces se le queda.
 */
export function useImportarFacturaGasolina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ factura, gasolinera_id }: { factura: FacturaGasolinaXml; gasolinera_id?: number }) =>
      api.post<{ data: { id: number; gasolinera: string; ligada: boolean } }>(
        '/facturas-gasolina/importar',
        {
          uuid: factura.uuid, serie: factura.serie, folio: factura.folio, fecha: factura.fecha,
          permiso_cre: factura.permiso_cre, emisor_rfc: factura.emisor_rfc, gasolinera_id,
          subtotal: factura.subtotal, iva: factura.iva, total: factura.total,
          renglones: factura.renglones,
        },
      ),
    onSuccess: () => {
      invalidar(qc)
      // El permiso pudo quedar ligado a la gasolinera.
      qc.invalidateQueries({ queryKey: ['gasolineras'] })
    },
  })
}

/** Corrige con el papel el IVA de una factura capturada con tasa. */
export function useCorregirIvaFactura() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, iva }: { id: number; iva: number }) =>
      api.put<{ data: { id: number } }>(`/facturas-gasolina/${id}/iva`, { iva }),
    onSuccess: () => invalidar(qc),
  })
}

export interface ConciliarPayload {
  factura_id: number
  /** El conjunto COMPLETO, con los renglones sin casar y su ticket en null. */
  casados: { renglon_id: number; ticket_id: number | null }[]
  nota?: string
  /** Sellar aunque queden renglones sin casar. Sin esto la API responde 409. */
  confirmar_sin_casar?: boolean
}

export interface ResultadoConciliacion {
  factura_id:        number
  renglones:         number
  casados:           number
  /** Renglones del papel que no corresponden a ninguna recarga capturada. */
  sin_casar:         number
  /** Lo que valen: el gasto que no está registrado. */
  importe_sin_casar: number
  cantidad_sin_casar: number
}

/** Guarda los casados y sella la factura. Solo admin. */
export function useConciliar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ factura_id, ...body }: ConciliarPayload) =>
      api.post<{ data: ResultadoConciliacion }>(
        `/facturas-gasolina/${factura_id}/conciliar`, body,
      ),
    onSuccess: () => invalidar(qc),
  })
}

/**
 * Suelta el sello para volver a cuadrar.
 *
 * Los casados no se deshacen: al reabrir solo hay que ajustar lo que faltaba. Es
 * lo que hace falta cuando aparece la recarga que no estaba.
 */
export function useReabrirFacturaGasolina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (facturaId: number) =>
      api.post<{ data: { id: number } }>(`/facturas-gasolina/${facturaId}/reabrir`, {}),
    onSuccess: () => invalidar(qc),
  })
}

// ── Registrar desde la factura ────────────────────────────────────────────────

/**
 * La recarga que el chofer no reportó, dada de alta desde el renglón que la
 * cobra. El vale es el que ya estaba (`vale_id`) o el que el encargado tampoco
 * registró (`vale_nuevo`). Ver la migración 069.
 */
export interface RegistrarDesdeFacturaPayload {
  vale_id?: number
  vale_nuevo?: { folio: string; sucursal_id?: number; fecha: string; creado_por?: string }
  vehiculo_id:  number
  conductor_id: number
  fecha:        string
  litros:       number
  costo:        number
  kilometraje?: number | null
  producto?:    'Magna' | 'Premium'
}

export interface Registrada {
  recarga_id: number
  vale_id:    number
  ticket_id:  number
  vale_nuevo: boolean
}

/** Solo admin, y solo en una factura abierta. La recarga queda casada con el renglón. */
export function useRegistrarDesdeFactura() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ factura_id, renglon_id, ...body }:
      RegistrarDesdeFacturaPayload & { factura_id: number; renglon_id: number }) =>
      api.post<{ data: Registrada }>(
        `/facturas-gasolina/${factura_id}/renglones/${renglon_id}/registrar`, body,
      ),
    onSuccess: () => {
      invalidar(qc)
      qc.invalidateQueries({ queryKey: ['vales-gasolina'] })
      qc.invalidateQueries({ queryKey: ['vehiculos'] })
    },
  })
}

/**
 * Una recarga que el chofer no reportó y salió al cuadrar la factura. Si
 * `vale_sin_registrar`, el encargado tampoco registró el vale.
 */
export interface SinReportar {
  recarga_id:   number
  fecha:        string
  litros:       number
  costo:        number
  producto:     string | null
  vehiculo:     string
  placas:       string | null
  conductor_id: number
  conductor:    string
  gasolinera:   string | null
  factura_id:   number
  factura_folio: string
  vale_id:      number | null
  vale_folio:   string | null
  vale_fecha:   string | null
  vale_sin_registrar: boolean
  encargado:        string | null
  encargado_nombre: string | null
  sucursal:     string | null
  capturado_por: string | null
}

export function useSinReportar(filtros: { desde?: string; hasta?: string }, enabled = true) {
  return useQuery({
    queryKey: ['facturas-gasolina', 'sin-reportar', filtros],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (filtros.desde) qs.set('desde', filtros.desde)
      if (filtros.hasta) qs.set('hasta', filtros.hasta)
      return api.get<{ data: SinReportar[] }>(`/facturas-gasolina/sin-reportar?${qs}`)
    },
    enabled,
  })
}

// ── Buscar por vale ───────────────────────────────────────────────────────────

export interface FacturaDelTicket {
  factura_id: number
  folio:      string
  fecha:      string
  conciliada: boolean
}

export interface TicketDelVale {
  ticket_id: number
  ticket_n:  number
  tickets:   number
  litros:    number
  costo:     number
  /** La factura cuyo renglón ya está casado con este ticket. */
  casado_en: FacturaDelTicket | null
  /** Si nadie lo ha casado: las abiertas de su gasolinera con un renglón libre que la propuesta le daría. */
  posibles:  FacturaDelTicket[]
}

export interface ValeEncontrado {
  vale_id:       number
  folio:         string
  estado:        'creado' | 'usado' | 'perdido' | 'archivado'
  fecha:         string
  conductor:     string
  vehiculo:      string
  recarga_id:    number | null
  recarga_fecha: string | null
  gasolinera:    string | null
  emergencia:    boolean
  tickets:       TicketDelVale[]
}

/** Con el vale en la mano: su recarga y la factura que la cobra. */
export function useBuscarPorVale(texto: string) {
  const q = texto.trim()
  return useQuery({
    queryKey: ['facturas-gasolina', 'por-vale', q],
    queryFn: () => api.get<{ data: ValeEncontrado[] }>(
      `/facturas-gasolina/por-vale?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  })
}
