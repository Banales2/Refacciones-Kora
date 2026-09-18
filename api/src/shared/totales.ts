// Los totales de una factura, del lado del servidor.
//
// Es el gemelo de `src/src/lib/totales.ts`, que hace lo mismo para la pantalla.
// Estaba solo en el frontend porque hasta ahora los importes únicamente se
// mostraban; la revisión los necesita aquí, porque `delta_dinero` —cuánto costó
// un error de captura— se calcula y se guarda en el servidor y no puede
// depender de lo que el cliente diga que valía.
//
// Si se cambia la fórmula, hay que cambiar los dos. No se comparte un solo
// archivo porque `api/` y `src/` son dos proyectos de TypeScript sin código
// común, y montar uno para tres funciones de aritmética cuesta más de lo que
// ahorra. Lo que sí se comparte es este comentario.
//
// EL ORDEN IMPORTA, y es el del papel: el descuento se resta al subtotal y el
// IVA se calcula sobre lo que queda, nunca sobre el subtotal sin descontar.
// Ver `db/migrations/021_descuento_de_factura.sql`.
//
// `null` NO es cero en ninguno de los dos porcentajes. En la tasa significa que
// el precio capturado YA incluye IVA (o que la compra es exenta); en el
// descuento, que la factura no trae ninguno.

/** Lo que el proveedor descuenta del subtotal. 0 si la factura no trae descuento. */
export function importeDescuento(subtotal: number, pct: number | null | undefined): number {
  if (!pct) return 0
  return subtotal * (pct / 100)
}

/**
 * Lo que hay que sumarle a la base gravable. 0 si el precio ya incluye IVA.
 *
 * El primer argumento es la base —el subtotal YA descontado—, no el subtotal.
 */
export function importeIva(base: number, tasa: number | null | undefined): number {
  if (!tasa) return 0
  return base * (tasa / 100)
}

export interface TotalesFactura {
  subtotal: number
  descuento: number
  /** Subtotal menos descuento: sobre esto se calcula el IVA. */
  base: number
  iva: number
  total: number
}

/** El desglose completo, en el orden en que lo emite el proveedor. */
export function totalesFactura(
  subtotal: number,
  descuentoPct: number | null | undefined,
  tasaIva: number | null | undefined,
): TotalesFactura {
  const descuento = importeDescuento(subtotal, descuentoPct)
  const base = subtotal - descuento
  const iva = importeIva(base, tasaIva)
  return { subtotal, descuento, base, iva, total: base + iva }
}

/**
 * Lo que un renglón aporta al TOTAL de su factura: su importe de lista ya
 * pasado por el descuento y el IVA de la cabecera.
 *
 * Es lo que hace falta para poner precio a un error de captura. La resta cruda
 * de los costos —"puso 1,200 en vez de 1,250, son 50 pesos"— es la respuesta
 * equivocada: en una factura con 10% de descuento y 16% de IVA esos 50 pesos de
 * lista son 52.20 de los que de verdad se pagaron.
 */
export function contribucionRenglon(
  costoUnitario: number,
  cantidad: number,
  descuentoPct: number | null | undefined,
  tasaIva: number | null | undefined,
): number {
  return totalesFactura(costoUnitario * cantidad, descuentoPct, tasaIva).total
}

/** Redondeo a centavos, que es la precisión con la que se guarda el delta. */
export function aCentavos(n: number): number {
  return Math.round(n * 100) / 100
}
