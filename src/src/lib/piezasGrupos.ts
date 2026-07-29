// Agrupa las piezas por tipo para la vista de la página Piezas y el reporte
// PDF, que deben mostrar los mismos grupos en el mismo orden.
import type { Pieza } from '../hooks/useRefacciones'

export const SIN_TIPO = 'Sin tipo'

// Alfabético por tipo, con las piezas sin tipificar al final: son las que
// faltan por capturar, no un grupo más del catálogo.
export function agruparPorTipo<T extends Pick<Pieza, 'tipo_pieza'>>(piezas: T[]) {
  const grupos = new Map<string, T[]>()
  for (const p of piezas) {
    const tipo = p.tipo_pieza ?? SIN_TIPO
    const items = grupos.get(tipo)
    if (items) items.push(p)
    else grupos.set(tipo, [p])
  }

  return [...grupos.entries()]
    .map(([tipo, items]) => ({ tipo, items }))
    .sort((a, b) =>
      a.tipo === SIN_TIPO ? 1 :
      b.tipo === SIN_TIPO ? -1 :
      a.tipo.localeCompare(b.tipo, 'es-MX')
    )
}
