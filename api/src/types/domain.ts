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
  /** `null` en el lote de recuperación, que no salió de ninguna compra. */
  proveedor: string | null
  // Sucursal que recibió la compra. Es donde entra todo el lote; repartirlo
  // entre sucursales se hace después con un traspaso.
  sucursal_id: number | null
  sucursal: string | null
  // Quién hizo la compra (un empleado, texto libre) y quién la autorizó. El
  // segundo es la cuenta que registró el lote: no llega del cliente ni se edita.
  comprado_por: string
  autorizado_por: string
  /**
   * Tasa de IVA que hay que SUMARLE a `costo_unitario`, en por ciento.
   * `null` = el precio capturado ya lo incluye (o la compra es exenta), que es
   * el caso de todo lo anterior a la migración 020. El importe no se guarda: se
   * calcula donde se muestre. Ver `db/migrations/020_iva_del_lote.sql`.
   */
  tasa_iva: number | null
  /**
   * Descuento de la factura, en por ciento, que se resta al subtotal ANTES del
   * IVA. `null` = la factura no trae descuento, que es el caso de todo lo
   * anterior a la migración 021. No modifica `costo_unitario`: el renglón se
   * guarda a precio de lista y el descuento solo mueve el total de la factura.
   * Ver `db/migrations/021_descuento_de_factura.sql`.
   */
  descuento_pct: number | null
}
