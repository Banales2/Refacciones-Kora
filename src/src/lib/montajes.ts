import type { MontajeConsumo } from '../hooks/useDetalleMtto'

// ─── Lo que se captura en el formulario ──────────────────────────────────────

/**
 * Dónde queda puesta cada pieza de un consumo, tal como se captura.
 *
 * El motivo y el destino son del renglón completo y no de cada posición: cuando
 * se cambian las cuatro balatas, salen las cuatro por lo mismo. Preguntarlo una
 * vez por posición sería cuatro veces la misma respuesta.
 */
export type PosicionesValue = {
  etiquetas:     string[]
  motivo_retiro: string
  destino:       string
}

export const POSICIONES_VACIAS: PosicionesValue = {
  etiquetas: [], motivo_retiro: '', destino: '',
}

/** Lo que viaja en el payload del consumo. Vacío = no se monta nada. */
export function aMontajes(v: PosicionesValue): MontajeConsumo[] {
  return v.etiquetas.map((etiqueta) => ({
    etiqueta,
    motivo_retiro: v.motivo_retiro || null,
    destino:       v.destino || null,
  }))
}

// ─── Aviso de lo que no se pudo montar ───────────────────────────────────────

// Aviso de las piezas que se capturaron pero no se pudieron montar.
//
// Montar es la segunda mitad del consumo, no un requisito suyo: el gasto es
// válido aunque la pieza no haya quedado ligada a un renglón de la unidad (que
// la unidad no pida ese tipo, que la refacción esté sin clasificar). Por eso la
// API contesta 201 con el aviso en vez de un error — dar por perdido el gasto
// sería peor —, y por eso esto avisa en lugar de bloquear.
//
// Se resuelve desde el detalle del mantenimiento, con el botón de montar de cada
// renglón, que es donde se ve qué quedó pendiente.

/** El texto del aviso, o null si todo quedó montado. */
export function textoAvisoMontajes(avisos: string[]): string | null {
  if (!avisos.length) return null
  return (
    'El mantenimiento y sus refacciones se guardaron, pero algunas piezas no ' +
    'quedaron montadas en la unidad:\n\n' +
    avisos.map((a) => `• ${a}`).join('\n') +
    '\n\nMóntalas desde el detalle del mantenimiento.'
  )
}

/** Igual que el anterior, pero avisando en pantalla. No hace nada si no hay qué decir. */
export function avisarMontajes(avisos: string[]): void {
  const texto = textoAvisoMontajes(avisos)
  if (texto) alert(texto)
}
