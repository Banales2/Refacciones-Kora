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
  /** En cuántos días naturales surte ese proveedor. Null si no se capturó. */
  tiempo_entrega_dias: number | null
  observaciones:  string | null
  registrado_por: string
  pieza_serie:    string
  pieza:          string
  tipo_pieza:     string | null
  /** El precio más reciente que este proveedor tiene para esta refacción. */
  vigente:        boolean
  /** El más barato entre los precios vigentes de todos los proveedores. */
  mejor_precio:       number | null
  mejor_proveedor_id: number | null
  mejor_proveedor:    string | null
  /** Cuántos proveedores tienen precio registrado para esta refacción. */
  proveedores_con_precio: number
}

export interface PrecioProveedorPayload {
  pieza_id:       number
  precio:         number
  fecha:          string
  tiempo_entrega_dias?: number | null
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
  precio:       number
  fecha:        string
  /** Días naturales en que surte ese proveedor. Null si no se capturó. */
  tiempo_entrega_dias: number | null
  /** Cuánto más caro es que el mejor precio de esa refacción, en porcentaje. */
  sobre_mejor:  number
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
  /** El plazo más corto entre los proveedores que lo capturaron. */
  mejor_entrega:           number | null
  mejor_entrega_proveedor: string | null
}

export interface ComparativaPrecios {
  proveedores: { id: number; nombre: string }[]
  piezas:      FilaComparativa[]
  totales: {
    refacciones:           number
    comparables:           number
    ahorro_unitario_total: number
  }
}

export function useComparativaPrecios() {
  return useQuery({
    queryKey: ['precios-proveedor', 'comparativa'],
    queryFn: () => api.get<{ data: ComparativaPrecios }>('/precios-proveedor/comparativa'),
  })
}

// ─── Comparativa de una refacción ───────────────────────────────────────────
// La de arriba es el catálogo entero; ésta es la de una sola pieza, que es la
// pregunta que se hace al abrirla ("¿a quién le compro ésta?"). Se pide aparte
// para no traerse la tabla completa cada vez que se abre una refacción.

export interface ComparativaPieza {
  pieza: {
    id:           number
    numero_serie: string
    descripcion:  string
    tipo_pieza:   string | null
  }
  /** Null cuando ningún proveedor la cotiza todavía. */
  fila: FilaComparativa | null
}

export function useComparativaPieza(piezaId: number | null) {
  return useQuery({
    queryKey: ['precios-proveedor', 'pieza', piezaId],
    queryFn: () => api.get<{ data: ComparativaPieza }>(`/piezas/${piezaId}/comparativa-precios`),
    enabled: piezaId != null,
  })
}
