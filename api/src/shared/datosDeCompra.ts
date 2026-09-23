// Lo que dice cuánto costó una refacción y a quién se le compró.
//
// El responsable de sucursal consulta el inventario de su patio para saber QUÉ
// hay en su patio, no cuánto se pagó por ello: precios, facturas y proveedores
// son información comercial de almacén. Se quita aquí, en la respuesta, y no
// sólo se esconde en la interfaz, porque lo que llega al navegador se puede leer
// igual aunque no se pinte.
//
// Se hace sobre las filas ya consultadas y no con otra versión de cada consulta:
// son pocos endpoints, y así una columna nueva en el repositorio no puede
// colarse por un SELECT que alguien olvidó duplicar.
import { ClientPrincipal } from './auth'

// Todo lo que sale de la factura o del lote de compra. `fecha_compra` se queda:
// es lo que distingue un lote de otro en pantalla y no dice nada de dinero.
const CAMPOS_DE_COMPRA = [
  'costo_unitario', 'tasa_iva', 'descuento_pct',
  'factura_id', 'num_factura',
  'proveedor', 'proveedor_id',
  'comprado_por', 'autorizado_por',
] as const

/** Si quien está conectado puede ver precios, facturas y proveedores. */
export function puedeVerCompras(user: ClientPrincipal): boolean {
  return !user.userRoles.includes('responsable')
}

/**
 * Devuelve las filas sin los campos de compra si el rol no puede verlos. Las
 * claves se borran, no se ponen en null: null ya significa "lote de
 * recuperación, sin factura", y confundir las dos cosas sería mentir.
 */
export function sinDatosDeCompra<T extends object>(filas: T[], user: ClientPrincipal): T[] {
  if (puedeVerCompras(user)) return filas
  return filas.map((fila) => {
    const copia = { ...fila } as Record<string, unknown>
    for (const campo of CAMPOS_DE_COMPRA) delete copia[campo]
    return copia as unknown as T
  })
}
