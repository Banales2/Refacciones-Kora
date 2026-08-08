// Etiquetas y colores de incidencias, en su propio módulo: si vivieran junto al
// componente del formulario, el fast refresh de Vite dejaría de funcionar en ese
// archivo (solo recarga en caliente los módulos que exportan puros componentes).
import type { Severidad, StatusIncidencia } from '../hooks/useIncidencias'

export const SEVERIDAD_META: Record<Severidad, { label: string; color: string }> = {
  superficial: { label: 'Superficial', color: 'blue'   },
  moderada:    { label: 'Moderada',    color: 'yellow' },
  grave:       { label: 'Grave',       color: 'red'    },
}

export const STATUS_INCIDENCIA_META: Record<StatusIncidencia, { label: string; color: string }> = {
  activo:     { label: 'Sin atender', color: 'orange' },
  completado: { label: 'Atendida',    color: 'green'  },
  pausado:    { label: 'Pausada',     color: 'yellow' },
  cancelado:  { label: 'Cancelada',   color: 'gray'   },
}
