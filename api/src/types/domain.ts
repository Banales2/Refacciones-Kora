export interface Pieza {
  id: number
  numero_serie: string
  descripcion: string
  // Única clasificación de la pieza: qué tipo cubre ("filtro de aire"). Es
  // obligatorio al crear y no se puede quitar; sigue siendo nullable solo por
  // las piezas anteriores al catálogo de tipos, que se agrupan en "Sin tipo"
  // hasta que se editen. Solo las tipificadas pueden asignarse a un vehículo.
  tipo_pieza_id: number | null
  tipo_pieza: string | null
}

export interface PiezaConCantidad extends Pieza {
  cantidad_total: number
}

export interface LoteConProveedor {
  id: number
  pieza_id: number
  proveedor_id: number
  fecha_compra: string
  costo_unitario: number
  cantidad_inicial: number
  // Suma de las existencias del lote en todas las sucursales. Ya no es una
  // columna: se calcula sobre `existencias_lote` (migración 002).
  cantidad_disponible: number
  num_factura: string | null
  proveedor: string
  // Sucursal que recibió la compra. Es donde entra todo el lote; repartirlo
  // entre sucursales se hace después con un traspaso.
  sucursal_id: number | null
  sucursal: string | null
  // Quién hizo la compra (un empleado, texto libre) y quién la autorizó. El
  // segundo es la cuenta que registró el lote: no llega del cliente ni se edita.
  comprado_por: string
  autorizado_por: string
}
