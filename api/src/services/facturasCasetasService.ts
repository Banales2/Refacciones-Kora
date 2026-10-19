import * as repo from '../repositories/facturasCasetasRepo'
import type {
  CandidatoDeAjuste, Categoria, CruceRow, FacturaCasetas, HistorialTag, TarifaTramo,
} from '../repositories/facturasCasetasRepo'
import type { FacturaCasetasImport, TagCreate, TagUpdate } from '../schemas/facturaCasetasSchema'
import { AppError, ConflictError, NotFoundError, ValidationError, esLlaveDuplicada } from '../shared/errors'
import { aCentavos } from '../shared/totales'

// Las facturas de casetas de PASE: importarlas y decir qué hay que mirar.
//
// AQUÍ NO SE CUADRA CONTRA NADA CAPTURADO. En gasolina la recarga existe antes
// que la factura y se casan; aquí el cruce no existe hasta que PASE lo cobra.
// Lo que se puede revisar sale de dos lados:
//
//   el documento      que los cruces sumen lo impreso, cruces repetidos, ajustes
//                     y cruces de fuera del periodo
//   las tarifas       que el importe sea el de algún tramo que esa caseta
//                     cobra, y cuál tramo fue (ver la 071)
//   la historia       la clase que el tag suele pagar en esa caseta, y las
//                     casetas que nunca cruza
//
// Ninguno de los hallazgos es una conclusión: es "esto hay que mirarlo", con el
// dinero que está en juego al lado. Un tráiler que cruza clase 9 donde siempre
// paga 5 puede llevar doble caja ese día; quien lo sabe es quien revisa.
//
// Ver `db/migrations/064_facturas_de_casetas.sql` y `071_tarifas_de_casetas.sql`.

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

/**
 * La clase de PASE y las clasificaciones del operador que puede ser. Sale de la
 * factura de septiembre de 2026 contra las tarifas de IDEAL: la clase es el
 * número de ejes, con 1 para el automóvil. De 2 a 4 no se distingue el autobús
 * del camión, así que vale cualquiera de los dos.
 *
 * Las casetas EASYTRIP cobran clase 1 a los tractocamiones; si se cargan sus
 * tarifas, esta tabla no les sirve.
 */
const CATEGORIAS_DE_CLASE: Record<number, Categoria[]> = {
  1: ['auto'],
  2: ['autobus', 'camion_2_4'], 3: ['autobus', 'camion_2_4'], 4: ['autobus', 'camion_2_4'],
  5: ['camion_5_6'], 6: ['camion_5_6'],
  7: ['camion_7_9'], 8: ['camion_7_9'], 9: ['camion_7_9'],
}

const NOMBRE_CATEGORIA: Record<Categoria, string> = {
  moto: 'motocicleta',
  auto: 'automóvil',
  autobus: 'autobús 2-4 ejes',
  camion_2_4: 'camión 2-4 ejes',
  camion_5_6: 'camión 5-6 ejes',
  camion_7_9: 'camión 7-9 ejes',
  eje_ligero: 'eje excedente ligero',
  eje_pesado: 'eje excedente pesado',
}

/** Las clasificaciones entre las que un ajuste puede corregir, de menor a mayor. */
const ESCALA: Categoria[] = ['auto', 'autobus', 'camion_2_4', 'camion_5_6', 'camion_7_9']

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
  if (existente) throw duplicada(existente.folio)

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

  try {
    return await repo.crear(data, capturadoPor)
  } catch (err) {
    // Dos personas importando el mismo XML a la vez pasan las dos la consulta de
    // arriba; la segunda choca con la UNIQUE del UUID. Es el mismo duplicado y
    // debe decirse igual, no como un error interno.
    if (esLlaveDuplicada(err, 'UQ_facturas_casetas_uuid')) {
      throw duplicada((await repo.findByUuid(data.uuid))?.folio ?? data.folio)
    }
    throw err
  }
}

function duplicada(folio: string): AppError {
  return new AppError(`Esta factura ya está importada (folio ${folio}).`, 409, FACTURA_DUPLICADA)
}

// ── Revisar ──────────────────────────────────────────────────────────────────

export type TipoHallazgo =
  | 'cobrado_antes' | 'fuera_de_tarifa' | 'doble_cobro' | 'clase_mayor' | 'ajuste'
  | 'corregido' | 'fuera_de_periodo' | 'tag_sin_unidad' | 'caseta_inusual'

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
  /**
   * Solo en `cobrado_antes`: el mismo cruce como viene en cada una de las otras
   * facturas, de la más vieja a la más nueva, para ponerlos lado a lado sin ir a
   * buscarlas.
   */
  otras?: CruceEnOtra[]
  /** Solo en `ajuste`: el cruce que corrige, cuando se encontró. */
  corrige?: CorreccionDeClase
  /** Solo en `corregido`: la factura donde vino el ajuste. */
  ajuste_en?: { factura_id: number; serie: string | null; folio: string }
}

/**
 * Un ajuste puesto junto al cruce que corrige. El caso típico: el carril cobró
 * un tráiler como automóvil y días después PASE manda la diferencia con clase 0.
 */
export interface CorreccionDeClase {
  factura_id: number
  serie: string | null
  folio: string
  /** Si el cruce original viene en esta misma factura. */
  misma_factura: boolean
  renglon: number
  fecha_hora: string
  clase: number
  total: number
  /**
   * Con tarifa: el tramo y las clasificaciones de antes y después. Sin tarifa
   * no se sabe a qué clase se corrigió, solo cuánto quedó pagado.
   */
  tramo: string | null
  de: string | null
  a: string | null
  /** Original + ajuste: lo que quedó pagado por ese cruce. */
  suma: number
  /** La clase que el tag suele pagar en esa caseta; null si no hay historia. */
  clase_habitual: number | null
  /**
   * Lo que debió quedar: la tarifa de la clase habitual o, sin tarifa, lo más
   * que el tag ha pagado en esa clase ahí. null si no hay historia.
   */
  esperado: number | null
  /** De dónde sale `esperado`. */
  segun: 'tarifa' | 'historial' | null
}

export interface CruceEnOtra {
  factura_id: number
  serie: string | null
  folio: string
  periodo: string | null
  fecha_emision: string
  /** Si la otra se emitió antes que esta. */
  anterior: boolean
  revisada: boolean
  renglon: number
  fecha_hora: string
  clase: number
  total: number
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

/** El cruce con el tramo que su importe identifica, si la caseta tiene tarifa. */
export type CruceConTramo = CruceRow & { tramo: string | null }

/** Las casetas de la factura sin tarifa cargada: lo que no se pudo revisar. */
export interface CasetaSinTarifa {
  caseta: string
  descripcion: string
  cruces: number
  total: number
}

export interface DetalleFactura {
  factura: FacturaCasetas
  cruces: CruceConTramo[]
  hallazgos: Hallazgo[]
  por_unidad: ResumenUnidad[]
  sin_tarifa: CasetaSinTarifa[]
}

const GRUPO: Record<TipoHallazgo, GrupoHallazgo> = {
  cobrado_antes: 'cobro',
  fuera_de_tarifa: 'cobro',
  doble_cobro: 'cobro',
  clase_mayor: 'cobro',
  ajuste: 'cobro',
  corregido: 'cobro',
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
function pesos(n: number): string { return `$${n.toFixed(2)}` }
function iguales(a: number, b: number): boolean { return Math.abs(a - b) <= TOLERANCIA }

/**
 * Las tarifas vigentes el día del cruce, una por tramo, de los tramos que su
 * caseta puede cobrar. Vacío si la caseta no tiene tarifa cargada.
 */
function vigentes(porCaseta: Map<string, TarifaTramo[]>, c: CruceRow): TarifaTramo[] {
  const fecha = fechaDe(c)
  const porTramo = new Map<number, TarifaTramo>()
  for (const t of porCaseta.get(c.caseta) ?? []) {
    if (t.vigente_desde > fecha) continue
    const actual = porTramo.get(t.tramo_id)
    if (!actual || t.vigente_desde > actual.vigente_desde) porTramo.set(t.tramo_id, t)
  }
  return [...porTramo.values()]
}

/** Los importes válidos para la clase del cruce: un tramo y una clasificación cada uno. */
function validas(ts: TarifaTramo[], clase: number) {
  return ts.flatMap((t) => (CATEGORIAS_DE_CLASE[clase] ?? []).flatMap((cat) =>
    t[cat] === null ? [] : [{ tramo: t.tramo, categoria: cat, total: Number(t[cat]) }]))
}

/**
 * El cruce que un ajuste corrige: el más cercano en el tiempo cuyo importe es
 * la tarifa de una clasificación de algún tramo, y que con el ajuste sube
 * exacto a la tarifa de una clasificación mayor del mismo tramo.
 */
function buscarCorreccion(candidatos: CandidatoDeAjuste[], ts: TarifaTramo[], total: number) {
  for (const o of candidatos) {
    for (const t of ts) {
      for (let i = 0; i < ESCALA.length; i++) {
        const de = t[ESCALA[i]]
        if (de === null || !iguales(Number(de), o.total)) continue
        for (let j = i + 1; j < ESCALA.length; j++) {
          const a = t[ESCALA[j]]
          if (a !== null && iguales(Number(a) - Number(de), total)) {
            return { original: o, tarifa: t, de: ESCALA[i], a: ESCALA[j] }
          }
        }
      }
    }
  }
  return null
}

/**
 * Lo que un ajuste puede ser: la diferencia entre dos clasificaciones de un
 * tramo (el carril leyó menos ejes y lo corrigieron) o el cobro de un eje
 * excedente. Vacío si no cuadra con nada.
 */
function explicarAjuste(ts: TarifaTramo[], total: number): string[] {
  const r: string[] = []
  for (const t of ts) {
    for (let i = 0; i < ESCALA.length; i++) {
      for (let j = i + 1; j < ESCALA.length; j++) {
        const de = t[ESCALA[i]]
        const a = t[ESCALA[j]]
        if (de === null || a === null || !iguales(Number(a) - Number(de), total)) continue
        r.push(`corrección de ${NOMBRE_CATEGORIA[ESCALA[i]]} (${pesos(Number(de))}) a ` +
          `${NOMBRE_CATEGORIA[ESCALA[j]]} (${pesos(Number(a))}) en ${t.tramo}`)
      }
    }
    for (const eje of ['eje_ligero', 'eje_pesado'] as const) {
      const v = t[eje]
      if (v !== null && iguales(Number(v), total)) r.push(`${NOMBRE_CATEGORIA[eje]} en ${t.tramo}`)
    }
  }
  return r
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
  const candidatos = new Map<number, CandidatoDeAjuste[]>()
  for (const o of await repo.candidatosDeAjustes(facturaId)) {
    candidatos.set(o.renglon, [...(candidatos.get(o.renglon) ?? []), o])
  }
  const ajustesDespues = await repo.ajustesDeCruces(facturaId)
  const tarifas = new Map<string, TarifaTramo[]>()
  for (const t of await repo.tarifasDeFactura(facturaId)) {
    tarifas.set(t.caseta, [...(tarifas.get(t.caseta) ?? []), t])
  }

  const hallazgos: Hallazgo[] = []
  const agregar = (h: Omit<Hallazgo, 'grupo'>) =>
    hallazgos.push({ ...h, grupo: GRUPO[h.tipo], monto: aCentavos(h.monto) })
  const porRenglon = new Map(cruces.map((c) => [c.renglon, c]))

  // ── Lo que PASE pudo cobrar de más ──

  // Un hallazgo por cruce, con todas las facturas donde vuelve a venir. La
  // primera vez que se cobró es el cobro legítimo; cada vez que aparece después
  // es un cobro de más. Así, de tres facturas con el mismo cruce, la primera
  // muestra el hallazgo en $0 y las otras dos lo cuentan.
  const otrasPorRenglon = new Map<number, CruceEnOtra[]>()
  for (const o of cobrados) {
    const anterior = o.fecha_emision < factura.fecha_emision
      || (o.fecha_emision === factura.fecha_emision && o.factura_id < factura.id)
    otrasPorRenglon.set(o.renglon, [...(otrasPorRenglon.get(o.renglon) ?? []), {
      factura_id: o.factura_id, serie: o.serie, folio: o.folio, periodo: o.periodo,
      fecha_emision: o.fecha_emision, anterior, revisada: !!o.revisada,
      renglon: o.renglon_otra, fecha_hora: o.fecha_hora_otra,
      clase: o.clase_otra, total: o.total_otra,
    }])
  }
  const folioDe = (o: CruceEnOtra) => `${o.serie ? `${o.serie}-` : ''}${o.folio} (partida ${o.renglon})`
  for (const [renglon, otras] of otrasPorRenglon) {
    const c = porRenglon.get(renglon)
    if (!c) continue
    const primera = otras.find((o) => o.anterior)
    const despues = otras.filter((o) => !o.anterior)
    agregar({
      tipo: 'cobrado_antes', renglones: [c.renglon], tag: c.tag, vehiculo: c.vehiculo,
      caseta: c.descripcion, monto: primera ? c.total : 0,
      detalle: primera
        ? `El mismo cruce ya se había cobrado en la factura ${folioDe(primera)}.`
        : `Aquí se cobró por primera vez; se volvió a cobrar en ${despues.map(folioDe).join(', ')}. ` +
          'Lo cobrado de más está en esa(s).',
      otras,
    })
  }

  // Contra la tarifa: el importe dice por qué tramo se cobró. Si no es el de
  // ningún tramo que la caseta cobra, es un hallazgo; si es más caro que todos,
  // lo de más es contra el más caro, porque cualquiera de los válidos pudo ser.
  const tramoDe = new Map<number, string[]>()
  const sinTarifa = new Map<string, CasetaSinTarifa>()
  for (const c of cruces) {
    if (esAjuste(c)) continue
    const ts = vigentes(tarifas, c)
    if (ts.length === 0) {
      const s = sinTarifa.get(c.caseta)
        ?? { caseta: c.caseta, descripcion: c.descripcion, cruces: 0, total: 0 }
      s.cruces++
      s.total += c.total
      sinTarifa.set(c.caseta, s)
      continue
    }
    const vs = validas(ts, c.clase)
    if (vs.length === 0) continue
    const coinciden = vs.filter((v) => iguales(v.total, c.total))
    if (coinciden.length > 0) {
      tramoDe.set(c.renglon, [...new Set(coinciden.map((v) => v.tramo))])
      continue
    }
    const maximo = Math.max(...vs.map((v) => v.total))
    const minimo = Math.min(...vs.map((v) => v.total))
    const cercana = [...vs].sort((a, b) => Math.abs(a.total - c.total) - Math.abs(b.total - c.total))[0]
    const clases = [...new Set(vs.map((v) => NOMBRE_CATEGORIA[v.categoria]))].join(' o ')
    agregar({
      tipo: 'fuera_de_tarifa', renglones: [c.renglon], tag: c.tag, vehiculo: c.vehiculo,
      caseta: c.descripcion, monto: c.total > maximo ? c.total - maximo : 0,
      detalle: `Clase ${c.clase} (${clases}): ningún tramo que cobra esta caseta cuesta ` +
        `${pesos(c.total)}. Lo más cercano: ${cercana.tramo}, ${pesos(cercana.total)}.` +
        (c.total < minimo ? ' Cobró menos que cualquier tarifa: revisa que la tarifa cargada sea la de esa fecha.' : ''),
    })
  }

  // Por tag y caseta antes que por hora: si el tag pasa por otra caseta en
  // medio, los dos cruces de la primera siguen quedando juntos.
  // Los ajustes no entran: una corrección no es un cobro repetido.
  const ordenados = cruces.filter((c) => !esAjuste(c)).sort(
    (a, b) => a.tag.localeCompare(b.tag) || a.caseta.localeCompare(b.caseta)
      || a.fecha_hora.localeCompare(b.fecha_hora),
  )
  // Una ráfaga es una cadena de cruces con menos de DOBLE_COBRO_MINUTOS entre
  // uno y el siguiente. Sale como UN hallazgo con todos sus cruces, no como un
  // par por cada dos seguidos: tres lecturas del carril son un solo problema.
  // De más es todo menos un cruce, y se descuenta el más caro: ese pudo ser el
  // legítimo, y así no se reclama de más.
  //
  // Con tarifa, dos cruces de tramos distintos tampoco se encadenan: es un
  // recorrido en dos partes (salió en La Peñita y volvió a entrar), no un cobro
  // repetido.
  const dosTramos = (a: CruceRow, b: CruceRow) => {
    const ta = tramoDe.get(a.renglon)
    const tb = tramoDe.get(b.renglon)
    return !!ta && !!tb && !ta.some((t) => tb.includes(t))
  }
  const rafagas: CruceRow[][] = []
  for (let i = 0; i < ordenados.length; i++) {
    const a = ordenados[i - 1]
    const b = ordenados[i]
    const sigue = a && a.tag === b.tag && a.caseta === b.caseta
      && minutos(a, b) < DOBLE_COBRO_MINUTOS && !dosTramos(a, b)
    if (sigue) rafagas[rafagas.length - 1].push(b)
    else rafagas.push([b])
  }
  for (const r of rafagas) {
    if (r.length < 2) continue
    const ultimo = r[r.length - 1]
    const lapso = Math.round(minutos(r[0], ultimo))
    agregar({
      tipo: 'doble_cobro', renglones: r.map((c) => c.renglon), tag: ultimo.tag,
      vehiculo: ultimo.vehiculo, caseta: ultimo.descripcion,
      monto: r.reduce((s, c) => s + c.total, 0) - Math.max(...r.map((c) => c.total)),
      detalle: r.length === 2
        ? `Dos cruces por la misma caseta con ${lapso} min de diferencia.`
        : `${r.length} cruces por la misma caseta en ${lapso} min.`,
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
      const ts = vigentes(tarifas, c)
      const cs = candidatos.get(c.renglon) ?? []
      // PASE fecha el ajuste con la hora del cruce que corrige: si hay uno a la
      // misma hora, es ese, haya tarifa o no. Si no, las tarifas dicen cuál.
      const exacto = cs.find((o) => o.segundos === 0)
      const porTarifa = buscarCorreccion(exacto ? [exacto] : cs, ts, c.total)
      const o = porTarifa?.original ?? exacto
      if (o) {
        // Contra la clase que el tag suele pagar ahí: si el original más el
        // ajuste da esa tarifa, la corrección es correcta y no hay nada que
        // reclamar. Si da más, lo de encima es cobro de más. Sin tarifa, contra
        // lo más que el tag ha pagado en esa clase en esa caseta.
        const suma = aCentavos(o.total + c.total)
        const h = habitual.get(`${c.tag}|${c.caseta}`)
        let esperado: number | null = null
        let segun: CorreccionDeClase['segun'] = null
        if (h && porTarifa) {
          const t = porTarifa.tarifa
          const vs = (CATEGORIAS_DE_CLASE[h.clase] ?? [])
            .flatMap((cat) => (t[cat] === null ? [] : [Number(t[cat])]))
          if (vs.length > 0) { esperado = Math.max(...vs); segun = 'tarifa' }
        }
        if (h && esperado === null) { esperado = Number(h.total_maximo); segun = 'historial' }
        const misma = o.factura_id === factura.id
        const folio = `${o.serie ? `${o.serie}-` : ''}${o.folio}`
        const cobro = porTarifa
          ? `se cobró como ${NOMBRE_CATEGORIA[porTarifa.de]} (${pesos(o.total)}) y con el ajuste queda en ` +
            `${pesos(suma)}, la tarifa de ${NOMBRE_CATEGORIA[porTarifa.a]} en ${porTarifa.tarifa.tramo}.`
          : `se cobró en clase ${o.clase} (${pesos(o.total)}) y con el ajuste queda en ${pesos(suma)}.`
        const cuadra = esperado !== null && (iguales(suma, esperado) || suma < esperado)
        agregar({
          tipo: 'ajuste', renglones: [c.renglon], tag: c.tag, vehiculo: c.vehiculo,
          caseta: c.descripcion,
          monto: esperado === null ? c.total : Math.max(0, suma - esperado),
          detalle: `Corrige la partida ${o.renglon_original} ` +
            `${misma ? 'de esta factura' : `de la factura ${folio}`}, del ${o.fecha_hora.slice(0, 10)}` +
            `${o.segundos === 0 ? ', a la misma hora' : ''}: ${cobro} ` + (
            esperado === null
              ? 'El tag no tiene historia en esta caseta: revisa que la unidad sea de esa clase.'
              : cuadra
                ? `El tag suele pagar clase ${h!.clase} aquí` +
                  `${segun === 'historial' ? ` (hasta ${pesos(esperado)})` : ''}: la corrección es correcta.`
                : `El tag suele pagar clase ${h!.clase} aquí (${pesos(esperado)}): quedó ` +
                  `${pesos(suma - esperado)} arriba.`
          ),
          corrige: {
            factura_id: o.factura_id, serie: o.serie, folio: o.folio, misma_factura: misma,
            renglon: o.renglon_original, fecha_hora: o.fecha_hora, clase: o.clase, total: o.total,
            tramo: porTarifa?.tarifa.tramo ?? null,
            de: porTarifa ? NOMBRE_CATEGORIA[porTarifa.de] : null,
            a: porTarifa ? NOMBRE_CATEGORIA[porTarifa.a] : null,
            suma, clase_habitual: h?.clase ?? null, esperado, segun,
          },
        })
        continue
      }
      const explicaciones = explicarAjuste(ts, c.total)
      agregar({
        tipo: 'ajuste', renglones: [c.renglon], tag: c.tag, vehiculo: c.vehiculo,
        caseta: c.descripcion, monto: c.total,
        detalle: `Ajuste de PASE del ${fechaDe(c)}. ` + (
          explicaciones.length > 0
            ? `Cuadra con ${explicaciones.join(', o con ')}. Revisa que la unidad sea de esa clase.`
            : ts.length > 0
              ? 'No cuadra con ninguna diferencia de tarifas de esta caseta. Pide el detalle de qué corrige.'
              : 'Pide el detalle de qué corrige.'
        ),
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

  // La vuelta del ajuste: el cruce de esta factura que después se corrigió en
  // otra. No es dinero de más aquí; el ajuste se revisa en su factura.
  for (const a of ajustesDespues) {
    const c = porRenglon.get(a.renglon)
    if (!c) continue
    agregar({
      tipo: 'corregido', renglones: [c.renglon], tag: c.tag, vehiculo: c.vehiculo,
      caseta: c.descripcion, monto: 0,
      detalle: `PASE lo corrigió después con un ajuste de ${pesos(a.total_ajuste)} en la factura ` +
        `${a.serie ? `${a.serie}-` : ''}${a.folio}, partida ${a.renglon_ajuste}: quedó en ` +
        `${pesos(aCentavos(c.total + a.total_ajuste))}.`,
      ajuste_en: { factura_id: a.factura_id, serie: a.serie, folio: a.folio },
    })
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

  return {
    factura,
    cruces: cruces.map((c) => ({ ...c, tramo: tramoDe.get(c.renglon)?.join(' / ') ?? null })),
    hallazgos,
    por_unidad: resumenPorUnidad(cruces),
    sin_tarifa: [...sinTarifa.values()]
      .map((s) => ({ ...s, total: aCentavos(s.total) }))
      .sort((a, b) => b.total - a.total),
  }
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

// ── Las tarifas ──────────────────────────────────────────────────────────────

export interface ImporteCobrado {
  clase: number
  total: number
  /** Cuántos cruces se cobraron así, en todas las facturas. */
  cruces: number
  /** Los tramos que cuestan eso para esa clase; vacío = fuera de tarifa. */
  tramos: string[]
}

export interface TarifasDeCaseta {
  caseta: string
  nombre: string | null
  cruces: number
  total: number
  tramos: Omit<TarifaTramo, 'caseta'>[]
  /** Solo si la caseta tiene tarifa: lo cobrado, contra la tarifa de hoy. */
  cobrados: ImporteCobrado[]
}

/**
 * Las casetas con sus tramos y tarifas de hoy, y lo que PASE ha cobrado en cada
 * una contra esas tarifas. Primero las que tienen tarifa; las demás, por lo que
 * han costado: son las que conviene cargar.
 */
export async function tarifasPorCaseta(): Promise<TarifasDeCaseta[]> {
  const [casetas, tarifas, cobrados] = await Promise.all([
    repo.casetas(), repo.tarifasVigentes(), repo.importesCobrados(),
  ])
  return casetas
    .map((k) => {
      const ts = tarifas.filter((t) => t.caseta === k.caseta)
      return {
        caseta: k.caseta,
        nombre: k.nombre,
        cruces: k.cruces,
        total: aCentavos(Number(k.total)),
        tramos: ts.map(({ caseta: _, ...t }) => t),
        cobrados: ts.length === 0 ? [] : cobrados
          .filter((c) => c.caseta === k.caseta)
          .map((c) => ({
            clase: c.clase,
            total: Number(c.total),
            cruces: c.n,
            tramos: [...new Set(validas(ts, c.clase)
              .filter((v) => iguales(v.total, Number(c.total))).map((v) => v.tramo))],
          }))
          .sort((a, b) => a.clase - b.clase || a.total - b.total),
      }
    })
    .sort((a, b) =>
      Number(b.tramos.length > 0) - Number(a.tramos.length > 0) || b.total - a.total)
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
