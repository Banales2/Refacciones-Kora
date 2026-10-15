// Importar facturas de refacciones de su XML. Ver la migración 070 y
// docs/importar-facturas-de-refacciones.md.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { ConceptoXml, FacturaRefaccionesXml } from '../lib/xmlRefacciones'

export type TipoConcepto = 'refaccion' | 'mano_obra' | 'cargo'

/** Lo aprendido de un número de parte del proveedor. */
export interface ConceptoAprendido {
  no_identificacion: string
  tipo: TipoConcepto
  pieza_id: number | null
  numero_serie: string | null
  descripcion: string | null
  contenido: number
}

export function fetchConceptosAprendidos(proveedorId: number) {
  return api.get<{ data: ConceptoAprendido[] }>(`/proveedores/${proveedorId}/conceptos`)
}

export type AsignacionPayload =
  | {
      tipo: 'refaccion'
      pieza_id?: number
      pieza_nueva?: { numero_serie: string; descripcion: string; marca: string; tipo_pieza_id: number }
      contenido: number
    }
  | { tipo: 'mano_obra' }
  | { tipo: 'cargo' }

export interface ImportarCfdiPayload extends Omit<FacturaRefaccionesXml, 'conceptos'> {
  conceptos: (Omit<ConceptoXml, 'unidad'> & { asignacion: AsignacionPayload })[]
  proveedor_id?: number
  proveedor_nuevo?: boolean
  sucursal_id: number
  comprado_por: string
  fecha_llegada?: string | null
}

export interface CfdiImportada {
  factura_id: number
  proveedor_id: number
  proveedor_nuevo: boolean
  folio: string
  proveedor: string
  lotes: { id: number; pieza_id: number; pieza_nueva: boolean }[]
}

/** Ya estaba importada: su folio fiscal se repite. */
export const FACTURA_DUPLICADA = 'FACTURA_DUPLICADA'

export function useImportarCfdi() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ImportarCfdiPayload) =>
      api.post<{ data: CfdiImportada }>('/facturas/importar', body),
    onSuccess: (r) => {
      // Lo mismo que el alta de compra, y además el proveedor (pudo nacer o
      // quedarse con su RFC) y lo aprendido de él.
      qc.invalidateQueries({ queryKey: ['facturas'] })
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['refacciones'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      qc.invalidateQueries({ queryKey: ['precios-proveedor'] })
      qc.invalidateQueries({ queryKey: ['inventario-existencias'] })
      qc.invalidateQueries({ queryKey: ['proveedor-gastos'] })
      qc.invalidateQueries({ queryKey: ['proveedores'] })
      qc.invalidateQueries({ queryKey: ['proveedor-conceptos', r.data.proveedor_id] })
    },
  })
}
