import * as repo from '../repositories/facturasCasetasRepo'
import type { CruceRow, FacturaCasetas, HistorialTag } from '../repositories/facturasCasetasRepo'
import type { FacturaCasetasImport, TagCreate, TagUpdate } from '../schemas/facturaCasetasSchema'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../shared/errors'
import { aCentavos } from '../shared/totales'

// Las facturas de casetas de PASE: importarlas y decir qué hay que mirar.
//
// AQUÍ NO SE CUADRA CONTRA NADA CAPTURADO. En gasolina la recarga existe antes
// que la factura y se casan; aquí el cruce no existe hasta que PASE lo cobra.
// Lo que se puede revisar sale de dos lados:
//
//   el documento      que los cruces sumen lo impreso, cruces repetidos, ajustes
//                     y cruces de fuera del periodo
//   la historia       la clase que el tag suele pagar en esa caseta, y las
//                     casetas que nunca cruza
//
// Ninguno de los hallazgos es una conclusión: es "esto hay que mirarlo", con el
// dinero que está en juego al lado. Un tráiler que cruza clase 9 donde siempre
// paga 5 puede llevar doble caja ese día; quien lo sabe es quien revisa.
//
// Ver `db/migrations/064_facturas_de_casetas.sql`.

/** Ya se importó una factura con ese UUID. */
export const FACTURA_DUPLICADA = 'FACTURA_DUPLICADA'

/**
 * Dos cruces del mismo tag por la misma caseta con menos de esto entre ellos se
 * señalan como posible doble cobro. Una ida y vuelta por la misma caseta tarda
 * horas; una hora deja fuera eso y atrapa el doble registro del carril.
 */
const DOBLE_COBRO_MINUTOS = 60

/**
 * Para decir cuál es la clase habitual de un tag en una caseta hacen falta al
 * menos estos cruces. Con menos, "habitual" es una coincidencia.
 */
const MIN_CRUCES_CLASE = 3

/**
 * Un tag necesita esta historia en OTRAS facturas antes de que una caseta nueva
 * cuente como inusual. Sin el mínimo, en la primera factura importada todas las
 * casetas serían nuevas.
 */
const MIN_HISTORIA_CASETA = 30

/** La tolerancia al comparar sumas contra lo impreso: un centavo. */
const TOLERANCIA = 0.01

export async function getAll(p: {
  page: number; pageSize: number; search?: string; por_revisar?: boolean
}) {
  const { data, total } = await repo.findAll(p)
  return { data, total, page: p.page, pageSize: p.pageSize }
}

// ── Importar ─────────────────────────────────────────────────────────────────

/**
 * Guarda la factura y sus cruces, después de comprobar que el archivo está
 * entero.
 *
 * La pantalla ya leyó el XML, pero lo que llega aquí se vuelve a comprobar
 * contra los totales que el mismo documento imprime. Si no cuadra, se rechaza
 * ENTERO: el codigo de este repo ya quitó una vez un lector de PDF que "se
 * equivocaba en silencio", y la defensa contra eso es no guardar nada que no
 * sume lo que el papel dice.
 */
export async function importar(data: FacturaCasetasImport, capturadoPor: string): Promise<number> {
  const existente = await repo.findByUuid(data.uuid)
  if (existente) {
    throw new AppError(
      `Esta factura ya está importada (folio ${existente.folio}).`, 409, FACTURA_DUPLICADA,
    )
  }

  const partidas = data.cruces.map((c) => c.renglon).sort((a, b) => a - b)
  const faltantes: number[] = []
  for (let i = 0; i < partidas.length; i++) {
    if (partidas[i] !== i + 1) { faltantes.push(i + 1); break }
  }
  if (faltantes.length > 0 || new Set(partidas).size !== partidas.length) {
    throw new ValidationError(
      `Las partidas no van de 1 a ${partidas.length} sin huecos ni repetidas. ` +
      'El archivo parece incompleto.',
    )
  }

  const descuadrado = data.cruces.find(
    (c) => Math.abs(c.importe + c.iva - c.total) > TOLERANCIA * 2,
  )
  if (descuadrado) {
    throw new ValidationError(
      `En la partida ${descuadrado.renglon} el importe más el IVA no da el total.`,
    )
  }

  const suma = (k: 'importe' | 'iva' | 'total') =>
    aCentavos(data.cruces.reduce((s, c) => s + c[k], 0))
  const comparaciones: [string, number, number][] = [
    ['total', suma('total'), data.total],
    ['subtotal', suma('importe'), data.subtotal],
    ['IVA', suma('iva'), data.iva],
  ]
  for (const [nombre, sumado, impreso] of comparaciones) {
    if (Math.abs(sumado - impreso) > TOLERANCIA) {
      throw new ValidationError(
        `Los cruces suman ${sumado.toFixed(2)} de ${nombre} y la factura dice ` +
        `${impreso.toFixed(2)}. No se importó nada.`,
      )
    }
  }

  return repo.crear(data, capturadoPor)
}

// ── Revisar ──────────────────────────────────────────────────────────────────

export type TipoHallazgo =
  | 'cobrado_antes' | 'doble_cobro' | 'clase_mayor' | 'ajuste' | 'fuera_de_periodo'
  | 'tag_sin_unidad' | 'caseta_inusual'

/**
 * De qué lado está el problema. Son dos preguntas distintas y no se suman:
 * lo que PASE pudo cobrar de más, y cómo se están usando las unidades.
 */
export type GrupoHallazgo = 'cobro' | 'uso'

export interface Hallazgo {
  tipo: TipoHallazgo
  grupo: GrupoHallazgo
  /** Las partidas del documento: es como se le reclama a PASE. */
  renglones: number[]
  tag: string
  vehiculo: string | null
  caseta: string | null
  /**
   * El dinero en juego. En los de cobro, lo que pudo cobrarse de más; en los de
   * uso, lo que suman esos cruces.
   */
  monto: number
  detalle: string
}

export interface ResumenUnidad {
  vehiculo_id: number | null
  vehiculo: string | null
  tipo_vehiculo: string | null
  tags: string[]
  cruces: number
  total: number
  casetas: number
}

export interface DetalleFactura {
  factura: FacturaCasetas
  cruces: CruceRow[]
  hallazgos: Hallazgo[]
  por_unidad: ResumenUnidad[]
}

const GRUPO: Record<TipoHallazgo, GrupoHallazgo> = {
  cobrado_antes: 'cobro',
  doble_cobro: 'cobro',
  clase_mayor: 'cobro',
  ajuste: 'cobro',
  fuera_de_periodo: 'cobro',
  tag_sin_unidad: 'uso',
  caseta_inusual: 'uso',
}

function fechaDe(c: CruceRow): string { return c.fecha_hora.slice(0, 10) }
function minutos(a: CruceRow, b: CruceRow): number {
  return (Date.parse(`${b.fecha_hora}Z`) - Date.parse(`${a.fecha_hora}Z`)) / 60000
}
function esAjuste(c: CruceRow): boolean {
  return c.clase === 0 || /^AJUSTE\b/i.test(c.descripcion)
}

/**
 * La clase que cada tag suele pagar en cada caseta, y lo que cuesta.
 *
 * En empate gana la más alta: entre dos clases igual de frecuentes no se puede
 * decir que la cara sea la rara, y señalarla sería una falsa alarma segura.
 */
function clasesHabituales(historial: HistorialTag[]) {
  const porClave = new Map<string, HistorialTag[]>()
  for (const h of historial) {
    const k = `${h.tag}|${h.caseta}`
    porClave.set(k, [...(porClave.get(k) ?? []), h])
  }
  const habitual = new Map<string, HistorialTag>()
  for (const [k, filas] of porClave) {
    const n = filas.reduce((s, f) => s + f.n, 0)
    if (n < MIN_CRUCES_CLASE) continue
    const moda = [...filas].sort((a, b) => b.n - a.n || b.clase - a.clase)[0]
    if (moda.n < 2) continue
    habitual.set(k, moda)
  }
  return habitual
}

export async function detalle(facturaId: number): Promise<DetalleFactura> {
  const factura = await repo.findById(facturaId)
  if (!factura) throw new NotFoundError('Factura')

  const cruces = await repo.cruces(facturaId)
  const historial = await repo.historialDeTags(facturaId)
  const cobrados = await repo.cobradosAntes(facturaId)

  const hallazgos: Hallazgo[] = []
  const agregar = (h: Omit<Hallazgo, 'grupo'>) =>
    hallazgos.push({ ...h, grupo: GRUPO[h.tipo], monto: aCentavos(h.monto) })
  const porRenglon = new Map(cruces.map((c) => [c.renglon, c]))

  // ── Lo que PASE pudo cobrar de más ──

  for (const o of cobrados) {
    const c = porRenglon.get(o.renglon)
    if (!c) continue
    agregar({
      tipo: 'cobrado_antes', renglones: [c.renglon], tag: c.tag, vehiculo: c.vehiculo,
      caseta: c.descripcion, monto: c.total,
      detalle: `El mismo cruce ya venía en la factura ${o.folio}, partida ${o.renglon_otra}.`,
    })
  }

  const ordenados = [...cruces].sort(
    (a, b) => a.tag.localeCompare(b.tag) || a.fecha_hora.localeCompare(b.fecha_hora),
  )
  for (let i = 1; i < ordenados.length; i++) {
    const a = ordenados[i - 1]
    const b = ordenados[i]
    if (a.tag !== b.tag || a.caseta !== b.caseta) continue
    const m = minutos(a, b)
    if (m >= DOBLE_COBRO_MINUTOS) continue
    agregar({
      tipo: 'doble_cobro', renglones: [a.renglon, b.renglon], tag: b.tag, vehiculo: b.vehiculo,
      caseta: b.descripcion, monto: Math.min(a.total, b.total),
      detalle: `Dos cruces por la misma caseta con ${Math.round(m)} min de diferencia.`,
    })
  }

  const habitual = clasesHabituales(historial)
  for (const c of cruces) {
    if (esAjuste(c)) continue
    const h = habitual.get(`${c.tag}|${c.caseta}`)
    if (!h || c.clase <= h.clase) continue
    // Contra lo más caro que pagó en su clase habitual: hay casetas que cobran
    // igual dos clases, y entonces la clase distinta no costó nada de más.
    const exceso = c.total - h.total_maximo
    if (exceso <= 0) continue
    agregar({
      tipo: 'clase_mayor', renglones: [c.renglon], tag: c.tag, vehiculo: c.vehiculo,
      caseta: c.descripcion, monto: exceso,
      detalle: `Cobró clase ${c.clase}; en esta caseta el tag suele pagar clase ${h.clase} ` +
        `(${h.n} de sus cruces).`,
    })
  }

  for (const c of cruces) {
    if (esAjuste(c)) {
      agregar({
        tipo: 'ajuste', renglones: [c.renglon], tag: c.tag, vehiculo: c.vehiculo,
        caseta: c.descripcion, monto: c.total,
        detalle: `Ajuste de PASE del ${fechaDe(c)}. Pide el detalle de qué corrige.`,
      })
      continue
    }
    const fuera = (factura.periodo_desde && fechaDe(c) < factura.periodo_desde)
      || (factura.periodo_hasta && fechaDe(c) > factura.periodo_hasta)
    if (fuera) {
      agregar({
        tipo: 'fuera_de_periodo', renglones: [c.renglon], tag: c.tag, vehiculo: c.vehiculo,
        caseta: c.descripcion, monto: c.total,
        detalle: `Cruce del ${fechaDe(c)}, fuera del periodo que cobra la factura. ` +
          'Revisa que no venga también en la anterior.',
      })
    }
  }

  // ── Cómo se usan las unidades ──

  const porTag = new Map<string, CruceRow[]>()
  for (const c of cruces) porTag.set(c.tag, [...(porTag.get(c.tag) ?? []), c])

  for (const [tag, cs] of porTag) {
    if (cs.some((c) => c.vehiculo_id !== null)) continue
    agregar({
      tipo: 'tag_sin_unidad', renglones: cs.map((c) => c.renglon), tag, vehiculo: null,
      caseta: null, monto: cs.reduce((s, c) => s + c.total, 0),
      detalle: `${cs.length} cruce(s) de un tag que no está ligado a ninguna unidad.`,
    })
  }

  // La historia de cada tag en las otras facturas: cuántos cruces lleva y por
  // qué casetas.
  const otras = new Map<string, { n: number; casetas: Set<string> }>()
  for (const h of historial) {
    if (h.n_otras === 0) continue
    const o = otras.get(h.tag) ?? { n: 0, casetas: new Set<string>() }
    o.n += h.n_otras
    o.casetas.add(h.caseta)
    otras.set(h.tag, o)
  }
  for (const [tag, cs] of porTag) {
    const o = otras.get(tag)
    if (!o || o.n < MIN_HISTORIA_CASETA) continue
    const nuevas = new Map<string, CruceRow[]>()
    for (const c of cs) {
      if (esAjuste(c) || o.casetas.has(c.caseta)) continue
      nuevas.set(c.caseta, [...(nuevas.get(c.caseta) ?? []), c])
    }
    for (const ns of nuevas.values()) {
      agregar({
        tipo: 'caseta_inusual', renglones: ns.map((c) => c.renglon), tag,
        vehiculo: ns[0].vehiculo, caseta: ns[0].descripcion,
        monto: ns.reduce((s, c) => s + c.total, 0),
        detalle: `Este tag no había cruzado esta caseta en ${o.n} cruces anteriores.`,
      })
    }
  }

  return { factura, cruces, hallazgos, por_unidad: resumenPorUnidad(cruces) }
}

/**
 * Lo que cruzó cada unidad. Los cruces sin unidad se agrupan por tag, para que
 * se vea cuánto suma lo que nadie ha reclamado.
 */
function resumenPorUnidad(cruces: CruceRow[]): ResumenUnidad[] {
  const grupos = new Map<string, CruceRow[]>()
  for (const c of cruces) {
    const k = c.vehiculo_id !== null ? `v${c.vehiculo_id}` : `t${c.tag}`
    grupos.set(k, [...(grupos.get(k) ?? []), c])
  }
  return [...grupos.values()]
    .map((cs) => ({
      vehiculo_id: cs[0].vehiculo_id,
      vehiculo: cs[0].vehiculo,
      tipo_vehiculo: cs[0].tipo_vehiculo,
      tags: [...new Set(cs.map((c) => c.tag))],
      cruces: cs.length,
      total: aCentavos(cs.reduce((s, c) => s + c.total, 0)),
      casetas: new Set(cs.map((c) => c.caseta)).size,
    }))
    .sort((a, b) => b.total - a.total)
}

export async function revisar(id: number, quien: string, nota: string | null): Promise<void> {
  const f = await repo.findById(id)
  if (!f) throw new NotFoundError('Factura')
  if (!(await repo.revisar(id, quien, nota))) {
    throw new ConflictError('Esta factura ya está marcada como revisada.')
  }
}

export async function reabrir(id: number): Promise<void> {
  const f = await repo.findById(id)
  if (!f) throw new NotFoundError('Factura')
  if (!(await repo.reabrir(id))) {
    throw new ConflictError('Esta factura no estaba revisada.')
  }
}

// ── Los tags ─────────────────────────────────────────────────────────────────

export async function tags() {
  return repo.tags()
}

export async function crearTag(data: TagCreate): Promise<number> {
  if (await repo.findTagPorNombre(data.tag)) {
    throw new ConflictError(`El tag ${data.tag} ya está registrado.`)
  }
  if (data.vehiculo_id !== null && !(await repo.existeVehiculo(data.vehiculo_id))) {
    throw new NotFoundError('Vehículo')
  }
  return repo.crearTag(data.tag, data.vehiculo_id, data.nota ?? null)
}

/** Devuelve cuántos cruces sin unidad quedaron ligados a la nueva. */
export async function actualizarTag(id: number, data: TagUpdate): Promise<number> {
  if (!(await repo.findTag(id))) throw new NotFoundError('Tag')
  if (data.vehiculo_id !== null && !(await repo.existeVehiculo(data.vehiculo_id))) {
    throw new NotFoundError('Vehículo')
  }
  return repo.actualizarTag(id, data.vehiculo_id, data.nota ?? null)
}
