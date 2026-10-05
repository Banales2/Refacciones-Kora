// Qué combustible usa una unidad. Copia de api/src/shared/combustible.ts: con
// ella decide el formulario de recarga si pregunta Magna o Premium, y la API
// vuelve a decidir lo mismo al guardar. Ver la migración 063.

export const GASOLINAS = ['Magna', 'Premium'] as const
export type Gasolina = typeof GASOLINAS[number]

/**
 * Cómo llegan del análisis de costos las recargas sin producto: las de gasolina
 * de antes de que se preguntara y las de gas. Su precio no se compara.
 */
export const SIN_PRODUCTO = 'Sin especificar'

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

export function esGasolina(producto: string | null | undefined): producto is Gasolina {
  return producto === 'Magna' || producto === 'Premium'
}
