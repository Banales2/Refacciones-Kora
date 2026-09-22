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
  /** Solo `fraccion`: el nivel en el que ya cuenta como falla, y por debajo. */
  umbralFalla?: string
  retirado?: true
}

export const ITEMS_CHEQUEO: ItemChequeo[] = [
  { clave: 'lectura',        label: 'Odómetro',                                        captura: 'lectura',  tipos: ['camion', 'tractocamion', 'utilitario'], incidencia: null },
  { clave: 'lectura',        label: 'Horómetro',                                       captura: 'lectura',  tipos: ['montacargas'],                          incidencia: null },
  { clave: 'combustible',    label: 'Nivel de combustible al recibir',                 captura: 'fraccion', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: null },
  { clave: 'nivel_aceite_motor',      label: 'Nivel de aceite de motor',                captura: 'fraccion', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'grave', categoria: 'Niveles' }, umbralFalla: '1/4' },
  { clave: 'nivel_aceite_hidraulico', label: 'Nivel de aceite hidráulico',              captura: 'fraccion', tipos: ['camion', 'tractocamion', 'montacargas'], incidencia: { severidad: 'moderada', categoria: 'Niveles' }, umbralFalla: '1/4' },
  { clave: 'nivel_liquido_direccion', label: 'Nivel de líquido de dirección hidráulica', captura: 'fraccion', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'moderada', categoria: 'Niveles' }, umbralFalla: '1/4' },
  { clave: 'nivel_liquido_frenos',    label: 'Nivel de líquido de frenos',              captura: 'fraccion', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'grave', categoria: 'Niveles' }, umbralFalla: '1/4' },
  { clave: 'nivel_anticongelante',    label: 'Nivel de anticongelante',                 captura: 'fraccion', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'grave', categoria: 'Niveles' }, umbralFalla: '1/4' },
  { clave: 'nivel_limpiaparabrisas',  label: 'Nivel de limpiaparabrisas',               captura: 'fraccion', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'superficial', categoria: 'Niveles' }, umbralFalla: '1/4' },
  { clave: 'llantas_marca',  label: 'La marca de las llantas coincide con lo registrado', captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Llantas' } },
  { clave: 'llantas_estado', label: 'Ninguna llanta baja ni con desgaste desparejo',    captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Llantas' } },
  { clave: 'golpes',         label: 'Sin golpes nuevos',                                captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Carrocería', preguntarSeveridad: true } },
  { clave: 'fugas',          label: 'Sin manchas debajo de la unidad',                  captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Fugas' } },
  { clave: 'luces_faros',        label: 'Faros funcionando',          captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'moderada', categoria: 'Luces' } },
  { clave: 'luces_direccionales', label: 'Direccionales funcionando',  captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Luces' } },
  { clave: 'luces_stops',        label: 'Stops funcionando',          captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Luces' } },
  { clave: 'luces_reversa',      label: 'Reversa funcionando',        captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'moderada', categoria: 'Luces' } },
  { clave: 'luces_cuartos',      label: 'Cuartos funcionando',        captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Luces' } },
  { clave: 'cab_parabrisas', label: 'Parabrisas sin estrellar',  captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'superficial', categoria: 'Carrocería' } },
  { clave: 'cab_espejos',    label: 'Espejos completos',        captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'superficial', categoria: 'Carrocería' } },
  { clave: 'doc_tarjeta',    label: 'Tarjeta de circulación a bordo',                  captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'caja_trailer', 'utilitario'], incidencia: { severidad: 'superficial', categoria: 'Documentación' } },
  { clave: 'doc_poliza',     label: 'Póliza del seguro a bordo',                       captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'caja_trailer', 'utilitario'], incidencia: { severidad: 'superficial', categoria: 'Documentación' } },
  { clave: 'doc_permiso',    label: 'Permiso a bordo',                                 captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'caja_trailer', 'utilitario'], incidencia: { severidad: 'superficial', categoria: 'Documentación' } },
  { clave: 'acc_extintor',         label: 'Extintor a bordo',            captura: 'ok_falla', tipos: [], incidencia: { severidad: 'superficial', categoria: 'Accesorios' } },
  { clave: 'acc_llanta_refaccion', label: 'Llanta de refacción a bordo', captura: 'ok_falla', tipos: [], incidencia: { severidad: 'superficial', categoria: 'Accesorios' } },
  { clave: 'acc_herramienta',      label: 'Herramienta a bordo',         captura: 'ok_falla', tipos: [], incidencia: { severidad: 'superficial', categoria: 'Accesorios' } },
  { clave: 'caja_puertas',   label: 'Puertas cierran bien',     captura: 'ok_falla', tipos: ['caja_trailer'], incidencia: { severidad: 'moderada', categoria: 'Carrocería' } },
  { clave: 'caja_sellos',    label: 'Sellos puestos',           captura: 'ok_falla', tipos: ['caja_trailer'], incidencia: { severidad: 'moderada', categoria: 'Carrocería' } },

  // Retirados: cada uno se abrió en varios renglones. Siguen aquí solo para
  // ponerle nombre a un chequeo viejo en el historial.
  { clave: 'luces',          label: 'Faros, direccionales, stops y reversa',            captura: 'ok_falla', tipos: [], incidencia: { severidad: 'moderada', categoria: 'Luces' }, retirado: true },
  { clave: 'documentacion',  label: 'Tarjeta, póliza y permiso a bordo',                captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'caja_trailer', 'utilitario'], incidencia: { severidad: 'superficial', categoria: 'Documentación' }, retirado: true },
  { clave: 'accesorios',     label: 'Extintor, llanta de refacción y herramienta',      captura: 'ok_falla', tipos: [], incidencia: { severidad: 'superficial', categoria: 'Accesorios' }, retirado: true },
  { clave: 'parabrisas',     label: 'Parabrisas sin estrellar y espejos completos',     captura: 'ok_falla', tipos: ['camion', 'tractocamion', 'utilitario', 'montacargas'], incidencia: { severidad: 'superficial', categoria: 'Carrocería' }, retirado: true },
  { clave: 'sellos',         label: 'Puertas cierran y sellos puestos',                 captura: 'ok_falla', tipos: ['caja_trailer'], incidencia: { severidad: 'moderada', categoria: 'Carrocería' }, retirado: true },
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

/**
 * Los niveles de tanque que se ofrecen: los cuatro que marca la aguja.
 *
 * Se guarda el cuarto (`4/4`) y se muestra la palabra ("Lleno"), que es como se
 * dice de viva voz. Guardar la palabra dejaría el último nivel fuera de la
 * escala y obligaría a un caso especial a cualquiera que quiera ordenarlos o
 * graficarlos; `1/2` se muestra así y se guarda `2/4` por lo mismo, que es el
 * mismo número escrito sobre la escala de los demás.
 *
 * Los octavos que se capturaron antes siguen siendo válidos en la API: ya no se
 * ofrecen, pero un chequeo viejo que se corrige no tiene por qué ser rechazado.
 */
export const NIVELES_TANQUE: { valor: string; label: string }[] = [
  { valor: '1/4', label: '1/4' },
  { valor: '2/4', label: '1/2' },
  { valor: '3/4', label: '3/4' },
  { valor: '4/4', label: 'Lleno' },
]

/**
 * Si este nivel cuenta como falla en esta pregunta. Espejo de `nivelEsFalla`
 * del backend, que es el que de verdad decide: aquí sirve para pintar el
 * renglón mientras se captura.
 */
export function nivelEsFalla(item: ItemChequeo, valor: string): boolean {
  if (!item.umbralFalla) return false
  const i = NIVELES_TANQUE.findIndex((n) => n.valor === valor)
  const umbral = NIVELES_TANQUE.findIndex((n) => n.valor === item.umbralFalla)
  return i >= 0 && umbral >= 0 && i <= umbral
}
