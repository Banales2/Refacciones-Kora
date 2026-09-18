// La revisión de las facturas contra su papel.
//
// Quien captura una compra no es quien la verifica. Después, alguien con el fajo
// de facturas originales cuadra lo que dice el papel contra lo que dice la
// pantalla, corrige lo que esté mal y lo sella para que nadie lo mueva.
//
// EL SELLO VA EN EL RENGLÓN. Una factura de quince partidas no se verifica de
// una sentada, así que cada renglón se sella solo; la cabecera —folio, fecha,
// IVA, descuento— tiene el suyo aparte. La factura está `cerrada` cuando las dos
// mitades lo están, y eso lo calcula la API: no es un campo que se guarde.
//
// Ver `db/migrations/040_revision_de_facturas.sql`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** El renglón ya estaba sellado: hay que reabrir la factura para tocarlo. */
export const RENGLON_REVISADO = 'RENGLON_REVISADO'
/** La cabecera ya estaba sellada. */
export const CABECERA_REVISADA = 'CABECERA_REVISADA'

/**
 * Todo lo que la revisión invalida.
 *
 * Es una lista larga a propósito: corregir un costo mueve el valor del
 * inventario, el gasto del proveedor y el costo de los mantenimientos que
 * consumieron ese lote. Refrescar solo la lista de facturas dejaría el resto de
 * la aplicación mostrando el número viejo.
 */
function invalidarTodo(qc: ReturnType<typeof useQueryClient>) {
  for (const key of [
    ['facturas'], ['lotes'], ['lotes-disponibles'], ['inventario-existencias'],
    ['proveedor-gastos'], ['correcciones-factura'], ['revision-errores'],
  ]) {
    qc.invalidateQueries({ queryKey: key })
  }
}

export interface RevisionResultado {
  factura_id:   number
  correcciones: number
  /** Lo que la revisión movió del total de la factura, en pesos. */
  delta_total:  number
}

export interface RenglonRevisarPayload {
  lote_id:          number
  /** Lo que el papel dice que costó cada pieza. */
  costo_unitario:   number
  /** Cuántas piezas dice el papel que entraron. */
  cantidad_inicial: number
}

/**
 * Cuadra un renglón contra el papel y lo sella.
 *
 * Los dos valores van siempre, aunque no cambien: el verificador manda LO QUE
 * DICE LA FACTURA y la API lo compara. Si mandara solo lo que cambia, un renglón
 * que nadie miró quedaría sellado como bueno.
 */
export function useRevisarRenglon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lote_id, ...body }: RenglonRevisarPayload) =>
      api.post<{ data: RevisionResultado }>(`/lotes/${lote_id}/revisar`, body),
    onSuccess: () => invalidarTodo(qc),
  })
}

export interface CabeceraRevisarPayload {
  factura_id:       number
  num_factura:      string
  fecha_compra:     string
  tasa_iva:         number | null
  descuento_pct:    number | null
  nota?:            string
  /** Corregir el folio hacia uno que ya existe fusiona las dos facturas. */
  confirmar_fusion?: boolean
}

export interface CabeceraResultado extends RevisionResultado {
  /** Se fusionó con otra factura: esta dejó de existir y no quedó sellada. */
  fusionada: boolean
}

/** Cuadra la cabecera —folio, fecha, IVA, descuento— y la sella. */
export function useRevisarCabecera() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ factura_id, ...body }: CabeceraRevisarPayload) =>
      api.post<{ data: CabeceraResultado }>(`/facturas/${factura_id}/revisar`, body),
    onSuccess: () => invalidarTodo(qc),
  })
}

/**
 * Quita los sellos de la factura para poder corregirla.
 *
 * Las correcciones ya registradas NO se borran: lo que se corrigió la primera
 * vez pasó, y si reabrir las borrara sería la forma de hacer desaparecer el
 * rastro de un error.
 */
export function useReabrirFactura() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (factura_id: number) =>
      api.post<{ data: { id: number; renglones_reabiertos: number } }>(
        `/facturas/${factura_id}/reabrir`, {},
      ),
    onSuccess: () => invalidarTodo(qc),
  })
}

/**
 * Quita el renglón que se capturó de más y no está en la factura original.
 *
 * Solo procede si nunca llegó a moverse: si sus piezas ya se montaron, se
 * consumieron o se traspasaron, la API contesta 409 nombrando qué lo detiene.
 * Y si el renglón sí se compró pero es de otra factura, no se quita — se le
 * cambia el folio para moverlo.
 */
export function useQuitarRenglon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lote_id: number) =>
      api.post<{ data: { factura_id: number | null; factura_borrada: boolean } }>(
        `/lotes/${lote_id}/quitar`, {},
      ),
    onSuccess: () => invalidarTodo(qc),
  })
}

export interface CorreccionRegistrada {
  id:            number
  lote_id:       number | null
  numero_serie:  string | null
  campo:         string
  valor_antes:   string | null
  valor_despues: string | null
  capturado_por: string | null
  delta_dinero:  number
  corregida_por: string
  corregida_en:  string
}

/** Lo que la revisión tuvo que corregirle a esta factura. */
export function useCorreccionesFactura(facturaId: number | null, enabled = true) {
  return useQuery({
    queryKey: ['correcciones-factura', facturaId],
    queryFn: () =>
      api.get<{ data: CorreccionRegistrada[] }>(`/facturas/${facturaId}/correcciones`),
    enabled: enabled && facturaId !== null,
  })
}

export interface ErroresDePersona {
  capturado_por: string | null
  correcciones:  number
  renglones:     number
  /** Suma con signo: un +500 y un −500 se cancelan. Mide la desviación del gasto. */
  neto:          number
  /** Suma de valores absolutos: esos mismos son 1,000. Mide qué tan bien captura. */
  absoluto:      number
}

/** Cuánto lleva equivocado cada quien. Solo admin: la API responde 403 al resto. */
export function useErroresCaptura(
  filtros: { desde?: string; hasta?: string } = {}, enabled = true,
) {
  return useQuery({
    queryKey: ['revision-errores', filtros],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filtros)) if (v) qs.set(k, v)
      return api.get<{ data: ErroresDePersona[] }>(`/revision/errores?${qs}`)
    },
    enabled,
  })
}

/** Cómo se llama cada campo corregido en la pantalla. */
export const NOMBRE_DE_CAMPO: Record<string, string> = {
  cantidad_inicial: 'Cantidad',
  costo_unitario:   'Costo unitario',
  folio:            'Folio',
  fecha_compra:     'Fecha',
  tasa_iva:         'IVA',
  descuento_pct:    'Descuento',
}
