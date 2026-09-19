// El cuadre de una factura de refacciones: el papel contra lo capturado.
//
// Se transcribe lo que dice la factura —renglón por renglón, con la refacción
// del catálogo— y el sistema lo compara contra los lotes registrados. Con las
// dos listas, las tres preguntas se contestan solas:
//
//   renglón del papel sin lote      → nadie capturó esa compra
//   lote sin renglón del papel      → se capturó algo que el papel no trae
//   los dos, con valores distintos  → error de captura, y se sabe de cuánto
//
// Ver `db/migrations/044_renglones_de_la_factura.sql`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** Quedan desajustes sin resolver y no se confirmó cerrar así. */
export const CUADRE_INCOMPLETO = 'CUADRE_INCOMPLETO'

export type TipoDiferencia = 'falta_capturar' | 'sobra_capturado' | 'valores'

export interface ValoresRenglon {
  cantidad:       number
  costo_unitario: number
  importe:        number
}

export interface Diferencia {
  tipo:          TipoDiferencia
  renglon_id:    number | null
  lote_id:       number | null
  pieza_id:      number
  numero_serie:  string
  descripcion:   string
  /** Lo que dice el papel. null cuando el papel no lo trae. */
  papel:         ValoresRenglon | null
  /** Lo que está capturado. null cuando nadie lo capturó. */
  sistema:       ValoresRenglon | null
  /** Lo que el desajuste vale en el total, ya con descuento e IVA. */
  delta_dinero:  number
  capturado_por: string | null
}

export interface RenglonPapel {
  id:                 number
  pieza_id:           number
  numero_serie:       string
  descripcion:        string
  cantidad:           number
  costo_unitario:     number
  lote_id:            number | null
  lote_cantidad:      number | null
  lote_costo:         number | null
  lote_capturado_por: string | null
}

export interface LoteDeFactura {
  lote_id:          number
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  cantidad_inicial: number
  costo_unitario:   number
  sucursal_id:      number | null
  sucursal:         string | null
  capturado_por:    string | null
  renglon_id:       number | null
}

export interface Cuadre {
  factura: {
    id:                   number
    folio:                string
    fecha_compra:         string
    tasa_iva:             number | null
    descuento_pct:        number | null
    subtotal:             number
    cabecera_revisada_en: string | null
  }
  renglones:          RenglonPapel[]
  lotes:              LoteDeFactura[]
  diferencias:        Diferencia[]
  subtotal_papel:     number
  subtotal_sistema:   number
  /** Total del papel menos total capturado, ya con descuento e IVA. */
  delta_total:        number
  sin_capturar_papel: boolean
}

export function useCuadre(facturaId: number | null) {
  return useQuery({
    queryKey: ['factura-cuadre', facturaId],
    queryFn: () => api.get<{ data: Cuadre }>(`/facturas/${facturaId}/cuadre`),
    enabled: facturaId !== null,
  })
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  for (const key of [
    ['factura-cuadre'], ['facturas'], ['lotes'], ['lotes-disponibles'],
    ['inventario-existencias'], ['proveedor-gastos'],
    ['correcciones-factura'], ['revision-errores'], ['revision-correcciones'],
  ]) {
    qc.invalidateQueries({ queryKey: key })
  }
}

export interface RenglonPapelPayload {
  /** Una del catálogo o una nueva, nunca las dos. */
  pieza_id?:       number
  pieza_nueva?:    { numero_serie: string; descripcion: string; tipo_pieza_id?: number | null }
  cantidad:        number
  costo_unitario:  number
  /** A qué lote corresponde, cuando una persona lo decidió a mano. */
  lote_id?:        number | null
}

/**
 * Guarda la transcripción del papel y devuelve el cuadre recalculado.
 *
 * Va el papel COMPLETO, no lo que se agrega: la pantalla manda la verdad entera
 * y el servidor reemplaza.
 */
export function useGuardarRenglonesPapel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ factura_id, renglones }: {
      factura_id: number
      renglones: RenglonPapelPayload[]
    }) => api.put<{ data: Cuadre }>(`/facturas/${factura_id}/renglones`, { renglones }),
    onSuccess: () => invalidar(qc),
  })
}

/** Registra la compra que el papel cobra y nadie había capturado. */
export function useRegistrarRenglon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ renglon_id, sucursal_id }: { renglon_id: number; sucursal_id: number }) =>
      api.post<{ data: { lote_id: number; factura_id: number } }>(
        `/facturas/renglones/${renglon_id}/registrar`, { sucursal_id },
      ),
    onSuccess: () => invalidar(qc),
  })
}

export interface ResultadoCuadre {
  factura_id:   number
  correcciones: number
  delta_total:  number
  sin_resolver: number
}

/** Aplica lo que dice el papel y sella la factura entera. */
export function useCuadrar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ factura_id, ...body }: {
      factura_id: number
      nota?: string
      confirmar_sin_resolver?: boolean
    }) => api.post<{ data: ResultadoCuadre }>(`/facturas/${factura_id}/cuadrar`, body),
    onSuccess: () => invalidar(qc),
  })
}
