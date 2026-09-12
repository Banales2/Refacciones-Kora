// Precios de refacciones cotizados con un proveedor.
//
// A diferencia de los lotes (lo que ya se compró), esto es lo que un proveedor
// pide por una refacción, se le compre o no: es la libreta con la que se
// comparan precios antes de decidir dónde comprar. Cada registro es una
// cotización con su fecha, así que la lista es histórica; el más reciente de
// cada refacción es el que vale hoy (`vigente`).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface PrecioProveedor {
  id:             number
  proveedor_id:   number
  pieza_id:       number
  precio:         number
  fecha:          string
  observaciones:  string | null
  registrado_por: string
  /**
   * Lo que costaría de verdad esta cotización con el descuento de referencia.
   * Es el número con el que se compara contra los demás; `precio` es el de
   * lista, que es como lo manda el proveedor.
   */
  precio_comparable: number
  /** El descuento con el que se calculó `precio_comparable`, en por ciento. */
  descuento_referencia: number
  pieza_serie:    string
  pieza:          string
  tipo_pieza:     string | null
  /** El precio más reciente que este proveedor tiene para esta refacción. */
  vigente:        boolean
  /**
   * El más barato de esta refacción entre todos los proveedores, ya comparable:
   * puede salir de una cotización o de lo que se le paga a quien ya se le compra.
   */
  mejor_precio:       number | null
  mejor_proveedor_id: number | null
  mejor_proveedor:    string | null
  /** De dónde salió ese mejor precio. */
  mejor_origen:       'cotizado' | 'pagado' | null
  /** Cuántos proveedores tienen precio —cotizado o pagado— para esta refacción. */
  proveedores_con_precio: number
}

export interface PrecioProveedorPayload {
  pieza_id:       number
  precio:         number
  fecha:          string
  observaciones?: string | null
}

// La refacción no se cambia al editar: eso sería otro registro.
export type PrecioProveedorUpdatePayload = Omit<PrecioProveedorPayload, 'pieza_id'>

export function usePreciosProveedor(proveedorId: number | null) {
  return useQuery({
    queryKey: ['precios-proveedor', proveedorId],
    queryFn: () => api.get<{ data: PrecioProveedor[] }>(`/proveedores/${proveedorId}/precios`),
    enabled: proveedorId != null,
  })
}

// Un precio nuevo cambia la comparativa de esa refacción, que se ve también
// desde la página de los demás proveedores: se invalida la clave completa.
function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['precios-proveedor'] })
}

export function useCreatePrecioProveedor(proveedorId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PrecioProveedorPayload) =>
      api.post<{ data: PrecioProveedor }>(`/proveedores/${proveedorId}/precios`, payload),
    onSuccess: () => invalidar(qc),
  })
}

export function useUpdatePrecioProveedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: PrecioProveedorUpdatePayload }) =>
      api.put<{ data: PrecioProveedor }>(`/precios-proveedor/${id}`, payload),
    onSuccess: () => invalidar(qc),
  })
}

export function useDeletePrecioProveedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/precios-proveedor/${id}`),
    onSuccess: () => invalidar(qc),
  })
}

// ─── Comparativa global ──────────────────────────────────────────────────────
// La lista de arriba es lo que cotiza *un* proveedor. Esto es la tabla completa
// —cada refacción con el precio vigente de todos los que la cotizan— que es lo
// que se necesita para decidir a quién comprarle y para el reporte de compras.

export interface PrecioDeProveedor {
  proveedor_id: number
  proveedor:    string
  /** Ya con descuento. Es el que ordena y con el que se calcula todo. */
  precio:       number
  /** Si sale de lo que el proveedor cotiza o de lo que ya se le pagó. */
  origen:       'cotizado' | 'pagado'
  /** Lo que dice el papel, antes del descuento. */
  precio_lista: number
  /** El descuento aplicado para llegar a `precio`. */
  descuento_pct: number | null
  /**
   * El descuento no salió de ninguna factura: es el de referencia. Siempre en
   * las cotizaciones, porque el proveedor cotiza lista y descuenta después.
   */
  estimado:     boolean
  fecha:        string
  /** Cuánto más caro es que el mejor precio de esa refacción, en porcentaje. */
  sobre_mejor:  number
  /**
   * Cómo llegó este proveedor a este precio. Con un solo proveedor en el
   * catálogo no hay columnas que comparar, y lo único que queda por mirar
   * —lo que de verdad se pregunta— es si el precio se movió y cuándo.
   *
   * `registros` cuenta facturas, no renglones: la misma refacción viene
   * repetida en varias partidas del mismo papel.
   */
  registros:        number
  precio_anterior:  number | null
  fecha_anterior:   string | null
  /** Contra el registro anterior. Positivo = subió. Null si no hay con qué. */
  cambio_pct:       number | null
  /** El registro más viejo de esta fuente, para leer el recorrido entero. */
  precio_primero:   number
  fecha_primera:    string
  /** Del primero al vigente. Null cuando solo hay un registro. */
  cambio_total_pct: number | null
  /** La otra fuente del mismo proveedor, si la tiene: cotiza Y se le compra. */
  otro:         { origen: 'cotizado' | 'pagado'; precio: number; fecha: string } | null
}

export interface FilaComparativa {
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  tipo_pieza:       string | null
  precios:          PrecioDeProveedor[]
  mejor_precio:     number
  mejor_proveedor:  string
  peor_precio:      number
  peor_proveedor:   string
  diferencia:       number
  diferencia_pct:   number
  ultimo_pagado:    number | null
  ultimo_proveedor: string | null
  ultima_compra:    string | null
  ahorro_unitario:  number | null
  /** La mayor subida de precio entre sus proveedores, contra el registro previo. */
  alza_pct:                number | null
}

export interface ComparativaPrecios {
  proveedores: { id: number; nombre: string }[]
  piezas:      FilaComparativa[]
  /** El supuesto con el que se estimó el neto de las cotizaciones. */
  descuento_referencia: number
  totales: {
    refacciones:           number
    comparables:           number
    /** Cuántas subieron de precio contra el registro anterior de su proveedor. */
    con_alza:              number
    ahorro_unitario_total: number
  }
}

/**
 * `descuentoRef` es el descuento que se supone sobre una cotización para poder
 * compararla contra compras que ya vienen descontadas. Ausente = el de
 * referencia del servidor (10%). No se guarda: es un supuesto de quien lee la
 * tabla, y por eso viaja en la consulta y entra en la clave de caché.
 */
export function useComparativaPrecios(descuentoRef?: number) {
  return useQuery({
    queryKey: ['precios-proveedor', 'comparativa', descuentoRef ?? null],
    queryFn: () => api.get<{ data: ComparativaPrecios }>(
      `/precios-proveedor/comparativa${descuentoRef == null ? '' : `?descuento_ref=${descuentoRef}`}`),
  })
}

// ─── Comparativa de una refacción ───────────────────────────────────────────
// La de arriba es el catálogo entero; ésta es la de una sola pieza, que es la
// pregunta que se hace al abrirla ("¿a quién le compro ésta?"). Se pide aparte
// para no traerse la tabla completa cada vez que se abre una refacción.

/**
 * Un registro de precio suelto: una compra o una cotización, con su fecha. Es
 * el grano que la comparativa resume —ahí cada proveedor aparece una vez, con
 * lo último— y lo que hace falta para ver cómo se ha movido el costo.
 */
export interface RegistroPrecio {
  proveedor_id:  number
  proveedor:     string
  origen:        'cotizado' | 'pagado'
  fecha:         string
  /** Ya con descuento: es el que se puede comparar con los demás. */
  precio:        number
  precio_lista:  number
  descuento_pct: number | null
  /** Solo en compras: de qué factura salió y cuántas piezas entraron a ese precio. */
  folio:         string | null
  cantidad:      number | null
}

export interface ComparativaPieza {
  pieza: {
    id:           number
    numero_serie: string
    descripcion:  string
    tipo_pieza:   string | null
  }
  /** Null cuando nadie la cotiza y nunca se ha comprado. */
  fila: FilaComparativa | null
  /**
   * Cada compra y cada cotización, de lo más viejo a lo más nuevo. `fila` dice
   * en cuánto está hoy con cada proveedor; esto, cómo llegó ahí.
   */
  historial: RegistroPrecio[]
  /** El supuesto con el que se estimó el neto de las cotizaciones. */
  descuento_referencia: number
}

export function useComparativaPieza(piezaId: number | null) {
  return useQuery({
    queryKey: ['precios-proveedor', 'pieza', piezaId],
    queryFn: () => api.get<{ data: ComparativaPieza }>(`/piezas/${piezaId}/comparativa-precios`),
    enabled: piezaId != null,
  })
}
