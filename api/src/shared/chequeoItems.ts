// El catálogo de preguntas del chequeo diario.
//
// Vive en código y no en una tabla porque cambia cuando cambia el formulario,
// no cuando lo decide un usuario: una pantalla de mantenimiento para veinticuatro
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
  /**
   * Lo que se le pregunta a quien revisa. Una pregunta literal —"¿Los faros
   * funcionan?"— y no un enunciado que haya que traducir a sí o no; y siempre
   * con el "sí" del lado bueno, para que la respuesta buena sea la misma en
   * todos los renglones. Los de `fraccion` no llevan signos: ahí no se contesta
   * sí o no, se toca un nivel.
   */
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
  incidencia: {
    severidad: Severidad
    categoria: string
    preguntarSeveridad?: true
    /**
     * Cómo se llama el pendiente que abre esta falla. Va aparte del `label`
     * porque no son lo mismo: el label es lo que se le pregunta a quien revisa
     * ("¿Los faros funcionan?") y el nombre es lo que lee después quien tiene
     * que arreglarlo ("Faros fundidos"). Una pregunta en la lista de pendientes
     * no dice qué hay que hacer. Tope de 40, como la columna.
     */
    nombre?: string
  } | null
  /**
   * Solo para `fraccion`: el nivel en el que ya cuenta como falla, y por debajo
   * del cual también. Un tanque de combustible a 1/4 no es un pendiente —se
   * carga y ya—, pero un depósito de frenos a 1/4 sí, y la diferencia no la
   * puede llevar el formulario: la fija el catálogo, igual que la severidad.
   *
   * Sin él, una `fraccion` nunca abre incidencia.
   */
  umbralFalla?: string
  /**
   * Ya no se pregunta, pero los chequeos viejos la referencian por clave y la
   * pantalla de historial tiene que saber cómo llamarla. Mismo criterio que
   * archivar en vez de borrar (migración 033): el renglón sale de la captura,
   * no de la historia.
   */
  retirado?: true
}

/**
 * Los niveles que se ofrecen a una pregunta `fraccion`, de menos a más. El
 * orden ES el dato: es contra él que se compara `umbralFalla`.
 *
 * Se guarda el cuarto y se muestra la palabra ("Lleno"), para que el último
 * nivel no quede fuera de la escala. El espejo del formulario está en
 * `src/src/lib/chequeoItems.ts`.
 */
export const NIVELES_TANQUE: { valor: string; label: string }[] = [
  { valor: '1/4', label: '1/4' },
  { valor: '2/4', label: '1/2' },
  { valor: '3/4', label: '3/4' },
  { valor: '4/4', label: 'Lleno' },
]

/**
 * Si este nivel cuenta como falla en esta pregunta. Un nivel que no está en la
 * escala —los octavos que se capturaron antes— no se juzga: no se puede decir
 * si "5/8" está por debajo de "1/4" sin inventarse una conversión, y una
 * incidencia abierta por una conversión inventada es peor que ninguna.
 */
export function nivelEsFalla(def: ItemChequeo, valor: string | null): boolean {
  if (!def.umbralFalla || !valor) return false
  const i = NIVELES_TANQUE.findIndex((n) => n.valor === valor)
  const umbral = NIVELES_TANQUE.findIndex((n) => n.valor === def.umbralFalla)
  return i >= 0 && umbral >= 0 && i <= umbral
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

// Los que llevan motor, y por lo tanto aceite, anticongelante y frenos que
// revisar. Es la misma lista que la cabina, pero por otra razón: la caja del
// tráiler no está aquí porque no tiene motor, no porque no tenga asiento.
const TIPOS_CON_MOTOR: TipoVehiculo[] = ['camion', 'tractocamion', 'utilitario', 'montacargas']

// Los que llevan sistema hidráulico de trabajo: el mástil del montacargas y las
// cajas de volteo o plataformas de los camiones. Un utilitario no lo lleva, y
// preguntar por un nivel que no existe enseña a contestar sin mirar.
const TIPOS_CON_HIDRAULICO: TipoVehiculo[] = ['camion', 'tractocamion', 'montacargas']

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
    label: 'Combustible al recibir',
    captura: 'fraccion',
    tipos: TIPOS_CON_TANQUE,
    incidencia: null,
  },

  // ─── Niveles ──────────────────────────────────────────────────────────────
  // Van juntos y al principio porque se revisan de una sola abierta de cofre.
  //
  // Se capturan en cuartos y no con sí o no: "está bien" no distingue un
  // depósito lleno de uno a la mitad, y esa es justo la diferencia que dice si
  // la unidad aguanta la semana o hay que rellenar antes. Con sí o no, los dos
  // casos se ven iguales hasta el día que uno se queda seco.
  //
  // `umbralFalla` es lo que convierte un nivel en un pendiente. A diferencia
  // del combustible —que a 1/4 solo quiere decir que hay que cargar— aquí un
  // cuarto es algo que atender, y por eso estos sí abren incidencia. La
  // gravedad no es la misma en todos —quedarse sin líquido de frenos no es
  // quedarse sin limpiaparabrisas— y va de antemano, porque a quien revisa no
  // se le puede pedir que además gradúe.
  {
    clave: 'nivel_aceite_motor',
    label: 'Aceite de motor',
    captura: 'fraccion',
    tipos: TIPOS_CON_MOTOR,
    incidencia: { severidad: 'grave', categoria: 'Niveles', nombre: 'Aceite de motor bajo' },
    umbralFalla: '1/4',
  },
  {
    clave: 'nivel_aceite_hidraulico',
    label: 'Aceite hidráulico',
    captura: 'fraccion',
    tipos: TIPOS_CON_HIDRAULICO,
    incidencia: { severidad: 'moderada', categoria: 'Niveles', nombre: 'Aceite hidráulico bajo' },
    umbralFalla: '1/4',
  },
  {
    clave: 'nivel_liquido_direccion',
    label: 'Líquido de dirección hidráulica',
    captura: 'fraccion',
    tipos: TIPOS_CON_MOTOR,
    incidencia: { severidad: 'moderada', categoria: 'Niveles', nombre: 'Líquido de dirección bajo' },
    umbralFalla: '1/4',
  },
  {
    clave: 'nivel_liquido_frenos',
    label: 'Líquido de frenos',
    captura: 'fraccion',
    tipos: TIPOS_CON_MOTOR,
    incidencia: { severidad: 'grave', categoria: 'Niveles', nombre: 'Líquido de frenos bajo' },
    umbralFalla: '1/4',
  },
  {
    clave: 'nivel_anticongelante',
    label: 'Anticongelante',
    captura: 'fraccion',
    tipos: TIPOS_CON_MOTOR,
    incidencia: { severidad: 'grave', categoria: 'Niveles', nombre: 'Anticongelante bajo' },
    umbralFalla: '1/4',
  },
  {
    clave: 'nivel_limpiaparabrisas',
    label: 'Líquido limpiaparabrisas',
    captura: 'fraccion',
    tipos: TIPOS_CON_MOTOR,
    incidencia: { severidad: 'superficial', categoria: 'Niveles', nombre: 'Líquido limpiaparabrisas bajo' },
    umbralFalla: '1/4',
  },
  {
    clave: 'llantas_marca',
    label: '¿La marca de las llantas es la registrada?',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Llantas', nombre: 'Llantas de otra marca' },
  },
  {
    clave: 'llantas_estado',
    label: '¿Las llantas están bien?',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Llantas', nombre: 'Llantas en mal estado' },
  },
  {
    clave: 'golpes',
    label: '¿Está sin golpes nuevos?',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Carrocería', preguntarSeveridad: true, nombre: 'Golpe nuevo' },
  },
  {
    clave: 'fugas',
    label: '¿Está sin manchas debajo?',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Fugas', nombre: 'Manchas debajo de la unidad' },
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
    label: '¿Los faros funcionan?',
    captura: 'ok_falla',
    tipos: TIPOS_CON_CABINA,
    incidencia: { severidad: 'moderada', categoria: 'Luces', nombre: 'Faros fundidos' },
  },
  {
    clave: 'luces_direccionales',
    label: '¿Las direccionales funcionan?',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Luces', nombre: 'Direccionales fundidas' },
  },
  {
    clave: 'luces_stops',
    label: '¿Los stops funcionan?',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Luces', nombre: 'Stops fundidos' },
  },
  {
    clave: 'luces_reversa',
    label: '¿La reversa funciona?',
    captura: 'ok_falla',
    tipos: TIPOS_CON_CABINA,
    incidencia: { severidad: 'moderada', categoria: 'Luces', nombre: 'Luz de reversa fundida' },
  },
  {
    // Los cuartos van a todos, caja de tráiler incluida: es la única luz que
    // también llevan los costados de la caja.
    //
    // Cuando sale "No", la nota pide QUÉ FOCO lleva esa unidad. No es un dato
    // del chequeo sino de la pieza que hay que comprar, y el momento de
    // anotarlo es el único en que alguien tiene el foco a la vista. Ver el
    // placeholder de la nota en `ChequeoDiarioForm`.
    clave: 'luces_cuartos',
    label: '¿Los cuartos funcionan?',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'moderada', categoria: 'Luces', nombre: 'Cuartos fundidos' },
  },
  {
    clave: 'cab_parabrisas',
    label: '¿El parabrisas está sin estrellar?',
    captura: 'ok_falla',
    tipos: TIPOS_CON_CABINA,
    incidencia: { severidad: 'superficial', categoria: 'Carrocería', nombre: 'Parabrisas estrellado' },
  },
  {
    clave: 'cab_espejos',
    label: '¿Los espejos están completos?',
    captura: 'ok_falla',
    tipos: TIPOS_CON_CABINA,
    incidencia: { severidad: 'superficial', categoria: 'Carrocería', nombre: 'Falta un espejo' },
  },
  {
    clave: 'doc_tarjeta',
    label: '¿Trae la tarjeta de circulación?',
    captura: 'ok_falla',
    tipos: TIPOS_CON_PAPELES,
    incidencia: { severidad: 'superficial', categoria: 'Documentación', nombre: 'Sin tarjeta de circulación' },
  },
  {
    clave: 'doc_poliza',
    label: '¿Trae la póliza del seguro?',
    captura: 'ok_falla',
    tipos: TIPOS_CON_PAPELES,
    incidencia: { severidad: 'superficial', categoria: 'Documentación', nombre: 'Sin póliza a bordo' },
  },
  {
    clave: 'doc_permiso',
    label: '¿Trae el permiso?',
    captura: 'ok_falla',
    tipos: TIPOS_CON_PAPELES,
    incidencia: { severidad: 'superficial', categoria: 'Documentación', nombre: 'Sin permiso a bordo' },
  },
  {
    clave: 'acc_extintor',
    label: '¿Trae extintor?',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'superficial', categoria: 'Accesorios', nombre: 'Sin extintor' },
  },
  {
    clave: 'acc_llanta_refaccion',
    label: '¿Trae llanta de refacción?',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'superficial', categoria: 'Accesorios', nombre: 'Sin llanta de refacción' },
  },
  {
    clave: 'acc_herramienta',
    label: '¿Trae herramienta?',
    captura: 'ok_falla',
    tipos: TODOS,
    incidencia: { severidad: 'superficial', categoria: 'Accesorios', nombre: 'Sin herramienta' },
  },
  {
    clave: 'caja_puertas',
    label: '¿Las puertas cierran bien?',
    captura: 'ok_falla',
    tipos: ['caja_trailer'],
    incidencia: { severidad: 'moderada', categoria: 'Carrocería', nombre: 'Puertas que no cierran' },
  },
  {
    clave: 'caja_sellos',
    label: '¿Los sellos están puestos?',
    captura: 'ok_falla',
    tipos: ['caja_trailer'],
    incidencia: { severidad: 'moderada', categoria: 'Carrocería', nombre: 'Sin sellos' },
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
