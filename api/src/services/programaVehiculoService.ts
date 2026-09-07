// El programa de mantenimiento visto desde una unidad: en qué etapa va, en qué
// punto del recorrido está, qué le toca en la próxima visita, y qué renglones
// se le vencieron por su cuenta.
//
// Aquí se junta lo grupal con lo individual. El kilometraje avanza por columnas
// —toda la columna se hace en la misma visita— y el tiempo corre por renglón,
// cada uno con su "o cada N meses". Un renglón puede vencer por meses mucho
// antes de que llegue el kilometraje de su columna, y entonces se atiende solo,
// sin adelantar el resto.
//
// Y aquí se decide la etapa. Una unidad nueva sigue el programa del fabricante
// porque su garantía depende de que se cumpla: no llevarla a sus servicios es
// motivo para perderla. Cuando la garantía principal de su modelo se acaba, esa
// obligación desaparece y la unidad pasa al programa de después de la garantía,
// más libre. La etapa no se guarda —se calcula contra la garantía, igual que el
// vencimiento de la garantía se calcula contra la fecha y el odómetro—; lo
// único que sí se guarda es la decisión de una persona (`forzada`).
//
// De ahí sale también la alerta que más importa de todo el módulo: un servicio
// vencido en una unidad que TODAVÍA está en garantía no es un vencido
// cualquiera, es una garantía en riesgo.
import * as repo from '../repositories/programaVehiculoRepo'
import * as programaRepo from '../repositories/programaRepo'
import * as garantiasRepo from '../repositories/garantiasRepo'
import { proximosServicios } from './programaService'
import { NotFoundError, ValidationError } from '../shared/errors'
import { fechaMexico } from '../shared/fechaMexico'
import { evaluarGarantia, type EstadoGarantia } from '../shared/garantias'
import type { Fase, Operacion, ProgramaCompleto } from '../repositories/programaRepo'
import type {
  Etapa, VinculoPrograma, Visita, EstadoOperacion, Excepciones,
} from '../repositories/programaVehiculoRepo'
import type { GarantiaPrincipal } from '../repositories/garantiasRepo'

// Fracción del intervalo que basta haber recorrido para avisar.
const AVISO_KM = 0.75

// Cuántas visitas hacia adelante se proyectan. Ver getEstado.
const HORIZONTE_PROYECCION = 8

// Cuánto se multiplica la urgencia de un servicio vencido cuando la unidad
// sigue en garantía. No es cosmético: es la única alerta del sistema donde el
// atraso cuesta dinero directo —la garantía— además del desgaste, así que tiene
// que quedar por encima de todo lo demás en la lista del tablero.
const PESO_GARANTIA_EN_RIESGO = 10

function proyectar(servicios: ServicioPendiente[]): ProyeccionCostos {
  return {
    visitas:   servicios.length,
    costo:     servicios.reduce((s, v) => s + (v.fase.costo ?? 0), 0),
    sin_costo: servicios.filter((v) => v.fase.costo == null).length,
    hasta_km:  servicios.length ? servicios[servicios.length - 1].km_odometro : null,
  }
}

// ─── Cálculo ────────────────────────────────────────────────────────────────

function diffMeses(desde: string, hasta: string): number {
  const a = new Date(`${desde.split('T')[0]}T12:00:00`)
  const b = new Date(`${hasta.split('T')[0]}T12:00:00`)
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

function aFecha(d: string | Date | null | undefined): string | null {
  if (d == null) return null
  return (d instanceof Date ? d.toISOString() : d).split('T')[0]
}

export interface OperacionDeFase {
  operacion: Operacion
  accion:    string
}

export interface ServicioPendiente {
  indice:      number
  fase:        Fase
  /** Kilómetros recorridos desde el arranque a los que cae esta visita. */
  km_recorrido: number
  /** El mismo punto leído en el odómetro, ya sumado el arranque de la unidad. */
  km_odometro: number
  /** Cuánto se recorre desde la visita anterior: es el intervalo de esta. */
  intervalo:   number
  km_faltantes: number | null
  vencida:     boolean
  por_vencer:  boolean
  operaciones: OperacionDeFase[]
}

export interface OperacionPorTiempo {
  operacion:    Operacion
  /** Nulo = nunca se ha atendido; se cuenta desde el arranque del programa. */
  ultima_fecha: string | null
  meses:        number | null
  vencida:      boolean
  por_vencer:   boolean
}

// Lo que va a costar el mantenimiento programado de aquí en adelante, sumando
// lo que el taller cotizó por cada columna. Las columnas sin cotizar no se
// cuentan como cero: se dicen aparte, para que el total se lea sabiendo qué
// tanto le falta.
export interface ProyeccionCostos {
  /** Cuántas visitas entraron en la proyección. */
  visitas:    number
  /** Suma de lo cotizado de esas visitas. */
  costo:      number
  /** Cuántas de esas visitas no tienen costo capturado. */
  sin_costo:  number
  /** Odómetro hasta el que llega la proyección. */
  hasta_km:   number | null
}

/**
 * De dónde salió el punto cero del recorrido de la etapa activa.
 *
 * - `capturado`  alguien lo escribió a mano y gana sobre cualquier cálculo.
 * - `ultimo_servicio`  el kilometraje y la fecha del último servicio que la
 *   unidad realmente recibió bajo el programa anterior. Es el caso normal al
 *   pasar a posgarantía: el reloj arranca donde quedó el último preventivo.
 * - `vencimiento_garantia`  la unidad nunca cerró un servicio del programa
 *   anterior, así que se usa el punto en que se le acabó la garantía.
 * - `arranque_anterior`  ni lo uno ni lo otro se pudo calcular; se hereda el
 *   arranque de la etapa anterior para no dejar el recorrido sin punto cero.
 */
export type OrigenArranque =
  | 'capturado' | 'ultimo_servicio' | 'vencimiento_garantia' | 'arranque_anterior'

export interface Arranque {
  km:     number
  fecha:  string | null
  origen: OrigenArranque
}

/** La garantía que decide la etapa, con su vigencia ya resuelta. */
export interface GarantiaDeEtapa {
  id:     number
  nombre: string
  estado: EstadoGarantia
}

export interface EstadoPrograma {
  /** La etapa activa hoy. */
  etapa:              Etapa
  /** Una persona la fijó: el cálculo contra la garantía no manda. */
  etapa_forzada:      boolean
  /**
   * La garantía principal del modelo, copiada en esta unidad. Null cuando el
   * modelo no declara ninguna, o cuando la unidad no la tiene: entonces no hay
   * nada que vencer y se sigue el programa del fabricante.
   */
  garantia:           GarantiaDeEtapa | null
  /**
   * Hay servicio vencido y la garantía sigue viva. Es lo que convierte un
   * atraso en un riesgo de perderla.
   */
  garantia_en_riesgo: boolean
  /** La unidad ya salió de garantía pero su modelo no tiene el segundo programa. */
  falta_posgarantia:  boolean
  vinculo:            VinculoPrograma
  arranque:           Arranque
  /** El catálogo del modelo, ya con las excepciones de esta unidad aplicadas. */
  programa:           ProgramaCompleto
  excepciones:        Excepciones
  visitas:            Visita[]
  estados:            EstadoOperacion[]
  servicios_hechos:   number
  kilometraje:        number | null
  /** Kilómetros recorridos bajo la etapa: odómetro menos el arranque. */
  km_recorrido:       number | null
  proxima:            ServicioPendiente | null
  /** Las que vienen después, para que el taller pueda planear. */
  siguientes:         ServicioPendiente[]
  proyeccion:         ProyeccionCostos
  operaciones_tiempo: OperacionPorTiempo[]
}

/**
 * El catálogo del modelo con lo que esta unidad hace distinto ya encima.
 *
 * Se aplica una sola vez, antes de cualquier cálculo, para que el resto del
 * módulo siga trabajando contra un `ProgramaCompleto` normal y no tenga que
 * acordarse de las excepciones en cada cuenta. Una fase omitida desaparece del
 * recorrido —y con ella sus celdas—; una operación apagada desaparece del
 * renglonero. Lo que la unidad no tocó viene del catálogo tal cual, que es la
 * razón de guardar solo diferencias (migración 016).
 */
export function aplicarExcepciones(
  programa: ProgramaCompleto, exc: Excepciones,
): ProgramaCompleto {
  if (!exc.fases.length && !exc.operaciones.length) return programa

  const porFase = new Map(exc.fases.map((f) => [f.fase_id, f]))
  const porOp   = new Map(exc.operaciones.map((o) => [o.operacion_id, o]))

  const fases = programa.fases
    .filter((f) => !porFase.get(f.id)?.omitida)
    .map((f) => {
      const e = porFase.get(f.id)
      if (!e) return f
      return { ...f, km: e.km ?? f.km, costo: e.costo ?? f.costo }
    })
    // Correr una marca puede alterar el orden de las columnas, y el recorrido
    // se lee en orden de kilometraje: sin reordenar, el salto hacia la
    // siguiente fase saldría negativo.
    .sort((a, b) => a.km - b.km)
    .map((f, i) => ({ ...f, orden: i }))

  const vivas = new Set(fases.map((f) => f.id))
  const operaciones = programa.operaciones
    .filter((o) => porOp.get(o.id)?.activa !== false)
    .map((o) => {
      const e = porOp.get(o.id)
      const celdas = Object.fromEntries(
        Object.entries(o.celdas).filter(([faseId]) => vivas.has(Number(faseId)))
      )
      return { ...o, celdas, limite_meses: e?.limite_meses ?? o.limite_meses }
    })

  return { ...programa, fases, operaciones }
}

// Las operaciones que una columna manda hacer, con la acción de su celda.
function operacionesDeFase(programa: ProgramaCompleto, faseId: number): OperacionDeFase[] {
  return programa.operaciones
    .filter((o) => o.celdas[faseId])
    .map((o) => ({ operacion: o, accion: o.celdas[faseId] }))
}

function armarServicios(
  programa:        ProgramaCompleto,
  serviciosHechos: number,
  kmInicio:        number,
  kilometraje:     number | null,
  cuantos:         number,
): ServicioPendiente[] {
  // Se pide el recorrido desde cero para tener también el punto anterior: el
  // intervalo de una visita es la distancia con la que la precede, y sin él no
  // se puede decir cuándo empezar a avisar.
  const todos = proximosServicios(programa.fases, 0, serviciosHechos + cuantos)
  const kmRecorrido = kilometraje != null ? kilometraje - kmInicio : null

  return todos
    .filter((s) => s.indice >= serviciosHechos)
    .map((s) => {
      const previo    = todos.find((t) => t.indice === s.indice - 1)
      const intervalo = s.km - (previo?.km ?? 0)
      const faltantes = kmRecorrido != null ? s.km - kmRecorrido : null
      return {
        indice:       s.indice,
        fase:         s.fase,
        km_recorrido: s.km,
        km_odometro:  kmInicio + s.km,
        intervalo,
        km_faltantes: faltantes,
        vencida:      kmRecorrido != null && kmRecorrido >= s.km,
        por_vencer:   kmRecorrido != null && kmRecorrido >= s.km - intervalo * (1 - AVISO_KM),
        operaciones:  operacionesDeFase(programa, s.fase.id),
      }
    })
}

// Los renglones que corren por tiempo, con su límite medido contra la última
// vez que se atendieron —o contra el arranque de la etapa, si nunca—.
function armarOperacionesTiempo(
  programa: ProgramaCompleto,
  arranque: string | null,
  estados:  EstadoOperacion[],
  hoy:      string,
): OperacionPorTiempo[] {
  const porOperacion = new Map(estados.map((e) => [e.operacion_id, e]))

  return programa.operaciones
    .filter((o) => o.limite_meses != null)
    .map((o) => {
      const estado = porOperacion.get(o.id)
      const desde  = aFecha(estado?.ultima_fecha) ?? arranque
      const meses  = desde ? diffMeses(desde, hoy) : null
      return {
        operacion:    o,
        ultima_fecha: aFecha(estado?.ultima_fecha),
        meses,
        vencida:    meses != null && meses >= o.limite_meses!,
        por_vencer: meses != null && meses >= o.limite_meses! - 1,
      }
    })
}

// ─── Etapa ──────────────────────────────────────────────────────────────────

function evaluarPrincipal(
  g: GarantiaPrincipal | null, kilometraje: number | null, hoy: string,
): GarantiaDeEtapa | null {
  if (!g) return null
  return { id: g.garantia_id, nombre: g.nombre, estado: evaluarGarantia(g, kilometraje, hoy) }
}

interface EtapaResuelta {
  etapa:             Etapa
  forzada:           boolean
  falta_posgarantia: boolean
}

/**
 * En qué etapa va la unidad hoy.
 *
 * La decisión de una persona gana sobre el cálculo: `forzada` sirve tanto para
 * quedarse en el programa del fabricante con la garantía ya vencida como para
 * saltar antes de tiempo —la unidad que la perdió por un choque, o la que se
 * compró usada y nunca la tuvo—.
 *
 * Sin garantía principal, o con ella todavía viva, se sigue el del fabricante.
 * Y si la garantía ya venció pero el modelo no tiene capturado el segundo
 * programa, tampoco se salta: se queda donde está y lo dice, que es preferible
 * a dejar a la unidad sin ningún programa que seguir.
 */
function resolverEtapa(
  vinculos: VinculoPrograma[], garantia: GarantiaDeEtapa | null,
): EtapaResuelta {
  const forzada = vinculos.find((v) => v.forzada)
  if (forzada) return { etapa: forzada.etapa, forzada: true, falta_posgarantia: false }

  const fueraDeGarantia = garantia != null && !garantia.estado.vigente
  if (!fueraDeGarantia) {
    return { etapa: 'fabricante', forzada: false, falta_posgarantia: false }
  }

  const tienePos = vinculos.some((v) => v.etapa === 'posgarantia')
  return {
    etapa: tienePos ? 'posgarantia' : 'fabricante',
    forzada: false,
    falta_posgarantia: !tienePos,
  }
}

/**
 * El punto cero del recorrido de la etapa activa.
 *
 * Para el programa del fabricante es lo que se capturó al dar de alta la
 * unidad. Para el de posgarantía, lo normal es que no se capture nada y salga
 * de aquí: el último servicio que la unidad realmente recibió bajo el programa
 * del fabricante. Arrancar en el vencimiento de la garantía pediría un servicio
 * a los pocos kilómetros de haber hecho uno; arrancar donde quedó el último es
 * lo que hace que el segundo programa continúe al primero en vez de solaparse.
 */
function resolverArranque(
  etapa:     Etapa,
  vinculo:   VinculoPrograma,
  anterior:  VinculoPrograma | undefined,
  visitas:   Visita[],
  garantia:  GarantiaDeEtapa | null,
): Arranque {
  if (vinculo.km_inicio != null) {
    return { km: vinculo.km_inicio, fecha: aFecha(vinculo.fecha_inicio), origen: 'capturado' }
  }
  if (etapa === 'posgarantia') {
    // Las visitas llegan ordenadas por etapa e índice: la última del fabricante
    // es la más avanzada de su recorrido.
    const previas = visitas.filter((v) => v.etapa === 'fabricante' && v.km != null)
    const ultima  = previas[previas.length - 1]
    if (ultima) {
      return { km: ultima.km!, fecha: aFecha(ultima.fecha), origen: 'ultimo_servicio' }
    }
    const vence = garantia?.estado
    if (vence?.vence_a_los_km != null) {
      return {
        km: vence.vence_a_los_km, fecha: vence.vence_el, origen: 'vencimiento_garantia',
      }
    }
  }
  return {
    km:     anterior?.km_inicio ?? 0,
    fecha:  aFecha(anterior?.fecha_inicio),
    origen: 'arranque_anterior',
  }
}

// ─── Lectura ────────────────────────────────────────────────────────────────

export async function getEstado(vehiculoId: number): Promise<EstadoPrograma | null> {
  const [vinculos, visitas, estados, datos, principal, excepciones] = await Promise.all([
    repo.findVinculos(vehiculoId),
    repo.findVisitas(vehiculoId),
    repo.findEstados(vehiculoId),
    repo.findDatosVehiculo(vehiculoId),
    garantiasRepo.findPrincipalDeVehiculo(vehiculoId),
    repo.findExcepciones(vehiculoId),
  ])
  if (!vinculos.length) return null

  const hoy         = fechaMexico()
  const kilometraje = datos?.kilometraje ?? null
  const garantia    = evaluarPrincipal(principal, kilometraje, hoy)
  const resuelta    = resolverEtapa(vinculos, garantia)

  const vinculo = vinculos.find((v) => v.etapa === resuelta.etapa)
  if (!vinculo) return null

  const base = await programaRepo.findById(vinculo.programa_id)
  if (!base) return null
  const programa = aplicarExcepciones(base, excepciones)

  const arranque = resolverArranque(
    resuelta.etapa, vinculo,
    vinculos.find((v) => v.etapa !== resuelta.etapa),
    visitas, garantia,
  )

  // Solo las de esta etapa cuentan para el recorrido: el programa de
  // posgarantía arranca su propio índice en cero (migración 016).
  const visitasEtapa = visitas.filter((v) => v.etapa === resuelta.etapa)

  // Ocho visitas por delante: con el ELF eso es una vuelta larga del ciclo, que
  // es el horizonte con el que se planea un presupuesto sin inventar cuánto va
  // a rodar la unidad por mes.
  const servicios = armarServicios(
    programa, visitasEtapa.length, arranque.km, kilometraje, HORIZONTE_PROYECCION,
  )

  const operacionesTiempo = armarOperacionesTiempo(
    programa, arranque.fecha ?? aFecha(datos?.fecha_compra), estados, hoy,
  )

  const hayVencido =
    (servicios[0]?.vencida ?? false) || operacionesTiempo.some((o) => o.vencida)

  return {
    etapa:         resuelta.etapa,
    etapa_forzada: resuelta.forzada,
    garantia,
    // Solo bajo el programa del fabricante: en posgarantía ya no hay nada que
    // arriesgar, y con la garantía vencida tampoco.
    garantia_en_riesgo:
      resuelta.etapa === 'fabricante' && (garantia?.estado.vigente ?? false) && hayVencido,
    falta_posgarantia: resuelta.falta_posgarantia,
    vinculo:      { ...vinculo, fecha_inicio: aFecha(vinculo.fecha_inicio) },
    arranque,
    programa,
    excepciones,
    visitas:      visitas.map((v) => ({ ...v, fecha: aFecha(v.fecha)! })),
    estados:      estados.map((e) => ({ ...e, ultima_fecha: aFecha(e.ultima_fecha)! })),
    servicios_hechos: visitasEtapa.length,
    kilometraje,
    km_recorrido: kilometraje != null ? kilometraje - arranque.km : null,
    proxima:      servicios[0] ?? null,
    siguientes:   servicios.slice(1),
    proyeccion:   proyectar(servicios),
    operaciones_tiempo: operacionesTiempo,
  }
}

// ─── Vínculo ────────────────────────────────────────────────────────────────

export async function asignar(
  vehiculoId: number,
  data: {
    etapa?: Etapa
    programa_id?: number | null
    km_inicio?: number | null
    fecha_inicio?: string | null
  },
) {
  const datos = await repo.findDatosVehiculo(vehiculoId)
  if (!datos) throw new NotFoundError('Vehículo')

  const etapa    = data.etapa ?? 'fabricante'
  const vinculos = await repo.findVinculos(vehiculoId)
  const actual   = vinculos.find((v) => v.etapa === etapa)

  const programaId = data.programa_id ?? actual?.programa_id
  if (programaId == null) throw new ValidationError('Falta el programa de mantenimiento')

  const programa = await programaRepo.findCabecera(programaId)
  if (!programa) throw new NotFoundError('Programa de mantenimiento')
  // El programa es del modelo: aplicárselo a una unidad de otro modelo daría un
  // recorrido que no corresponde a esa máquina.
  if (programa.modelo_id !== datos.modelo_id) {
    throw new ValidationError('Ese programa es de otro modelo')
  }
  // Y la etapa se sigue con el programa de su tipo: poner el del fabricante
  // como programa de posgarantía dejaría a la unidad repitiendo el manual
  // cuando ya no tiene por qué.
  if (programa.tipo !== etapa) {
    throw new ValidationError(
      etapa === 'fabricante'
        ? 'La etapa en garantía se sigue con el programa del fabricante'
        : 'La etapa de después de la garantía se sigue con el programa de posgarantía'
    )
  }

  return repo.setVinculo({
    vehiculo_id:  vehiculoId,
    etapa,
    programa_id:  programaId,
    // El arranque del fabricante por omisión es el odómetro de hoy: una unidad
    // que se da de alta con 40,000 km no debe nacer con ocho servicios
    // vencidos. El de posgarantía se deja nulo a propósito, para que salga del
    // último servicio recibido (ver resolverArranque); solo se guarda cuando
    // alguien lo escribe.
    km_inicio: data.km_inicio !== undefined
      ? data.km_inicio
      : (actual?.km_inicio ?? (etapa === 'fabricante' ? datos.kilometraje ?? 0 : null)),
    fecha_inicio: data.fecha_inicio !== undefined
      ? data.fecha_inicio
      : (aFecha(actual?.fecha_inicio)
         ?? (etapa === 'fabricante' ? aFecha(datos.fecha_compra) : null)),
    forzada: actual?.forzada ?? false,
  })
}

export async function quitar(vehiculoId: number, etapa: Etapa = 'fabricante') {
  if (!await repo.removeVinculo(vehiculoId, etapa)) {
    throw new NotFoundError('Programa de la unidad')
  }
}

/**
 * Fija la etapa a mano, o la suelta (`null`) para que vuelva a decidirla la
 * garantía. Forzar 'posgarantia' en una unidad cuyo modelo no tiene ese
 * programa no se acepta: la dejaría sin nada que seguir.
 */
export async function setEtapa(vehiculoId: number, etapa: Etapa | null) {
  const vinculos = await repo.findVinculos(vehiculoId)
  if (!vinculos.length) throw new NotFoundError('Programa de la unidad')
  if (etapa && !vinculos.some((v) => v.etapa === etapa)) {
    throw new ValidationError(
      etapa === 'posgarantia'
        ? 'Esta unidad no tiene asignado un programa de después de la garantía'
        : 'Esta unidad no tiene asignado el programa del fabricante'
    )
  }
  await repo.setEtapaForzada(vehiculoId, etapa)
  return getEstado(vehiculoId)
}

/**
 * Lo que esta unidad hace distinto del programa de su modelo.
 *
 * Solo se guardan las filas que efectivamente cambian algo: una excepción que
 * repite el catálogo se descarta aquí, porque guardarla congelaría a la unidad
 * en el valor de hoy y una corrección al programa del modelo ya no la
 * alcanzaría —que es justamente lo que este mecanismo viene a evitar—.
 */
export async function setExcepciones(vehiculoId: number, exc: Excepciones) {
  const vinculos = await repo.findVinculos(vehiculoId)
  if (!vinculos.length) throw new NotFoundError('Programa de la unidad')

  const programas = await Promise.all(
    vinculos.map((v) => programaRepo.findById(v.programa_id))
  )
  const fasesValidas = new Set<number>()
  const opsValidas   = new Set<number>()
  for (const p of programas) {
    if (!p) continue
    for (const f of p.fases)       fasesValidas.add(f.id)
    for (const o of p.operaciones) opsValidas.add(o.id)
  }

  const faseAjena = exc.fases.find((f) => !fasesValidas.has(f.fase_id))
  if (faseAjena) throw new ValidationError('Hay una columna que no es de los programas de esta unidad')
  const opAjena = exc.operaciones.find((o) => !opsValidas.has(o.operacion_id))
  if (opAjena) throw new ValidationError('Hay un renglón que no es de los programas de esta unidad')

  await repo.setExcepciones(vehiculoId, {
    fases: exc.fases.filter((f) => f.omitida || f.km != null || f.costo != null),
    operaciones: exc.operaciones.filter((o) => !o.activa || o.limite_meses != null),
  })
  return getEstado(vehiculoId)
}

/**
 * Le pone a la unidad los programas de su modelo, los que el modelo tenga.
 *
 * Se llama al dar de alta la unidad. El de posgarantía se asigna desde ya
 * aunque falten años para usarlo: dejarlo para después obligaría a acordarse de
 * hacerlo el día que la garantía venza, que es justo el día en que nadie se
 * acuerda. Su arranque queda nulo —se deriva cuando toque—, así que asignarlo
 * temprano no adelanta nada.
 *
 * Silencioso a propósito: que el modelo no tenga programas no es un error del
 * alta.
 */
export async function asignarProgramaDelModelo(
  vehiculoId: number, modeloId: number,
): Promise<void> {
  const programas = await programaRepo.findTodosDeModelo(modeloId)
  if (!programas.length) return
  const datos = await repo.findDatosVehiculo(vehiculoId)

  for (const programa of programas) {
    if (!programa.activo) continue
    await repo.setVinculo({
      vehiculo_id:  vehiculoId,
      etapa:        programa.tipo,
      programa_id:  programa.id,
      km_inicio:    programa.tipo === 'fabricante' ? datos?.kilometraje ?? 0 : null,
      fecha_inicio: programa.tipo === 'fabricante' ? aFecha(datos?.fecha_compra) : null,
      forzada:      false,
    })
  }
}

// ─── Cerrar trabajo ─────────────────────────────────────────────────────────

export async function registrarVisita(
  vehiculoId: number,
  data: { fecha: string; km?: number | null; mantenimiento_id?: number | null },
) {
  const estado = await getEstado(vehiculoId)
  if (!estado) throw new NotFoundError('Programa de la unidad')
  if (!estado.proxima) {
    throw new ValidationError('El programa no tiene columnas que hacer')
  }

  // Siempre se cierra la visita que toca. Dejar elegir cuál rompería el
  // recorrido: el índice es lo que dice en qué punto del ciclo va la unidad, y
  // saltarse uno haría que la columna siguiente ya no fuera la correcta.
  const proxima = estado.proxima
  await repo.crearVisita({
    vehiculo_id:      vehiculoId,
    // Se sella la etapa vigente: el índice solo significa algo dentro de ella.
    etapa:            estado.etapa,
    fase_id:          proxima.fase.id,
    indice:           proxima.indice,
    fecha:            data.fecha,
    km:               data.km ?? estado.kilometraje ?? null,
    mantenimiento_id: data.mantenimiento_id ?? null,
    operacion_ids:    proxima.operaciones.map((o) => o.operacion.id),
  })
  return getEstado(vehiculoId)
}

export async function deshacerVisita(visitaId: number) {
  const visita = await repo.findVisita(visitaId)
  if (!visita) throw new NotFoundError('Visita')
  // Solo la última de su etapa: deshacer una de en medio dejaría un hueco en el
  // recorrido y la unidad quedaría con un índice que ya no corresponde a
  // ninguna columna.
  const visitas = (await repo.findVisitas(visita.vehiculo_id))
    .filter((v) => v.etapa === visita.etapa)
  if (visitas[visitas.length - 1]?.id !== visitaId) {
    throw new ValidationError('Solo se puede deshacer la última visita registrada')
  }
  await repo.borrarVisita(visitaId)
  return getEstado(visita.vehiculo_id)
}

// Atender un renglón por su cuenta: su límite de meses venció antes de que
// llegara el kilometraje de su columna. No cuenta como visita.
export async function atenderOperacion(
  vehiculoId: number, operacionId: number,
  data: { fecha: string; km?: number | null },
) {
  const estado = await getEstado(vehiculoId)
  if (!estado) throw new NotFoundError('Programa de la unidad')
  if (!estado.programa.operaciones.some((o) => o.id === operacionId)) {
    throw new ValidationError('Esa operación no es del programa de esta unidad')
  }
  await repo.atenderOperacion(
    vehiculoId, operacionId, data.fecha, data.km ?? estado.kilometraje ?? null
  )
  return getEstado(vehiculoId)
}

// ─── Flota, para el tablero ─────────────────────────────────────────────────

export interface AlertaPrograma {
  vehiculo_id:     number
  vehiculo_nombre: string
  /** 'fase' = toca la visita completa; 'operacion' = un renglón venció por tiempo. */
  tipo:            'fase' | 'operacion'
  nombre:          string
  categoria:       string | null
  /**
   * La unidad sigue en garantía y este servicio ya se pasó. Es lo que separa un
   * atraso de un riesgo de perder la garantía, y por eso además pesa en la
   * urgencia.
   */
  garantia_en_riesgo: boolean
  urgencia:        number
}

// Todo lo que el programa tiene vencido o por vencer en la flota. Las fases
// entran por kilometraje y las operaciones por su límite de meses, que corre
// aparte: una unidad puede tener la visita lejos y aun así deberle el aceite.
export async function clasificarFleet(): Promise<{
  vencidos: AlertaPrograma[]; porVencer: AlertaPrograma[]
}> {
  const vinculos = await repo.findVinculosFleet()
  if (!vinculos.length) return { vencidos: [], porVencer: [] }

  const ids = [...new Set(vinculos.map((v) => v.vehiculo_id))]
  const [visitas, estados, garantias, excepciones] = await Promise.all([
    repo.findVisitasDeVehiculos(ids),
    repo.findEstadosDeVehiculos(ids),
    garantiasRepo.findPrincipalesDeVehiculos(ids),
    repo.findExcepcionesDeVehiculos(ids),
  ])

  // Los programas se leen una vez cada uno: varias unidades comparten modelo.
  const programas = new Map<number, ProgramaCompleto>()
  for (const pid of new Set(vinculos.map((v) => v.programa_id))) {
    const p = await programaRepo.findById(pid)
    if (p) programas.set(pid, p)
  }

  // Las filas llegan sueltas, una por etapa: se agrupan por unidad para poder
  // resolver cuál manda.
  const porVehiculo = new Map<number, typeof vinculos>()
  for (const v of vinculos) {
    const lista = porVehiculo.get(v.vehiculo_id)
    if (lista) lista.push(v)
    else porVehiculo.set(v.vehiculo_id, [v])
  }
  const visitasPorVehiculo = new Map<number, Visita[]>()
  for (const v of visitas) {
    const lista = visitasPorVehiculo.get(v.vehiculo_id)
    if (lista) lista.push(v)
    else visitasPorVehiculo.set(v.vehiculo_id, [v])
  }
  const estadosPorVehiculo = new Map<number, EstadoOperacion[]>()
  for (const e of estados) {
    const lista = estadosPorVehiculo.get(e.vehiculo_id)
    if (lista) lista.push(e)
    else estadosPorVehiculo.set(e.vehiculo_id, [e])
  }

  const hoy = fechaMexico()
  const vencidos: AlertaPrograma[] = []
  const porVencer: AlertaPrograma[] = []

  for (const [vehiculoId, filas] of porVehiculo) {
    const cabeza   = filas[0]
    const garantia = evaluarPrincipal(garantias.get(vehiculoId) ?? null, cabeza.kilometraje, hoy)
    const resuelta = resolverEtapa(filas, garantia)
    const vinculo  = filas.find((v) => v.etapa === resuelta.etapa)
    if (!vinculo) continue

    const base = programas.get(vinculo.programa_id)
    if (!base) continue
    const programa = aplicarExcepciones(
      base, excepciones.get(vehiculoId) ?? { fases: [], operaciones: [] }
    )

    const todasLasVisitas = visitasPorVehiculo.get(vehiculoId) ?? []
    const arranque = resolverArranque(
      resuelta.etapa, vinculo, filas.find((v) => v.etapa !== resuelta.etapa),
      todasLasVisitas, garantia,
    )
    const hechas = todasLasVisitas.filter((v) => v.etapa === resuelta.etapa).length

    // Bajo el programa del fabricante y con la garantía viva, un atraso es un
    // riesgo de perderla: se marca y además sube por encima del resto.
    const enGarantia =
      resuelta.etapa === 'fabricante' && (garantia?.estado.vigente ?? false)
    const alerta = (
      tipo: 'fase' | 'operacion', nombre: string, categoria: string | null,
      urgenciaBase: number, vencida: boolean,
    ): AlertaPrograma => ({
      vehiculo_id:     vehiculoId,
      vehiculo_nombre: cabeza.vehiculo_nombre,
      tipo, nombre, categoria,
      garantia_en_riesgo: enGarantia && vencida,
      urgencia: enGarantia && vencida
        ? urgenciaBase * PESO_GARANTIA_EN_RIESGO
        : urgenciaBase,
    })

    const [proxima] = armarServicios(programa, hechas, arranque.km, cabeza.kilometraje, 1)
    if (proxima && (proxima.vencida || proxima.por_vencer)) {
      const a = alerta(
        'fase',
        `Servicio de ${proxima.fase.km.toLocaleString('es-MX')} km`,
        null,
        proxima.intervalo > 0 && proxima.km_faltantes != null
          ? 1 - proxima.km_faltantes / proxima.intervalo
          : 0,
        proxima.vencida,
      )
      if (proxima.vencida) vencidos.push(a)
      else porVencer.push(a)
    }

    const tiempo = armarOperacionesTiempo(
      programa,
      arranque.fecha ?? aFecha(cabeza.fecha_compra),
      estadosPorVehiculo.get(vehiculoId) ?? [],
      hoy,
    )
    for (const t of tiempo) {
      if (!t.vencida && !t.por_vencer) continue
      const a = alerta(
        'operacion', t.operacion.nombre, t.operacion.categoria,
        t.meses != null && t.operacion.limite_meses
          ? t.meses / t.operacion.limite_meses
          : 0,
        t.vencida,
      )
      if (t.vencida) vencidos.push(a)
      else porVencer.push(a)
    }
  }

  vencidos.sort((a, b) => b.urgencia - a.urgencia)
  porVencer.sort((a, b) => b.urgencia - a.urgencia)
  return { vencidos, porVencer }
}
