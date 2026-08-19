// Etiquetas y colores de los documentos que expiran, compartidos por el punto
// del calendario, la leyenda y el panel del día. Vive aparte de los componentes
// por lo mismo que incidenciaMeta: un archivo que exporta algo que no es un
// componente rompe el fast refresh de Vite.
import type { TipoVencimiento } from '../hooks/useActividadDia'

export const VENCIMIENTO_META: Record<TipoVencimiento, { label: string; color: string }> = {
  seguro:   { label: 'Seguro',   color: 'cyan'   },
  permiso:  { label: 'Permiso',  color: 'teal'   },
  tenencia: { label: 'Tenencia', color: 'violet' },
  licencia: { label: 'Licencia', color: 'pink'   },
}

// Cuántos días faltan para una fecha ISO, contra hoy. Negativo = ya venció.
// Se compara a mediodía para que el cambio de horario no corra el resultado un
// día, igual que hace lib/formato con las fechas de la API.
export function diasRestantes(iso: string): number {
  const hoy = new Date()
  hoy.setHours(12, 0, 0, 0)
  const objetivo = new Date(`${iso.split('T')[0]}T12:00:00`)
  return Math.round((objetivo.getTime() - hoy.getTime()) / 86_400_000)
}

/** Cómo de urgente es un vencimiento: color del aviso y texto del plazo. */
export function urgencia(iso: string): { color: string; texto: string } {
  const d = diasRestantes(iso)
  if (d < 0)   return { color: 'red',    texto: `Venció hace ${-d} día${-d !== 1 ? 's' : ''}` }
  if (d === 0) return { color: 'red',    texto: 'Vence hoy' }
  if (d <= 30) return { color: 'orange', texto: `Vence en ${d} día${d !== 1 ? 's' : ''}` }
  return { color: 'gray', texto: `Vence en ${d} días` }
}
