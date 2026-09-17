// Espejo del catálogo de preguntas del chequeo diario. El que manda es
// `api/src/shared/chequeoItems.ts`, que además es el que valida: si se toca uno
// hay que tocar el otro.
//
// El formulario NO usa esta constante para saber qué preguntar: eso lo trae el
// endpoint `/vehiculos/{id}/chequeos/formulario`, para que una pregunta nueva
// aparezca en los teléfonos sin esperar a que cada uno actualice la PWA. Esto
// de aquí es para pintar el historial —ponerle nombre a un renglón guardado— y
// para tener algo que mostrar si la consulta del formulario falla.
export type Severidad = 'superficial' | 'moderada' | 'grave'
export type Resultado = 'ok' | 'falla' | 'na'

export interface ItemChequeo {
  clave:   string
  label:   string
  captura: 'ok_falla' | 'lectura' | 'fraccion'
  tipos:   string[]
  incidencia: { severidad: Severidad; categoria: string; preguntarSeveridad?: true } | null
  retirado?: true
}

export const ITEMS_CHEQUEO: ItemChequeo[] = [
  { clave: 'lectura',        label: 'Odómetro',                                        captura: 'lectura',  tipos: ['camion', 'tractocamion', 'utilitario'], incidencia: null },
  { clave: 'lectura',        label: 'Horómetro',                                       captura: 'lectura',  tipos: ['montacargas'],                          incidencia: null },
  { clave: 'combustible',    label: 'Nivel de combustible al recibir',                 captura: 'fraccion', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: null },
  { clave: 'llantas_marca',  label: 'La marca de las llantas coincide con lo registrado', captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Llantas' } },
  { clave: 'llantas_estado', label: 'Ninguna llanta baja ni con desgaste desparejo',    captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Llantas' } },
  { clave: 'golpes',         label: 'Sin golpes nuevos',                                captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Carrocería', preguntarSeveridad: true } },
  { clave: 'fugas',          label: 'Sin manchas debajo de la unidad',                  captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Fugas' } },
  { clave: 'luces',          label: 'Faros, direccionales, stops y reversa',            captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Luces' } },
  { clave: 'parabrisas',     label: 'Parabrisas sin estrellar y espejos completos',     captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'superficial', categoria: 'Carrocería' } },
  { clave: 'documentacion',  label: 'Tarjeta, póliza y permiso a bordo',                captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'caja_trailer', 'utilitario'], incidencia: { severidad: 'superficial', categoria: 'Documentación' } },
  { clave: 'accesorios',     label: 'Extintor, llanta de refacción y herramienta',      captura: 'ok_falla', tipos: [], incidencia: { severidad: 'superficial', categoria: 'Accesorios' } },
  { clave: 'sellos',         label: 'Puertas cierran y sellos puestos',                 captura: 'ok_falla', tipos: ['caja_trailer'], incidencia: { severidad: 'moderada', categoria: 'Carrocería' } },
]

/**
 * Cómo se llama una pregunta guardada. Busca sin filtrar por tipo ni por
 * retirada: un chequeo de hace seis meses puede traer una pregunta que ya no se
 * hace, y el historial tiene que poder nombrarla. Si ni así aparece —un front
 * más viejo que la base— se devuelve la clave, que es fea pero es cierta.
 */
export function labelDeItem(clave: string): string {
  return ITEMS_CHEQUEO.find((i) => i.clave === clave && i.captura !== 'lectura')?.label ?? clave
}

/** Los niveles de tanque que se ofrecen. En octavos, que es lo que da una aguja. */
export const NIVELES_TANQUE = ['0/8', '1/8', '2/8', '3/8', '4/8', '5/8', '6/8', '7/8', '8/8']
