export interface Pieza {
  id: number
  numero_serie: string
  descripcion: string
  categoria: string
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
