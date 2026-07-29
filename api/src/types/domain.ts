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
  cantidad_disponible: number
  num_factura: string | null
  proveedor: string
}
