// El programa de mantenimiento visto desde una unidad: en qué punto del
// recorrido va, qué le toca en la próxima visita, y qué renglones se le
// vencieron por su cuenta.
//
// Aquí es donde se junta lo grupal con lo individual. El kilometraje avanza por
// columnas —toda la columna se hace en la misma visita— y el tiempo corre por
// renglón, cada uno con su "o cada N meses". Un renglón puede vencer por meses
// mucho antes de que llegue el kilometraje de su columna, y entonces se atiende
// solo, sin adelantar el resto.
import * as repo from '../repositories/programaVehiculoRepo'
import * as programaRepo from '../repositories/programaRepo'
import { proximosServicios } from './programaService'
import { NotFoundError, ValidationError } from '../shared/errors'
import { fechaMexico } from '../shared/fechaMexico'
import type { Fase, Operacion, ProgramaCompleto } from '../repositories/programaRepo'
import type { VinculoPrograma, Visita, EstadoOperacion } from '../repositories/programaVehiculoRepo'

// Fracción del intervalo que basta haber recorrido para avisar. Es la misma
// regla que ya usa el tablero para los requerimientos sueltos.
const AVISO_KM = 0.75

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

export interface EstadoPrograma {
  vinculo:            VinculoPrograma
  programa:           ProgramaCompleto
  visitas:            Visita[]
  estados:            EstadoOperacion[]
  servicios_hechos:   number
  kilometraje:        number | null
  /** Kilómetros recorridos bajo el programa: odómetro menos el arranque. */
  km_recorrido:       number | null
  proxima:            ServicioPendiente | null
  /** Las que vienen después, para que el taller pueda planear. */
  siguientes:         ServicioPendiente[]
  operaciones_tiempo: OperacionPorTiempo[]
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
// vez que se atendieron —o contra el arranque del programa, si nunca—.
function armarOperacionesTiempo(
  programa: ProgramaCompleto,
  vinculo:  VinculoPrograma,
  estados:  EstadoOperacion[],
  hoy:      string,
  fechaCompra: string | null,
): OperacionPorTiempo[] {
  const porOperacion = new Map(estados.map((e) => [e.operacion_id, e]))
  const arranque = aFecha(vinculo.fecha_inicio) ?? fechaCompra

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

// ─── Lectura ────────────────────────────────────────────────────────────────

export async function getEstado(vehiculoId: number): Promise<EstadoPrograma | null> {
  const vinculo = await repo.findVinculo(vehiculoId)
  if (!vinculo) return null

  const [programa, visitas, estados, datos] = await Promise.all([
    programaRepo.findById(vinculo.programa_id),
    repo.findVisitas(vehiculoId),
    repo.findEstados(vehiculoId),
    repo.findDatosVehiculo(vehiculoId),
  ])
  if (!programa) return null

  const hoy = fechaMexico()
  const servicios = armarServicios(
    programa, visitas.length, vinculo.km_inicio, datos?.kilometraje ?? null, 4
  )

  return {
    vinculo:          { ...vinculo, fecha_inicio: aFecha(vinculo.fecha_inicio) },
    programa,
    visitas:          visitas.map((v) => ({ ...v, fecha: aFecha(v.fecha)! })),
    estados:          estados.map((e) => ({ ...e, ultima_fecha: aFecha(e.ultima_fecha)! })),
    servicios_hechos: visitas.length,
    kilometraje:      datos?.kilometraje ?? null,
    km_recorrido:     datos?.kilometraje != null ? datos.kilometraje - vinculo.km_inicio : null,
    proxima:          servicios[0] ?? null,
    siguientes:       servicios.slice(1),
    operaciones_tiempo: armarOperacionesTiempo(
      programa, vinculo, estados, hoy, aFecha(datos?.fecha_compra)
    ),
  }
}

// ─── Vínculo ────────────────────────────────────────────────────────────────

export async function asignar(
  vehiculoId: number,
  data: { programa_id?: number | null; km_inicio?: number | null; fecha_inicio?: string | null },
) {
  const datos = await repo.findDatosVehiculo(vehiculoId)
  if (!datos) throw new NotFoundError('Vehículo')

  const actual = await repo.findVinculo(vehiculoId)
  const programaId = data.programa_id ?? actual?.programa_id
  if (programaId == null) throw new ValidationError('Falta el programa de mantenimiento')

  const programa = await programaRepo.findCabecera(programaId)
  if (!programa) throw new NotFoundError('Programa de mantenimiento')
  // El programa es del modelo: aplicárselo a una unidad de otro modelo daría un
  // recorrido que no corresponde a esa máquina.
  if (programa.modelo_id !== datos.modelo_id) {
    throw new ValidationError('Ese programa es de otro modelo')
  }

  return repo.setVinculo({
    vehiculo_id:  vehiculoId,
    programa_id:  programaId,
    // El arranque por omisión es el odómetro de hoy y la fecha de compra: una
    // unidad que se da de alta con 40,000 km no debe nacer con ocho servicios
    // vencidos.
    km_inicio:    data.km_inicio ?? actual?.km_inicio ?? datos.kilometraje ?? 0,
    fecha_inicio: data.fecha_inicio !== undefined
      ? data.fecha_inicio
      : (aFecha(actual?.fecha_inicio) ?? aFecha(datos.fecha_compra)),
  })
}

export async function quitar(vehiculoId: number) {
  if (!await repo.removeVinculo(vehiculoId)) {
    throw new NotFoundError('Programa de la unidad')
  }
}

// Le pone a la unidad el programa de su modelo, si el modelo tiene uno activo.
// Se llama al dar de alta la unidad, igual que ya se le copia la plantilla de
// requerimientos. Silencioso a propósito: que el modelo no tenga programa no es
// un error del alta.
export async function asignarProgramaDelModelo(
  vehiculoId: number, modeloId: number,
): Promise<void> {
  const programa = await programaRepo.findByModelo(modeloId)
  if (!programa || !programa.activo) return
  const datos = await repo.findDatosVehiculo(vehiculoId)
  await repo.setVinculo({
    vehiculo_id:  vehiculoId,
    programa_id:  programa.id,
    km_inicio:    datos?.kilometraje ?? 0,
    fecha_inicio: aFecha(datos?.fecha_compra),
  })
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
  // Solo la última: deshacer una de en medio dejaría un hueco en el recorrido y
  // la unidad quedaría con un índice que ya no corresponde a ninguna columna.
  const visitas = await repo.findVisitas(visita.vehiculo_id)
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

  const ids = vinculos.map((v) => v.vehiculo_id)
  const [visitas, estados] = await Promise.all([
    repo.findVisitasDeVehiculos(ids),
    repo.findEstadosDeVehiculos(ids),
  ])

  // Los programas se leen una vez cada uno: varias unidades comparten modelo.
  const programas = new Map<number, ProgramaCompleto>()
  for (const pid of new Set(vinculos.map((v) => v.programa_id))) {
    const p = await programaRepo.findById(pid)
    if (p) programas.set(pid, p)
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

  for (const v of vinculos) {
    const programa = programas.get(v.programa_id)
    if (!programa) continue
    const hechas = visitasPorVehiculo.get(v.vehiculo_id)?.length ?? 0

    const [proxima] = armarServicios(programa, hechas, v.km_inicio, v.kilometraje, 1)
    if (proxima) {
      const alerta: AlertaPrograma = {
        vehiculo_id:     v.vehiculo_id,
        vehiculo_nombre: v.vehiculo_nombre,
        tipo:            'fase',
        nombre:          `Servicio de ${proxima.fase.km.toLocaleString('es-MX')} km`,
        categoria:       null,
        urgencia:        proxima.intervalo > 0 && proxima.km_faltantes != null
          ? 1 - proxima.km_faltantes / proxima.intervalo
          : 0,
      }
      if (proxima.vencida) vencidos.push(alerta)
      else if (proxima.por_vencer) porVencer.push(alerta)
    }

    const tiempo = armarOperacionesTiempo(
      programa,
      { ...v },
      estadosPorVehiculo.get(v.vehiculo_id) ?? [],
      hoy,
      aFecha(v.fecha_compra),
    )
    for (const t of tiempo) {
      if (!t.vencida && !t.por_vencer) continue
      const alerta: AlertaPrograma = {
        vehiculo_id:     v.vehiculo_id,
        vehiculo_nombre: v.vehiculo_nombre,
        tipo:            'operacion',
        nombre:          t.operacion.nombre,
        categoria:       t.operacion.categoria,
        urgencia:        t.meses != null && t.operacion.limite_meses
          ? t.meses / t.operacion.limite_meses
          : 0,
      }
      if (t.vencida) vencidos.push(alerta)
      else porVencer.push(alerta)
    }
  }

  vencidos.sort((a, b) => b.urgencia - a.urgencia)
  porVencer.sort((a, b) => b.urgencia - a.urgencia)
  return { vencidos, porVencer }
}
