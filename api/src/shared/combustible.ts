// Qué combustible usa una unidad y qué se cargó en cada recarga.
//
// El `combustible` del vehículo es texto: el formulario ofrece "Diesel" y
// "Gasolina", pero hay unidades capturadas antes de esa lista. Aquí se lee con
// manga ancha —sin mayúsculas ni acentos— para no dejar fuera a una unidad por
// cómo se escribió. Ver la migración 063.
//
// Copia en src/src/lib/combustible.ts: el formulario decide con ella si
// pregunta Magna o Premium.

/** Mismos valores que `PRODUCTOS` de las facturas de gasolina. */
export const PRODUCTOS_RECARGA = ['Diesel', 'Magna', 'Premium'] as const
export type ProductoRecarga = typeof PRODUCTOS_RECARGA[number]

/** Lo que se le puede preguntar a una unidad de gasolina. */
export const GASOLINAS = ['Magna', 'Premium'] as const

export type FamiliaCombustible = 'diesel' | 'gasolina'

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/** null = ni diesel ni gasolina (gas, eléctrico) o no se capturó. */
export function familiaCombustible(combustible: string | null | undefined): FamiliaCombustible | null {
  if (!combustible) return null
  const c = normalizar(combustible)
  if (c.includes('diesel')) return 'diesel'
  if (c.includes('gasolina') || c.includes('magna') || c.includes('premium')) return 'gasolina'
  return null
}
