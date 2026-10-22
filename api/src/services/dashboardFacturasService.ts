// Lo que el tablero sabe de las facturas: qué falta por cuadrar, cuánto pudo
// cobrar PASE de más y qué encontró la conciliación de gasolina.
//
// Son tres endpoints y no uno porque cada uno vive en otra pestaña y pesa
// distinto: la bandeja son seis conteos, los cobros de casetas recalculan los
// hallazgos de cada factura del periodo. Con `keepMounted={false}` en el
// tablero, cada uno corre solo cuando se abre su pestaña.
import * as repo from '../repositories/dashboardFacturasRepo'
import * as gasolinaRepo from '../repositories/facturasGasolinaRepo'
import * as casetasService from './facturasCasetasService'
import { fechaMexico } from '../shared/fechaMexico'

function addDias(fechaYMD: string, dias: number): string {
  const d = new Date(`${fechaYMD}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return fechaMexico(d)
}

/** Ventana móvil de `dias` que termina hoy, como [start, end): la del análisis de costos. */
export function ventanaDeDias(dias: number): { start: string; end: string } {
  const hoy = fechaMexico()
  return { start: addDias(hoy, -(dias - 1)), end: addDias(hoy, 1) }
}

/**
 * Corre un bloque y, si truena, lo deja vacío y anota el motivo: el mismo trato
 * que las fugas. Un cruce roto no tiene por qué dejar la pestaña en blanco.
 */
async function bloque<T>(
  errores: string[], nombre: string, fn: () => Promise<T>, vacio: T,
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    errores.push(`${nombre}: ${err instanceof Error ? err.message : String(err)}`)
    return vacio
  }
}

// ─── Facturas por cuadrar ────────────────────────────────────────────────────

export function getFacturasPorCuadrar(): Promise<repo.FacturasPorCuadrar> {
  return repo.facturasPorCuadrar()
}

// ─── Lo que PASE pudo cobrar de más ──────────────────────────────────────────

export interface FacturaConCobros extends repo.FacturaCasetasDelPeriodo {
  /** Lo que pudo cobrarse de más: la suma de sus hallazgos de cobro. */
  cobro:     number
  hallazgos: number
}

export interface HallazgoDelPeriodo {
  factura_id: number
  serie:      string | null
  folio:      string
  tipo:       casetasService.TipoHallazgo
  tag:        string
  vehiculo:   string | null
  caseta:     string | null
  renglones:  number[]
  monto:      number
  detalle:    string
}

export interface CobrosCasetas {
  rango:    { start: string; end: string }
  /** El titular: la suma de los hallazgos de cobro de todas las facturas del periodo. */
  total:    number
  por_tipo: { tipo: casetasService.TipoHallazgo; cantidad: number; monto: number }[]
  facturas: FacturaConCobros[]
  /** Los que más pesan, para ir directo a ellos. */
  principales: HallazgoDelPeriodo[]
  errores:  string[]
}

/** Cuántos hallazgos se devuelven sueltos; los totales sí cuentan todos. */
const MAX_PRINCIPALES = 15

/**
 * Los hallazgos de cobro de las facturas de PASE del periodo, sumados.
 *
 * Se recalculan con `facturasCasetasService.detalle`, el mismo que enseña la
 * pantalla de la factura, y se suma igual que ella: todos los de grupo `cobro`.
 * Los de `uso` no son dinero cobrado de más —son cómo se usan las unidades— y
 * no entran. Tampoco se guardan: dependen de la historia de cada tag, que
 * cambia con cada factura nueva.
 *
 * No se suma al "ahorro identificado" del análisis de costos a propósito: aquel
 * es lo que se deja de gastar cambiando de proveedor; esto se le reclama a PASE.
 */
export async function getCobrosCasetas(rango: { start: string; end: string }): Promise<CobrosCasetas> {
  const errores: string[] = []
  const facturas = await repo.facturasCasetasEnRango(rango.start, rango.end)

  const detalles = await Promise.all(facturas.map((f) =>
    bloque(errores, `Factura ${f.folio}`, () => casetasService.detalle(f.id), null)))

  const porTipo = new Map<casetasService.TipoHallazgo, { cantidad: number; monto: number }>()
  const todos: HallazgoDelPeriodo[] = []
  const conCobros: FacturaConCobros[] = facturas.map((f, i) => {
    const cobro = (detalles[i]?.hallazgos ?? []).filter((h) => h.grupo === 'cobro')
    for (const h of cobro) {
      // Los de $0 son el cobro legítimo o lo que ya corrigió un ajuste: se
      // enseñan en la factura para contexto, pero aquí no son nada que reclamar.
      if (h.monto <= 0) continue
      const e = porTipo.get(h.tipo) ?? { cantidad: 0, monto: 0 }
      e.cantidad += 1
      e.monto    += h.monto
      porTipo.set(h.tipo, e)
      todos.push({
        factura_id: f.id, serie: f.serie, folio: f.folio,
        tipo: h.tipo, tag: h.tag, vehiculo: h.vehiculo, caseta: h.caseta,
        renglones: h.renglones, monto: h.monto, detalle: h.detalle,
      })
    }
    return {
      ...f,
      cobro: Math.round(cobro.reduce((s, h) => s + h.monto, 0) * 100) / 100,
      hallazgos: cobro.filter((h) => h.monto > 0).length,
    }
  })

  return {
    rango,
    total: Math.round(conCobros.reduce((s, f) => s + f.cobro, 0) * 100) / 100,
    por_tipo: [...porTipo.entries()]
      .map(([tipo, e]) => ({ tipo, cantidad: e.cantidad, monto: Math.round(e.monto * 100) / 100 }))
      .sort((a, b) => b.monto - a.monto),
    facturas: conCobros,
    principales: todos.sort((a, b) => b.monto - a.monto).slice(0, MAX_PRINCIPALES),
    errores,
  }
}

// ─── Lo que encontró la conciliación de gasolina ─────────────────────────────

/**
 * Las ventanas. Lo cobrado sin capturar no tiene: un renglón sellado como "nadie
 * la capturó" sigue siéndolo hasta que alguien lo arregle, sea de cuando sea.
 */
const DIAS_GASOLINA = {
  /** Una carga sin factura pasado un mes ya no es "viene en camino". Igual que la pantalla. */
  sin_factura:  30,
  /** Las omisiones por persona y las cargas en otra gasolinera: el trimestre. */
  sin_reportar: 90,
  otra_gasolinera: 90,
}

/** La misma tolerancia que la propuesta del cuadre: ver `facturasGasolinaService`. */
const LITROS_TOLERANCIA_POR_IMPORTE = 0.1

export interface OmisionesDeChofer {
  conductor_id: number
  conductor:    string
  recargas:     number
  litros:       number
  monto:        number
}

export interface OmisionesDeEncargado {
  /** El correo a cuyo nombre quedó el vale; null si no se sabe. */
  encargado: string | null
  nombre:    string | null
  vales:     number
}

export interface CargaEnOtraGasolinera {
  factura_id:  number
  folio:       string
  /** La gasolinera de la factura: donde de verdad se cargó. */
  gasolinera:  string
  conciliada:  boolean
  /** Con la que quedó capturada. */
  capturada_como: string
  fecha:       string
  litros:      number
  costo:       number
  vehiculo:    string
  conductor:   string
}

export interface ConciliacionGasolina {
  ventanas: typeof DIAS_GASOLINA
  errores:  string[]
  /** Lo que la gasolinera cobró, quedó sellado y ninguna recarga explica. */
  sin_capturar: {
    facturas:  repo.FacturaConFaltantes[]
    renglones: number
    monto:     number
  }
  /** Lo capturado que ninguna factura ha cobrado en más de `ventanas.sin_factura` días. */
  sin_factura: {
    gasolineras: repo.SinFacturarPorGasolinera[]
    tickets:     number
    costo:       number
  }
  /** Lo que se registró desde una factura porque nadie lo había reportado. */
  sin_reportar: {
    por_chofer:    OmisionesDeChofer[]
    por_encargado: OmisionesDeEncargado[]
    recargas:      number
    monto:         number
  }
  en_otra_gasolinera: CargaEnOtraGasolinera[]
}

export async function getConciliacionGasolina(): Promise<ConciliacionGasolina> {
  const hoy = fechaMexico()
  const errores: string[] = []

  const [faltantes, sinFactura, sinReportar, enOtra] = await Promise.all([
    bloque(errores, 'Cobrado sin capturar', () => repo.facturasGasolinaConFaltantes(), []),
    bloque(errores, 'Sin factura',
      () => repo.sinFacturarViejas(DIAS_GASOLINA.sin_factura), []),
    bloque(errores, 'Sin reportar',
      () => gasolinaRepo.sinReportar({ desde: addDias(hoy, -DIAS_GASOLINA.sin_reportar) }), []),
    bloque(errores, 'En otra gasolinera', () => cargasEnOtraGasolinera(addDias(hoy, -DIAS_GASOLINA.otra_gasolinera)), []),
  ])

  const porChofer = new Map<number, OmisionesDeChofer>()
  const porEncargado = new Map<string, OmisionesDeEncargado>()
  for (const s of sinReportar) {
    const c = porChofer.get(s.conductor_id)
      ?? { conductor_id: s.conductor_id, conductor: s.conductor, recargas: 0, litros: 0, monto: 0 }
    c.recargas += 1
    c.litros   += s.litros
    c.monto    += s.costo
    porChofer.set(s.conductor_id, c)
    // Solo los vales que también faltaban: si el vale ya estaba, el encargado sí cumplió.
    if (s.vale_sin_registrar) {
      const k = s.encargado ?? ''
      const e = porEncargado.get(k) ?? { encargado: s.encargado, nombre: s.encargado_nombre, vales: 0 }
      e.vales += 1
      porEncargado.set(k, e)
    }
  }

  return {
    ventanas: DIAS_GASOLINA,
    errores,
    sin_capturar: {
      facturas:  faltantes,
      renglones: faltantes.reduce((s, f) => s + f.renglones, 0),
      monto:     Math.round(faltantes.reduce((s, f) => s + f.monto, 0) * 100) / 100,
    },
    sin_factura: {
      gasolineras: sinFactura,
      tickets:     sinFactura.reduce((s, g) => s + g.tickets, 0),
      costo:       Math.round(sinFactura.reduce((s, g) => s + g.costo, 0) * 100) / 100,
    },
    sin_reportar: {
      por_chofer: [...porChofer.values()]
        .map((c) => ({ ...c, monto: Math.round(c.monto * 100) / 100 }))
        .sort((a, b) => b.recargas - a.recargas || b.monto - a.monto),
      por_encargado: [...porEncargado.values()].sort((a, b) => b.vales - a.vales),
      recargas: sinReportar.length,
      monto:    Math.round(sinReportar.reduce((s, x) => s + x.costo, 0) * 100) / 100,
    },
    en_otra_gasolinera: enOtra,
  }
}

/**
 * Las cargas que parecen capturadas en la gasolinera equivocada, en las
 * facturas recientes con renglones sin casar. Usa el mismo cruce que la
 * pantalla de la factura (`ticketsEnOtraGasolinera`); si un renglón coincide
 * con varios tickets se cuenta una vez, con el primero.
 */
async function cargasEnOtraGasolinera(desde: string): Promise<CargaEnOtraGasolinera[]> {
  const facturas = await repo.facturasGasolinaConSinCasar(desde)
  const porFactura = await Promise.all(facturas.map(async (f) => {
    const ajenos = await gasolinaRepo.ticketsEnOtraGasolinera(f.id, LITROS_TOLERANCIA_POR_IMPORTE)
    const vistos = new Set<number>()
    return ajenos
      .filter((a) => !vistos.has(a.renglon_id) && vistos.add(a.renglon_id))
      .map((a) => ({
        factura_id: f.id, folio: f.folio, gasolinera: f.gasolinera, conciliada: f.conciliada,
        capturada_como: a.gasolinera, fecha: a.fecha, litros: a.litros, costo: a.costo,
        vehiculo: a.vehiculo, conductor: a.conductor,
      }))
  }))
  return porFactura.flat()
}
