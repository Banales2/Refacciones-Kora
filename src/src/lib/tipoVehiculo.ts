// Colores y etiquetas por tipo de vehículo, compartidos por badges, gráficas
// y reportes en toda la aplicación.
export const TIPO_COLORS: Record<string, string> = {
  camion:       'blue',
  tractocamion: 'violet',
  caja_trailer: 'orange',
  utilitario:   'teal',
  montacargas:  'yellow',
}

export const TIPO_LABELS: Record<string, string> = {
  camion:       'Unidad de reparto',
  tractocamion: 'Unidad de translado',
  caja_trailer: 'Caja de trailer',
  utilitario:   'Vehículo utilitario',
  montacargas:  'Montacargas',
}

// Qué tipos llevan cada documento. Una caja de trailer no se asegura, y el
// permiso de circulación solo lo tramitan reparto y utilitarios. Espeja
// TIPOS_CON_SEGURO / TIPOS_CON_PERMISO del backend, que es quien manda: la API
// rechaza el documento que no corresponda al tipo.
export const TIPOS_CON_SEGURO  = ['camion', 'tractocamion', 'utilitario', 'montacargas']
export const TIPOS_CON_PERMISO = ['camion', 'utilitario']

export function llevaSeguro(tipo: string): boolean {
  return TIPOS_CON_SEGURO.includes(tipo)
}

export function llevaPermiso(tipo: string): boolean {
  return TIPOS_CON_PERMISO.includes(tipo)
}
