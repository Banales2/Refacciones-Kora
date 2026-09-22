// Las reglas del chequeo diario. Tres, y ninguna es obvia:
//
//   1. LA LECTURA. Si sube, el chequeo se vuelve la fuente principal del
//      odómetro de la flota. Si baja, se guarda y se reporta, no se descarta.
//   2. LAS FALLAS del checklist abren incidencia solas, con la severidad que el
//      catálogo trae de antemano.
//   3. LA DECLARACIÓN del chofer NO abre nada sola: queda pendiente de que
//      alguien la lea. Ver `docs/chequeo-diario.md` para el porqué.
import * as repo from '../repositories/chequeosRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import * as sucursalesRepo from '../repositories/sucursalesRepo'
import { fechaMexico } from '../shared/fechaMexico'
import { NotFoundError, ValidationError, ConflictError } from '../shared/errors'
import {
  itemsDe, lecturaDe, itemPorClave, nivelEsFalla, TIPOS_CON_ODOMETRO, type ItemChequeo,
} from '../shared/chequeoItems'
import { revisarDeclaracion } from '../schemas/chequeoSchema'
import type {
  ChequeoCreate, ChequeoUpdate, ChequeoRevisar, ChequeoQuery, ChequeoItemIn,
} from '../schemas/chequeoSchema'
import type { ItemAGuardar } from '../repositories/chequeosRepo'
import type { TipoVehiculo } from '../schemas/vehiculoSchema'

export interface ResultadoChequeo {
  chequeo: repo.Chequeo
  /**
   * Lo que hay que enseñarle a quien acaba de guardar. No son errores —el
   * chequeo se guardó— pero tampoco pueden quedarse callados.
   */
  avisos: string[]
}

/**
 * Traduce los renglones que llegaron del formulario a renglones guardables,
 * validando contra el catálogo.
 *
 * Aquí se rechaza una clave que no existe o que no le toca a este tipo de
 * unidad: es lo que mantiene limpia una tabla cuyas claves no tienen FK contra
 * nada. Una caja de tráiler no contesta por sus faros.
 */
function prepararItems(
  tipo: TipoVehiculo, entrada: ChequeoItemIn[], declaracion: { fecha: string }
): ItemAGuardar[] {
  const permitidos = new Map(itemsDe(tipo).map((i) => [i.clave, i]))
  const vistas = new Set<string>()

  return entrada.map((item) => {
    const def = permitidos.get(item.clave)
    if (!def) {
      // El mensaje distingue los dos casos porque se arreglan distinto: una
      // clave desconocida es un front desactualizado; una que no aplica es un
      // formulario armado para otro tipo de unidad.
      const existe = itemPorClave(item.clave)
      throw new ValidationError(
        existe
          ? `La pregunta "${existe.label}" no aplica a este tipo de unidad`
          : `Pregunta desconocida: ${item.clave}`
      )
    }
    if (vistas.has(item.clave)) {
      throw new ValidationError(`La pregunta "${def.label}" viene contestada dos veces`)
    }
    vistas.add(item.clave)

    if (def.captura === 'fraccion' && item.resultado !== 'na' && !item.valor) {
      throw new ValidationError(`Falta el nivel en "${def.label}"`)
    }
    if (def.captura === 'ok_falla' && item.valor) {
      throw new ValidationError(`"${def.label}" se contesta con sí o no, no lleva valor`)
    }
    // La severidad solo la manda la pregunta que el catálogo deja graduar. Sin
    // esto, el formulario podría decidir la gravedad de cualquier falla, que es
    // justo lo que el catálogo existe para fijar.
    if (item.severidad && !def.incidencia?.preguntarSeveridad) {
      throw new ValidationError(`"${def.label}" no lleva gravedad: la fija el sistema`)
    }

    // En una `fraccion` el resultado NO es del formulario: lo dice el nivel.
    // Si el catálogo marca que 1/4 de líquido de frenos es falla, es falla
    // aunque el teléfono mande 'ok' —una PWA vieja no conoce el umbral— y no
    // es falla aunque mande 'falla'. Lo único que el formulario decide es 'na',
    // que es lo que el nivel no puede decir: que no se pudo mirar.
    const resultado: ItemAGuardar['resultado'] =
      def.captura === 'fraccion' && item.resultado !== 'na'
        ? (nivelEsFalla(def, item.valor ?? null) ? 'falla' : 'ok')
        : (item.resultado as ItemAGuardar['resultado'])

    return {
      clave:     def.clave,
      resultado,
      valor:     item.valor ?? null,
      nota:      item.nota ?? null,
      incidencia: incidenciaDe(def, { ...item, resultado }, declaracion),
    }
  })
}

// Qué incidencia abre este renglón. Solo las fallas, y solo las preguntas que
// el catálogo marca: un TANQUE a la mitad no es un pendiente, pero un depósito
// de frenos en un cuarto sí (ver `umbralFalla`).
function incidenciaDe(
  def: ItemChequeo, item: ChequeoItemIn, ctx: { fecha: string }
): ItemAGuardar['incidencia'] {
  if (item.resultado !== 'falla' || !def.incidencia) return null
  return {
    // El nombre del pendiente, no la pregunta: quien lo atiende lee "Faros
    // fundidos", no "¿Los faros funcionan?". Si el catálogo no lo trae, cae al
    // label, que topa en los 40 de la columna.
    nombre:      (def.incidencia.nombre ?? def.label).slice(0, 40),
    // El nivel va en la descripción cuando lo hay: sin él, una incidencia de
    // "Nivel de líquido de frenos" no dice si estaba en un cuarto o seco, y esa
    // es toda la información que trae.
    descripcion: item.nota ?? (
      item.valor
        ? `En ${item.valor} al chequeo del ${ctx.fecha}`
        : `Detectado en el chequeo del ${ctx.fecha}`
    ),
    categoria:   def.incidencia.categoria,
    severidad:   item.severidad ?? def.incidencia.severidad,
  }
}

/**
 * Qué hacer con la lectura capturada.
 *
 * Solo toca el odómetro de los tipos que lo llevan (espeja TABLA_KM). A
 * diferencia del resto de los módulos, aquí la lectura manda aunque sea MENOR
 * que la registrada: el chequeo lo hace alguien parado frente al tablero, así
 * que su lectura es la buena (odómetro reemplazado, corregido, o un km de más
 * cargado antes por error) y la unidad la adopta. Se avisa igual, porque un
 * odómetro que baja también puede ser la señal de que está desconectado o lo
 * alteraron, y eso lo revisa una persona.
 */
async function aplicarLectura(
  vehiculoId: number, tipo: TipoVehiculo, lectura: number | null, kmActual: number | null
): Promise<{ avisos: string[] }> {
  const avisos: string[] = []
  if (lectura == null) return { avisos }

  const etiqueta = lecturaDe(tipo)?.label ?? 'La lectura'
  const retrocede = kmActual != null && lectura < kmActual

  if (TIPOS_CON_ODOMETRO.includes(tipo)) {
    if (retrocede) await vehiculosRepo.fijarKilometraje(vehiculoId, lectura)
    else           await vehiculosRepo.avanzarKilometraje(vehiculoId, lectura)
  }

  if (retrocede) {
    avisos.push(
      `${etiqueta} capturado (${lectura.toLocaleString('es-MX')}) es menor que el registrado ` +
      `(${kmActual!.toLocaleString('es-MX')}). Se tomó como bueno y el odómetro de la unidad bajó a esa lectura.`
    )
  }
  return { avisos }
}

export async function getByVehiculo(vehiculoId: number) {
  await vehiculosRepo.findById(vehiculoId) // 404 si no existe
  return repo.findByVehiculo(vehiculoId)
}

/** El chequeo de hoy de una unidad, o null si nadie lo ha hecho. */
export async function getDelDia(vehiculoId: number, fecha?: string) {
  return repo.findDelDia(vehiculoId, fecha ?? fechaMexico())
}

export async function getDeclarantes() {
  return repo.findDeclarantes()
}

/**
 * Las preguntas que le tocan a una unidad. El formulario las pide al abrirse en
 * vez de deducirlas: así una pregunta nueva aparece en los teléfonos sin
 * esperar a que cada uno actualice la aplicación instalada.
 */
export async function getFormulario(vehiculoId: number) {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')
  return {
    vehiculo_id: vehiculo.id,
    tipo:        vehiculo.tipo,
    kilometraje: vehiculo.kilometraje,
    lectura:     lecturaDe(vehiculo.tipo),
    items:       itemsDe(vehiculo.tipo),
  }
}

export async function getRango(params: ChequeoQuery) {
  const hoy = fechaMexico()
  return repo.findRango({
    desde: params.desde ?? hoy,
    hasta: params.hasta ?? params.desde ?? hoy,
    vehiculoId: params.vehiculo_id,
    soloPorRevisar: params.filtro === 'por_revisar',
  })
}

/**
 * La cifra del tablero: cuántas unidades activas llevan chequeo hoy y cuáles
 * faltan, más la bandeja de declaraciones sin leer.
 *
 * Las dos juntas porque son la misma pregunta desde dos lados: la cobertura
 * dice si el chequeo se está haciendo, y las declaraciones pendientes dicen si
 * está sirviendo de algo.
 */
export async function getResumenHoy(fecha?: string) {
  const dia = fecha ?? fechaMexico()
  // La cobertura es de hoy; los reportes sin leer NO. Un reporte del viernes
  // que nadie revisó sigue sin revisar el lunes, y la bandeja tiene que
  // vaciarse, no rotar con el calendario.
  const [total, faltan, porRevisar] = await Promise.all([
    repo.contarActivas(),
    repo.findSinChequeo(dia),
    repo.findPorRevisar(),
  ])
  return {
    fecha:      dia,
    total,
    revisadas:  total - faltan.length,
    faltan,
    por_revisar: porRevisar,
  }
}

/**
 * El recorrido del patio: qué le falta a esta sucursal hoy.
 *
 * Dos listas, porque son dos cosas distintas:
 *   `base`        las unidades que viven en esta sucursal. El sistema sabe de
 *                 antemano que deberían estar ahí, así que puede reclamarlas.
 *   `visitantes`  lo que se revisó aquí sin tener base aquí: un tractocamión
 *                 que amaneció en este patio. No se predicen —nadie puede saber
 *                 dónde durmió una caja— y por eso solo aparecen después de
 *                 revisarlas, cuando su `ubicacion` ya lo dice.
 *
 * `ubicacion` viaja en la respuesta para que la pantalla la escriba tal cual en
 * cada chequeo: de esa igualdad depende que las visitantes se puedan encontrar.
 */
export async function getPatio(sucursalId: number, fecha?: string) {
  const sucursal = await sucursalesRepo.findById(sucursalId)
  if (!sucursal) throw new NotFoundError('Sucursal')

  const dia = fecha ?? fechaMexico()
  const [base, visitantes] = await Promise.all([
    repo.findPatio(sucursalId, dia),
    repo.findVisitantes(sucursalId, sucursal.nombre, dia),
  ])

  return {
    fecha: dia,
    sucursal: { id: sucursal.id, nombre: sucursal.nombre },
    ubicacion: sucursal.nombre,
    base,
    visitantes,
    pendientes: base.filter((u) => u.chequeo_id == null).length,
  }
}

/**
 * Qué decirle a quien acaba de guardar sobre lo que salió mal.
 *
 * Son dos cosas distintas y por eso son dos frases: las fallas nuevas abrieron
 * su incidencia, y las que ya venían de días pasados se engancharon a la que
 * seguía abierta. Contarlas juntas diría "se abrieron 5 incidencias" cuando se
 * abrieron dos, y a la tercera vez que pasa nadie vuelve a leer el aviso.
 *
 * El arrastre no se calla por no haber abierto nada: es justo lo contrario de
 * una buena noticia. Una falla que lleva cuatro días es peor que una de hoy, y
 * el aviso es el único lugar donde quien recorre se entera.
 */
function avisosDeIncidencias(chequeo: repo.Chequeo): string[] {
  const avisos: string[] = []
  const conIncidencia = chequeo.items.filter((i) => i.pendiente_id != null)
  const dia = soloFecha(chequeo.fecha)!
  // La de hoy la abrió este chequeo; una anterior ya estaba abierta.
  const desde = (i: repo.ChequeoItem) => soloFecha(i.incidencia_desde) ?? dia
  const nuevas   = conIncidencia.filter((i) => desde(i) >= dia)
  const arrastre = conIncidencia.filter((i) => desde(i) <  dia)

  if (nuevas.length > 0) {
    avisos.push(nuevas.length === 1
      ? 'Se abrió 1 incidencia por lo que salió mal.'
      : `Se abrieron ${nuevas.length} incidencias por lo que salió mal.`)
  }
  for (const i of arrastre) {
    const def = itemPorClave(i.clave)
    avisos.push(
      `"${def?.label ?? i.clave}" sigue fallando desde el ${fechaCorta(desde(i))}: ` +
      `se ligó a la incidencia que ya estaba abierta, no se abrió otra.`
    )
  }
  return avisos
}

/**
 * mssql devuelve las columnas `date` como objetos Date, no como el string que
 * dice el tipo: la conversión ocurre al serializar la respuesta, que es después
 * de esto. Sin esto, comparar dos fechas aquí compara un Date con un string.
 */
function soloFecha(d: string | Date | null | undefined): string | null {
  if (d == null) return null
  return (d instanceof Date ? d.toISOString() : d).split('T')[0]
}

/** "2026-09-18" → "18/09". El año sobra en un aviso del día. */
function fechaCorta(fecha: string): string {
  const [, m, d] = fecha.split('-')
  return `${d}/${m}`
}

export async function create(
  vehiculoId: number, data: ChequeoCreate, revisadoPor: string
): Promise<ResultadoChequeo> {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')

  const fecha = data.fecha ?? fechaMexico()

  // El índice único lo impediría de todos modos, pero el error del motor no le
  // dice a nadie qué hacer. El de aquí sí: el de hoy se corrige.
  const existente = await repo.findDelDia(vehiculoId, fecha)
  if (existente) {
    throw new ConflictError(
      `Esta unidad ya tiene chequeo del ${fecha}. Corrige ese en vez de capturar otro.`
    )
  }

  const items = prepararItems(vehiculo.tipo, data.items, { fecha })
  validarLectura(vehiculo.tipo, data.lectura ?? null)
  validarBaja(vehiculo.tipo, data.lectura ?? null, vehiculo.kilometraje, data.confirmar_baja)

  const chequeo = await repo.create({
    vehiculo_id:   vehiculoId,
    fecha,
    hora:          data.hora ?? null,
    ubicacion:     data.ubicacion,
    conductor_id:  data.conductor_id ?? null,
    // Sin chofer no hay nombre ni reporte: el esquema ya lo exigió, aquí se
    // normaliza para que no quede un resto de un formulario a medio contestar.
    declarado_por: data.sin_chofer ? null : (data.declarado_por ?? null),
    hay_novedad:   data.sin_chofer ? false : data.hay_novedad,
    sin_chofer:    data.sin_chofer,
    declaracion:   !data.sin_chofer && data.hay_novedad ? (data.declaracion ?? null) : null,
    lectura:          data.lectura ?? null,
    // La foto del odómetro ANTES de que este chequeo lo mueva. Se toma aquí,
    // que es la única oportunidad: en cuanto se llama a avanzarKilometraje ya
    // no se puede saber qué traía.
    lectura_anterior: vehiculo.kilometraje,
    nota:          data.nota ?? null,
  }, items, revisadoPor)

  const { avisos } = await aplicarLectura(
    vehiculoId, vehiculo.tipo, data.lectura ?? null, vehiculo.kilometraje
  )

  avisos.push(...avisosDeIncidencias(chequeo))
  if (chequeo.hay_novedad) {
    avisos.push('El reporte del chofer quedó pendiente de revisión.')
  }
  if (chequeo.sin_chofer) {
    avisos.push('Quedó anotado que no había chofer a quien preguntarle.')
  }

  return { chequeo, avisos }
}

// Una unidad que no lleva lectura no puede traer uno: la caja de tráiler no
// tiene odómetro ni horómetro, y aceptarle un número sería guardar un dato que
// nadie puede haber leído.
function validarLectura(tipo: TipoVehiculo, lectura: number | null) {
  if (lectura != null && !lecturaDe(tipo)) {
    throw new ValidationError('Este tipo de unidad no lleva odómetro ni horómetro')
  }
}

/**
 * Una lectura menor que la registrada hace RETROCEDER el odómetro de la unidad
 * (ver `aplicarLectura`), y de ese dato cuelga la proyección de preventivos por
 * kilómetro. La causa más común no es un odómetro reemplazado: es un dígito mal
 * tecleado con el teléfono en la mano. Por eso no pasa sin un `confirmar_baja`
 * explícito, y se frena ANTES de guardar nada: un aviso después del alta no
 * deshace el chequeo ni el odómetro que ya se movió.
 *
 * El formulario lo pregunta (`ConfirmarLecturaMenor`); esto es lo que hace que
 * la pregunta no se pueda saltar.
 */
function validarBaja(
  tipo: TipoVehiculo, lectura: number | null, kmActual: number | null, confirmada: boolean
) {
  if (lectura == null || kmActual == null || lectura >= kmActual || confirmada) return
  const etiqueta = lecturaDe(tipo)?.label ?? 'La lectura'
  throw new ValidationError(
    `${etiqueta} capturado (${lectura.toLocaleString('es-MX')}) es menor que el registrado ` +
    `(${kmActual.toLocaleString('es-MX')}) y haría bajar el odómetro de la unidad. ` +
    `Revisa la lectura, o vuelve a enviarla confirmando la baja.`
  )
}

export async function update(
  id: number, data: ChequeoUpdate, revisadoPor: string
): Promise<ResultadoChequeo> {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Chequeo')

  const vehiculo = await vehiculosRepo.findById(actual.vehiculo_id)
  if (!vehiculo) throw new NotFoundError('Vehículo')

  const items = data.items
    ? prepararItems(vehiculo.tipo, data.items, { fecha: actual.fecha })
    : undefined

  if (data.lectura !== undefined) {
    validarLectura(vehiculo.tipo, data.lectura ?? null)
    // Solo si de verdad cambia: corregir la ubicación de un chequeo cuya lectura
    // ya estaba abajo no vuelve a preguntar, porque esa corrección no mueve el
    // odómetro (es la misma condición con la que se llama a `aplicarLectura`).
    if (data.lectura !== actual.lectura) {
      validarBaja(vehiculo.tipo, data.lectura ?? null, vehiculo.kilometraje, data.confirmar_baja)
    }
  }

  // El estado de la declaración se arma mezclando lo guardado con lo que viene,
  // y se juzga entero: un payload parcial no se puede validar solo (mandar solo
  // los renglones dejaría `declarado_por` ausente y parecería que falta).
  const sinChofer  = data.sin_chofer ?? actual.sin_chofer
  // Sin novedad no lleva texto: si alguien corrige "sí pasó algo" a "no pasó
  // nada", la declaración se va con ella en vez de quedar colgando. Y sin
  // chofer no hay ni novedad ni nombre.
  const hayNovedad = sinChofer ? false : (data.hay_novedad ?? actual.hay_novedad)
  const declaradoPor = sinChofer
    ? null
    : (data.declarado_por !== undefined ? (data.declarado_por ?? null) : actual.declarado_por)
  const declaracion = sinChofer ? null : (
    data.declaracion !== undefined
      ? (hayNovedad ? (data.declaracion ?? null) : null)
      : (hayNovedad ? actual.declaracion : null)
  )

  const problema = revisarDeclaracion({
    hay_novedad: hayNovedad, sin_chofer: sinChofer,
    declarado_por: declaradoPor, declaracion,
  })
  if (problema) throw new ValidationError(problema)

  const chequeo = await repo.update(id, {
    hora:          data.hora,
    ubicacion:     data.ubicacion,
    conductor_id:  data.conductor_id,
    declarado_por: declaradoPor,
    hay_novedad:   hayNovedad,
    sin_chofer:    sinChofer,
    declaracion,
    lectura:       data.lectura,
    nota:          data.nota,
  }, items, revisadoPor)
  if (!chequeo) throw new NotFoundError('Chequeo')

  const avisos: string[] = []
  if (data.lectura != null && data.lectura !== actual.lectura) {
    const res = await aplicarLectura(
      actual.vehiculo_id, vehiculo.tipo, data.lectura, vehiculo.kilometraje
    )
    avisos.push(...res.avisos)
  }
  // Corregir un chequeo también abre incidencias: una pregunta que estaba en
  // "sí" y se corrige a "no" es una falla que nadie había reportado.
  avisos.push(...avisosDeIncidencias(chequeo))

  return { chequeo, avisos }
}

/**
 * Leer la declaración y decidir qué hacer con ella. Es la mitad del valor del
 * módulo: una declaración que nadie revisa deja constancia de que alguien avisó
 * y nadie hizo nada, que es peor que no haber preguntado.
 */
export async function revisar(
  id: number, data: ChequeoRevisar, revisadaPor: string
): Promise<repo.Chequeo> {
  const chequeo = await repo.findById(id)
  if (!chequeo) throw new NotFoundError('Chequeo')

  if (!chequeo.hay_novedad) {
    throw new ValidationError('Este chequeo no trae ningún reporte que revisar')
  }
  if (chequeo.revisada_en) {
    throw new ConflictError(`Este reporte ya lo revisó ${chequeo.revisada_por}`)
  }

  await repo.revisar(
    chequeo,
    revisadaPor,
    data.nota ?? null,
    data.abrir_incidencia
      ? { severidad: data.severidad!, categoria: data.categoria ?? 'Reporte del chofer' }
      : null,
  )
  return (await repo.findById(id))!
}
