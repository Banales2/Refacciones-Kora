// El catálogo de preguntas del chequeo diario.
//
// Vive en código y no en una tabla porque cambia cuando cambia el formulario,
// no cuando lo decide un usuario: una pantalla de mantenimiento para diecisiete
// renglones sería mantenimiento puro sin nadie que la use. La base no se
// ensucia porque el servicio valida contra esta constante y rechaza con 400
// cualquier clave que no esté aquí (ver `validarClaves`).
//
// El espejo del frontend está en `src/src/lib/chequeoItems.ts`. Están duplicados
// a propósito y no servidos por un endpoint: es una constante que se lee en cada
// render del formulario, y una llamada más para traerla haría esperar a quien
// está parado junto al camión con el teléfono en la mano. Si se toca uno hay que
// tocar el otro; el backend es el que manda, porque es el que valida.
import { TipoVehiculo, TIPOS_VEHICULO } from '../schemas/vehiculoSchema'

export type Severidad = 'superficial' | 'moderada' | 'grave'
export type Resultado = 'ok' | 'falla' | 'na'

export const RESULTADOS: Resultado[] = ['ok', 'falla', 'na']

export interface ItemChequeo {
  clave: string
  /** Lo que se le pregunta a quien revisa, redactado para que "sí" sea lo bueno. */
  label: string
  /**
   * Cómo se contesta:
   *   'ok_falla'  los dos botones grandes. Es el caso normal.
   *   'lectura'   un número; va a `chequeos.lectura`, no a un renglón.
   *   'fraccion'  el nivel de combustible en cuartos de tanque.
   */
  captura: 'ok_falla' | 'lectura' | 'fraccion'
  /** Vacío = aplica a todos los tipos. */
  tipos: TipoVehiculo[]
  /**
   * Qué incidencia abre esta pregunta cuando sale 'falla'. `null` = ninguna:
   * el nivel de combustible bajo no es algo que haya que atender, es un dato.
   *
   * La severidad es de antemano porque en el checklist no hay nada que
   * interpretar —la luz prende o no prende— y a quien está revisando no se le
   * puede pedir que además gradúe. La excepción es `golpes`, donde sí se
   * pregunta: un rayón y un cuarto hundido no son lo mismo y se ven distinto.
   */
  incidencia: { severidad: Severidad; categoria: string; preguntarSeveridad?: true } | null
  /**
   * Ya no se pregunta, pero los chequeos viejos la referencian por clave y la
   * pantalla de historial tiene que saber cómo llamarla. Mismo criterio que
   * archivar en vez de borrar (migración 033): el renglón sale de la captura,
   * no de la historia.
   */
  retirado?: true
}

const TODOS: TipoVehiculo[] = []

// Los tipos que llevan odómetro. Espeja TABLA_KM de `vehiculosRepo.ts`, que es
// quien de verdad decide si la lectura avanza el kilometraje de la unidad.
export const TIPOS_CON_ODOMETRO: TipoVehiculo[] = ['camion', 'tractocamion', 'utilitario']

// Montacargas no acumula kilómetros, acumula horas de motor.
const TIPOS_CON_HOROMETRO: TipoVehiculo[] = ['montacargas']

// Los que traen tanque. La caja del tráiler es lo único que no se mueve solo.
const TIPOS_CON_TANQUE: TipoVehiculo[] = ['camion', 'tractocamion', 'utilitario', 'montacargas']

// Los que llevan cabina: espejos, parabrisas, extintor.
const TIPOS_CON_CABINA: TipoVehiculo[] = ['camion', 'tractocamion', 'utilitario', 'montacargas']

// Los que circulan por calle y por eso traen papeles a bordo. Es la unión de
// TIPOS_CON_SEGURO y TIPOS_CON_PERMISO del esquema de vehículos, menos el
// montacargas, que no sale del patio aunque esté asegurado.
const TIPOS_CON_PAPELES: TipoVehiculo[] = ['camion', 'tractocamion', 'caja_trailer', 'utilitario']

export const ITEMS_CHEQUEO: ItemChequeo[] = [
  {
    clave: 'lectura',
    label: 'Odómetro',
    captura: 'lectura',
    tipos: TIPOS_CON_ODOMETRO,
    incidencia: null,
  },
  {
    clave: 'lectura',
    label: 'Horómetro',
    captura: 'lectura',
    tipos: TIPOS_CON_HOROMETRO,
    incidencia: null,
  },
  {
    clave: 'combustible',
    label: 'Nivel de combustible al recibir',
    captura: 'fraccion',
    tipos: TIPOS_CON_TANQUE,
    incidencia: null,
  },
  {
    clave: 'llantas_marca',
    label: 'La marca de las llantas coincide con lo registrado',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Llantas' },
  },
  {
    clave: 'llantas_estado',
    label: 'Ninguna llanta baja ni con desgaste desparejo',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Llantas' },
  },
  {
    clave: 'golpes',
    label: 'Sin golpes nuevos',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Carrocería', preguntarSeveridad: true },
  },
  {
    clave: 'fugas',
    label: 'Sin manchas debajo de la unidad',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Fugas' },
  },
  // Cada pregunta es UNA cosa. Ni las luces, ni los papeles, ni los accesorios,
  // ni la cabina, ni la caja se preguntan en un renglón que enumera varias. Un renglón así solo se puede
  // contestar "no" entero: quien revisa ve el stop fundido y marca falla, y la
  // incidencia que sale dice "Faros, direccionales, stops y reversa", sin decir
  // cuál. Peor todavía, obliga a marcar mal la unidad completa por una pieza, y
  // eso empuja a dejarlo en "sí" y anotarlo en la nota, que es donde nadie lo
  // busca. Separados, cada falla nombra la pieza y abre su propia incidencia.
  //
  // Los renglones viejos siguen abajo marcados `retirado`: salen de la captura,
  // no de la historia.
  {
    clave: 'luces_faros',
    label: 'Faros funcionando',
    captura: 'ok_falla',
    tipos: TIPOS_CON_CABINA,
    incidencia: { severidad: 'moderada', categoria: 'Luces' },
  },
  {
    clave: 'luces_direccionales',
    label: 'Direccionales funcionando',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Luces' },
  },
  {
    clave: 'luces_stops',
    label: 'Stops funcionando',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Luces' },
  },
  {
    clave: 'luces_reversa',
    label: 'Reversa funcionando',
    captura: 'ok_falla',
    tipos: TIPOS_CON_CABINA,
    incidencia: { severidad: 'moderada', categoria: 'Luces' },
  },
  {
    clave: 'cab_parabrisas',
    label: 'Parabrisas sin estrellar',
    captura: 'ok_falla',
    tipos: TIPOS_CON_CABINA,
    incidencia: { severidad: 'superficial', categoria: 'Carrocería' },
  },
  {
    clave: 'cab_espejos',
    label: 'Espejos completos',
    captura: 'ok_falla',
    tipos: TIPOS_CON_CABINA,
    incidencia: { severidad: 'superficial', categoria: 'Carrocería' },
  },
  {
    clave: 'doc_tarjeta',
    label: 'Tarjeta de circulación a bordo',
    captura: 'ok_falla',
    tipos: TIPOS_CON_PAPELES,
    incidencia: { severidad: 'superficial', categoria: 'Documentación' },
  },
  {
    clave: 'doc_poliza',
    label: 'Póliza del seguro a bordo',
    captura: 'ok_falla',
    tipos: TIPOS_CON_PAPELES,
    incidencia: { severidad: 'superficial', categoria: 'Documentación' },
  },
  {
    clave: 'doc_permiso',
    label: 'Permiso a bordo',
    captura: 'ok_falla',
    tipos: TIPOS_CON_PAPELES,
    incidencia: { severidad: 'superficial', categoria: 'Documentación' },
  },
  {
    clave: 'acc_extintor',
    label: 'Extintor a bordo',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'superficial', categoria: 'Accesorios' },
  },
  {
    clave: 'acc_llanta_refaccion',
    label: 'Llanta de refacción a bordo',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'superficial', categoria: 'Accesorios' },
  },
  {
    clave: 'acc_herramienta',
    label: 'Herramienta a bordo',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'superficial', categoria: 'Accesorios' },
  },
  {
    clave: 'caja_puertas',
    label: 'Puertas cierran bien',
    captura: 'ok_falla',
    tipos: ['caja_trailer'],
    incidencia: { severidad: 'moderada', categoria: 'Carrocería' },
  },
  {
    clave: 'caja_sellos',
    label: 'Sellos puestos',
    captura: 'ok_falla',
    tipos: ['caja_trailer'],
    incidencia: { severidad: 'moderada', categoria: 'Carrocería' },
  },

  // ─── Retirados ────────────────────────────────────────────────────────────
  // Ya no se preguntan: cada uno se abrió en los renglones de arriba. Siguen
  // aquí para que el historial pueda nombrarlos, que es lo único que se les
  // pide (ver `itemPorClave`).
  {
    clave: 'luces',
    label: 'Faros, direccionales, stops y reversa',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Luces' },
    retirado: true,
  },
  {
    clave: 'documentacion',
    label: 'Tarjeta, póliza y permiso a bordo',
    captura: 'ok_falla',
    tipos: TIPOS_CON_PAPELES,
    incidencia: { severidad: 'superficial', categoria: 'Documentación' },
    retirado: true,
  },
  {
    clave: 'accesorios',
    label: 'Extintor, llanta de refacción y herramienta',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'superficial', categoria: 'Accesorios' },
    retirado: true,
  },
  {
    clave: 'parabrisas',
    label: 'Parabrisas sin estrellar y espejos completos',
    captura: 'ok_falla',
    tipos: TIPOS_CON_CABINA,
    incidencia: { severidad: 'superficial', categoria: 'Carrocería' },
    retirado: true,
  },
  {
    clave: 'sellos',
    label: 'Puertas cierran y sellos puestos',
    captura: 'ok_falla',
    tipos: ['caja_trailer'],
    incidencia: { severidad: 'moderada', categoria: 'Carrocería' },
    retirado: true,
  },
]

/**
 * Las preguntas que le tocan a un tipo de unidad, en el orden en que se
 * contestan. La lectura sale aparte porque no es un renglón: su valor vive en
 * la cabecera del chequeo.
 */
export function itemsDe(tipo: TipoVehiculo): ItemChequeo[] {
  return ITEMS_CHEQUEO.filter(
    (i) => !i.retirado && i.captura !== 'lectura' && (i.tipos.length === 0 || i.tipos.includes(tipo))
  )
}

/** Cómo se llama la lectura de este tipo de unidad, o null si no lleva. */
export function lecturaDe(tipo: TipoVehiculo): ItemChequeo | null {
  return ITEMS_CHEQUEO.find(
    (i) => i.captura === 'lectura' && !i.retirado && i.tipos.includes(tipo)
  ) ?? null
}

/**
 * Busca una clave sin filtrar por tipo ni por retirado: es lo que necesita la
 * pantalla de historial para poner nombre a un renglón viejo de una pregunta
 * que ya no se hace, o de una unidad cuyo tipo no la incluye.
 */
export function itemPorClave(clave: string): ItemChequeo | undefined {
  return ITEMS_CHEQUEO.find((i) => i.clave === clave && i.captura !== 'lectura')
}

// Verificación de arranque: dos preguntas con la misma clave y el mismo tipo
// harían que un chequeo no pudiera contestar las dos (la PK de chequeo_items es
// (chequeo_id, clave)), y el error saldría hasta el INSERT. Aquí sale al cargar
// el módulo. `lectura` se repite a propósito —odómetro y horómetro son la misma
// columna con distinto nombre— pero nunca para el mismo tipo.
for (const tipo of TIPOS_VEHICULO) {
  const claves = [...itemsDe(tipo), ...(lecturaDe(tipo) ? [lecturaDe(tipo)!] : [])].map((i) => i.clave)
  const repetida = claves.find((c, i) => claves.indexOf(c) !== i)
  if (repetida) {
    throw new Error(`chequeoItems: la clave "${repetida}" está dos veces para el tipo ${tipo}`)
  }
}
