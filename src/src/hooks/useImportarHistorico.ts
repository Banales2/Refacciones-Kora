// Carga de facturas anteriores al sistema: piezas que se compraron, se usaron y
// de las que solo queda el papel del proveedor.
//
// No es una compra y por eso no reusa `useCompras`: el renglón no elige entre
// refacción del catálogo y refacción nueva —viene con su número de parte y la
// API decide—, y lo que entra al almacén es una existencia de CERO. Ver
// `docs/importacion-historica.md`.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface RenglonImportPayload {
  numero_serie:     string
  /** Con la que se da de alta si no existe. Si ya existe, la API la ignora. */
  descripcion:      string
  /**
   * Solo para las series que no están en el catálogo: es la única
   * clasificación de una refacción y un archivo no la trae. Para las que ya
   * existen se omite — mandarles un tipo sería proponer cambiarles el suyo.
   */
  tipo_pieza_id?:   number
  cantidad_inicial: number
  costo_unitario:   number
}

export interface FacturaImportPayload {
  num_factura:  string
  fecha_compra: string
  renglones:    RenglonImportPayload[]
}

export interface ImportacionPayload {
  proveedor_id: number
  /** A qué almacén entraron cuando llegaron. Su existencia ahí nace en cero. */
  sucursal_id:  number
  /** null = los precios del archivo ya incluyen IVA. */
  tasa_iva:     number | null
  comprado_por: string
  facturas:     FacturaImportPayload[]
}

export interface ImportacionResultado {
  facturas_creadas:  number
  /** Folios que este proveedor ya tenía: se dejaron como estaban. */
  folios_omitidos:   string[]
  renglones_creados: number
  piezas_nuevas:     { id: number; numero_serie: string; descripcion: string }[]
}

/**
 * Cientos de INSERT en una transacción tardan más que cualquier otra llamada de
 * la app. El tope normal de 30 s la cortaría del lado del cliente mientras el
 * servidor sigue trabajando, y el usuario volvería a subir el archivo sin saber
 * si el primero entró.
 */
const TIMEOUT_IMPORTACION_MS = 180_000

export function useImportarHistorico() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ImportacionPayload) =>
      api.post<{ data: ImportacionResultado }>(
        '/compras/historicas', body, TIMEOUT_IMPORTACION_MS,
      ),
    onSuccess: () => {
      // El catálogo creció, el proveedor tiene gasto nuevo y hay facturas que
      // antes no estaban. El inventario NO cambia —todo entró en cero— pero se
      // refresca igual: los lotes que lo alimentan sí son nuevos.
      qc.invalidateQueries({ queryKey: ['refacciones'] })
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['facturas'] })
      qc.invalidateQueries({ queryKey: ['proveedor-gastos'] })
      qc.invalidateQueries({ queryKey: ['inventario-existencias'] })
    },
  })
}
