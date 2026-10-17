import * as repo from '../repositories/facturasGasolinaRepo'
import * as gasolinerasRepo from '../repositories/gasolinerasRepo'
import type { Casado, RenglonFactura, TicketCandidato } from '../repositories/facturasGasolinaRepo'
import {
  ConciliarGasolina, FacturaGasolinaCreate, FacturaGasolinaImport, SinFacturarQuery,
} from '../schemas/facturaGasolinaSchema'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../shared/errors'
import { aCentavos } from '../shared/totales'

// Conciliar la factura de la gasolinera: casar cada renglón del papel con el
// ticket de recarga que le corresponde (un tráiler trae uno por tanque, y cada
// uno se cobra en su propio renglón; ver la migración 059).
//
// Ver `db/migrations/041_facturas_de_gasolina.sql`.

/** Quedaron renglones sin casar y no se confirmó cerrar así. */
export const RENGLONES_SIN_CASAR = 'RENGLONES_SIN_CASAR'
export const FACTURA_CONCILIADA = 'FACTURA_CONCILIADA'

export async function getAll(p: repo.FacturaGasolinaQuery) {
  const { data, total, suma } = await repo.findAll(p)
  return { data, total, suma, page: p.page, pageSize: p.pageSize }
}

export async function crear(
  data: FacturaGasolinaCreate, capturadoPor: string,
): Promise<number> {
  const existente = await repo.findByFolio(data.gasolinera_id, data.folio)
  if (existente) {
    throw new ConflictError(`Esa gasolinera ya tiene una factura con el folio ${data.folio}.`)
  }
  return repo.crear(data, capturadoPor)
}

/**
 * Los tickets que ninguna factura ha reclamado.
 *
 * Es el reverso de "el renglón sin recarga": allá la gasolinera cobra algo que
 * no está capturado; aquí está capturado algo que la gasolinera no ha cobrado.
 */
/** Ya se importó una factura con ese folio fiscal. */
export const FACTURA_DUPLICADA = 'FACTURA_DUPLICADA'
/** El permiso de la estación no es de ninguna gasolinera y no se dijo de cuál. */
export const GASOLINERA_DESCONOCIDA = 'GASOLINERA_DESCONOCIDA'

/** Un centavo: lo que se tolera al comparar sumas contra lo impreso. */
const TOLERANCIA = 0.01

/**
 * Guarda la factura leída de su XML.
 *
 * La pantalla lee el CFDI y manda los conceptos ya separados; aquí se comprueba
 * que sumen lo que el documento imprime antes de guardar nada. Si no cuadra, se
 * rechaza entera: este repo ya quitó una vez un lector que se equivocaba en
 * silencio.
 *
 * LA GASOLINERA SALE DEL PERMISO de la estación (migración 066). Si el permiso
 * todavía no es de nadie, quien importa dice de cuál gasolinera es y se le
 * queda; si ya es de una, manda ese vínculo y no lo que se elija.
 */
export async function importar(
  data: FacturaGasolinaImport, capturadoPor: string,
): Promise<{ id: number; gasolinera: string; ligada: boolean }> {
  const repetida = await repo.findByUuid(data.uuid)
  if (repetida) {
    throw new AppError(
      `Esta factura ya está importada (folio ${repetida.folio}).`, 409, FACTURA_DUPLICADA,
    )
  }

  const duena = await gasolinerasRepo.findByPermiso(data.permiso_cre)
  let gasolinera = duena
  if (duena && data.gasolinera_id && data.gasolinera_id !== duena.id) {
    throw new ConflictError(
      `El permiso ${data.permiso_cre} ya es de la gasolinera ${duena.nombre}. ` +
      'Si se ligó a la equivocada, deslígalo desde Catálogos → Gasolineras.',
    )
  }
  if (!duena) {
    if (!data.gasolinera_id) {
      throw new AppError(
        `Ninguna gasolinera tiene el permiso ${data.permiso_cre}. Elige de cuál es.`,
        409, GASOLINERA_DESCONOCIDA,
      )
    }
    gasolinera = await gasolinerasRepo.findById(data.gasolinera_id)
    if (!gasolinera) throw new NotFoundError('Gasolinera')
    if (gasolinera.permiso_cre) {
      throw new ConflictError(
        `${gasolinera.nombre} ya tiene el permiso ${gasolinera.permiso_cre}, y el de esta ` +
        `factura es ${data.permiso_cre}: es otra estación. Dala de alta aparte.`,
      )
    }
  }
  const g = gasolinera!

  // El folio con su serie, como lo imprime el papel. Una capturada a mano pudo
  // quedar con o sin la serie: se buscan las dos para no meterla dos veces.
  const folio = data.serie ? `${data.serie}-${data.folio}` : data.folio
  if (folio.length > 30) throw new ValidationError(`El folio ${folio} pasa de 30 caracteres.`)
  for (const candidato of new Set([folio, data.folio, `${data.serie ?? ''}${data.folio}`])) {
    if (await repo.findByFolio(g.id, candidato)) {
      throw new ConflictError(
        `${g.nombre} ya tiene una factura con el folio ${candidato}, capturada a mano. ` +
        'No hace falta importarla.',
      )
    }
  }

  const suma = (k: 'importe' | 'iva') => aCentavos(data.renglones.reduce((s, r) => s + r[k], 0))
  const comparaciones: [string, number, number][] = [
    ['subtotal', suma('importe'), data.subtotal],
    ['IVA', suma('iva'), data.iva],
    ['total', aCentavos(data.subtotal + data.iva), data.total],
  ]
  for (const [nombre, sumado, impreso] of comparaciones) {
    if (Math.abs(sumado - impreso) > TOLERANCIA) {
      throw new ValidationError(
        `Los renglones dan ${sumado.toFixed(2)} de ${nombre} y la factura dice ` +
        `${impreso.toFixed(2)}. No se importó nada.`,
      )
    }
  }

  const id = await repo.crearImportada({
    uuid: data.uuid,
    gasolinera_id: g.id,
    folio,
    fecha: data.fecha,
    iva: data.iva,
    renglones: data.renglones.map((r) => ({ ...r, despacho: r.despacho ?? null })),
    ligar: duena ? null : { permiso_cre: data.permiso_cre, rfc: data.emisor_rfc },
  }, capturadoPor)

  return { id, gasolinera: g.nombre, ligada: !duena }
}

/**
 * Corrige con el papel el IVA de una factura capturada con tasa. Lo conciliado
 * no se toca sin reabrir: mismo candado que el resto de la factura.
 */
export async function corregirIva(facturaId: number, iva: number): Promise<void> {
  const f = await repo.findById(facturaId)
  if (!f) throw new NotFoundError('Factura')
  if (f.conciliada_en !== null) {
    throw new AppError(
      'Esta factura ya está conciliada. Reábrela para corregirle el IVA.',
      409, FACTURA_CONCILIADA,
    )
  }
  if (!(await repo.setIva(facturaId, iva))) {
    throw new ConflictError('Alguien acaba de conciliar esta factura.')
  }
}

export async function sinFacturar(p: SinFacturarQuery) {
  const r = await repo.recargasSinFacturar(p)
  return { ...r, page: p.page, pageSize: p.pageSize }
}

/** Las cantidades se comparan en milésimas: es lo que guarda la columna. */
function mismaCantidad(a: number, b: number): boolean {
  return Math.round(a * 1000) === Math.round(b * 1000)
}

/**
 * Cuántos litros pueden diferir el renglón y el ticket cuando el dinero
 * coincide al centavo. Cubre el ticket capturado a dos decimales (71.45 contra
 * 71.454), el redondeo de la gasolinera (370.138 contra 370.137) y un dígito
 * cambiado (62.155 contra 62.185); no da para confundir dos cargas distintas.
 */
const LITROS_TOLERANCIA_POR_IMPORTE = 0.1

/** Mismo dinero, en centavos. */
function mismoImporte(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

export interface RenglonSugerido extends RenglonFactura {
  /** Lo que el sistema propone, si el renglón no está casado ya. */
  sugerido_ticket_id: number | null
  /**
   * Por qué lo propone: litros exactos, o el mismo dinero con IVA y litros
   * casi iguales. El segundo se enseña distinto: los litros no cuadran del
   * todo y alguien tiene que mirarlo.
   */
  sugerido_por: 'cantidad' | 'importe' | null
  /**
   * Tickets idénticos a este renglón pero registrados con otra gasolinera:
   * casi seguro la recarga se capturó en la estación equivocada. Solo en los
   * renglones que no casaron ni tienen propuesta. Ver
   * `repo.ticketsEnOtraGasolinera`.
   */
  en_otra_gasolinera: Omit<repo.TicketEnOtraGasolinera, 'renglon_id'>[]
}

/**
 * Propone qué ticket corresponde a cada renglón: primero por CANTIDAD exacta,
 * luego por IMPORTE CON IVA exacto.
 *
 * Los litros son el mismo número de los dos lados y con tres decimales
 * prácticamente no se repiten, así que van primero. Pero el ticket a veces se
 * captura a dos decimales o con un dígito cambiado, y ese renglón se quedaba
 * sin proponer aunque la carga sí estuviera en el sistema.
 *
 * Para esos, el dinero: el importe del papel viene SIN IVA y el ticket es lo
 * que se pagó en la bomba, CON IVA, así que se compara el renglón con su IVA
 * (`importe_con_iva`), que da el ticket al centavo. Solo con el IVA del propio
 * renglón —el de un XML—: repartido o sacado de la tasa es una estimación y no
 * cuadra al centavo. Y solo al centavo y con los litros casi iguales; "el más
 * cercano" casaría cosas equivocadas con toda confianza.
 *
 * Lo que no case de ninguna de las dos formas se queda sin proponer y lo
 * resuelve una persona: es preferible a inventar un emparejamiento que nadie va
 * a revisar.
 *
 * En empate —dos tickets con los mismos litros— gana el más reciente de los que
 * quedaron registrados hasta la fecha de la factura, que es el que cae en el
 * periodo que cobra. Los de los días de gracia (`DIAS_DE_GRACIA`) solo ganan si
 * no hay otro: son la carga del sábado registrada el lunes, pero también podrían
 * ser una carga de después. Se puede cambiar a mano.
 */
export async function candidatas(facturaId: number): Promise<{
  factura: repo.FacturaGasolina
  renglones: RenglonSugerido[]
  tickets: TicketCandidato[]
}> {
  const factura = await repo.findById(facturaId)
  if (!factura) throw new NotFoundError('Factura')

  const rens = await repo.renglones(facturaId)
  const tickets = await repo.candidatas(facturaId)

  const sugeridos: RenglonSugerido[] = rens.map((r) => ({
    ...r, sugerido_ticket_id: null, sugerido_por: null, en_otra_gasolinera: [],
  }))

  if (factura.conciliada_en === null) proponer(sugeridos, tickets)

  // También en la ya conciliada: sus renglones sin casar son justo los que se
  // sellaron como "nadie la capturó", y puede que sí, en otra gasolinera.
  const pendientes = new Set(
    sugeridos.filter((r) => r.ticket_id === null && r.sugerido_ticket_id === null).map((r) => r.id),
  )
  if (pendientes.size > 0) {
    const ajenos = await repo.ticketsEnOtraGasolinera(facturaId, LITROS_TOLERANCIA_POR_IMPORTE)
    for (const r of sugeridos) {
      if (!pendientes.has(r.id)) continue
      r.en_otra_gasolinera = ajenos
        .filter((a) => a.renglon_id === r.id)
        .map(({ renglon_id: _, ...a }) => a)
    }
  }

  return { factura, renglones: sugeridos, tickets }
}

function proponer(sugeridos: RenglonSugerido[], tickets: TicketCandidato[]): void {
  const tomados = new Set(
    sugeridos.map((r) => r.ticket_id).filter((id): id is number => id !== null),
  )

  // Vienen del más reciente al más viejo; gana el registrado hasta la fecha de
  // la factura sobre el de los días de gracia.
  const elegir = (iguales: TicketCandidato[]) =>
    iguales.find((c) => c.dias_despues === 0) ?? iguales[0]

  // Dos pasadas y no una: un renglón que casa por importe no debe llevarse el
  // ticket que otro renglón tenía por litros exactos.
  for (const r of sugeridos) {
    if (r.ticket_id !== null) continue
    const match = elegir(tickets.filter(
      (c) => !tomados.has(c.id) && mismaCantidad(c.litros, r.cantidad),
    ))
    if (match) {
      r.sugerido_ticket_id = match.id
      r.sugerido_por = 'cantidad'
      tomados.add(match.id)
    }
  }
  for (const r of sugeridos) {
    if (r.ticket_id !== null || r.sugerido_ticket_id !== null || r.iva_estimado) continue
    const match = elegir(tickets.filter(
      (c) => !tomados.has(c.id)
        && mismoImporte(c.costo, r.importe_con_iva)
        && Math.abs(c.litros - r.cantidad) <= LITROS_TOLERANCIA_POR_IMPORTE,
    ))
    if (match) {
      r.sugerido_ticket_id = match.id
      r.sugerido_por = 'importe'
      tomados.add(match.id)
    }
  }
}

export interface ResultadoConciliacion {
  factura_id: number
  renglones: number
  casados: number
  /** Renglones del papel que no corresponden a ninguna recarga capturada. */
  sin_casar: number
  /** Lo que valen esos renglones, con IVA: el gasto que no está registrado. */
  importe_sin_casar: number
  /** Litros de esos renglones. */
  cantidad_sin_casar: number
}

/**
 * Guarda los casados y sella la factura.
 *
 * LO QUE SALE DE AQUÍ Y VALE LA PENA MIRAR es `sin_casar`: los renglones del
 * papel que no corresponden a ninguna recarga capturada. Eso no es un descuadre
 * de dinero abstracto — es una carga concreta, con sus litros y su importe, que
 * la gasolinera está cobrando y que nadie registró.
 *
 * Sellar así es legítimo —la recarga puede capturarse la semana que viene y
 * entonces se reabre— pero exige confirmarlo, así que no pasa por descuido.
 */
export async function conciliar(
  facturaId: number, datos: ConciliarGasolina, quien: string,
): Promise<ResultadoConciliacion> {
  // Dos renglones no pueden llevarse el mismo ticket. El índice único lo
  // rechazaría de todos modos, pero con un error de constraint que no dice cuál.
  const vistos = new Set<number>()
  for (const c of datos.casados) {
    if (c.ticket_id === null) continue
    if (vistos.has(c.ticket_id)) {
      throw new ValidationError('Dos renglones están apuntando al mismo ticket.')
    }
    vistos.add(c.ticket_id)
  }

  const casados: Casado[] = datos.casados.map((c) => ({
    renglon_id: c.renglon_id,
    ticket_id: c.ticket_id ?? null,
  }))
  // Revisar, guardar y sellar van juntos en una transacción: ver `guardarYSellar`.
  const r = await repo.guardarYSellar(facturaId, casados, {
    confirmarSinCasar: datos.confirmar_sin_casar === true,
    quien,
    nota: datos.nota?.trim() || null,
  })
  if (r.estado === 'no_existe') throw new NotFoundError('Factura')
  if (r.estado === 'ya_conciliada') {
    throw new AppError(
      'Esta factura ya fue conciliada. Reábrela para volver a cuadrarla.',
      409, FACTURA_CONCILIADA,
    )
  }
  if (r.estado === 'rechazado') throw new ValidationError(mensajeRechazo(r.rechazo))

  const rens = await repo.renglones(facturaId)
  const sinCasar = rens.filter((x) => x.ticket_id === null)
  const resultado: ResultadoConciliacion = {
    factura_id: facturaId,
    renglones: rens.length,
    casados: rens.length - sinCasar.length,
    sin_casar: sinCasar.length,
    // Con IVA: es lo que se le va a pagar a la gasolinera por esas cargas, y lo
    // que valdrían capturadas como recarga.
    importe_sin_casar: aCentavos(sinCasar.reduce((s, x) => s + x.importe_con_iva, 0)),
    cantidad_sin_casar: Math.round(sinCasar.reduce((s, x) => s + x.cantidad, 0) * 1000) / 1000,
  }

  if (r.estado === 'sin_casar') {
    throw new AppError(
      `${sinCasar.length} renglón(es) de la factura no corresponden a ninguna recarga ` +
      `capturada, por ${resultado.importe_sin_casar.toFixed(2)}. Son cargas que la ` +
      'gasolinera cobra y que nadie registró.',
      409, RENGLONES_SIN_CASAR,
    )
  }

  return resultado
}

/** Qué decirle a quien concilia cuando un ticket no puede ir en ese renglón. */
function mensajeRechazo(r: repo.RechazoCasado): string {
  if (r.motivo === 'renglon_ajeno') return 'Uno de los renglones no es de esta factura.'
  const renglon = `El renglón de ${r.cantidad} L`
  switch (r.motivo) {
    case 'ticket_no_existe':
      return `${renglon} apunta a un ticket que ya no existe. Vuelve a abrir la factura.`
    case 'otra_gasolinera':
      return `${renglon} apunta a una recarga registrada en ${r.gasolinera ?? 'otra gasolinera (o de emergencia)'}. ` +
        'Corrige la gasolinera de la recarga si de verdad es de esta.'
    case 'fuera_del_corte':
      return `${renglon} apunta a una recarga del ${r.fecha}, que queda después de la factura ` +
        `más los ${repo.DIAS_DE_GRACIA} días de gracia.`
    case 'ya_facturado':
      return `${renglon} apunta a un ticket que ya cobra la factura ${r.folio}.`
  }
}

/**
 * Suelta el sello para volver a cuadrar.
 *
 * Los casados NO se deshacen: siguen ahí para que al reabrir solo haya que
 * ajustar lo que faltaba. Es lo que hace falta cuando aparece la recarga que no
 * estaba: se captura, se reabre y ahora sí casa.
 */
export async function reabrir(facturaId: number): Promise<void> {
  const factura = await repo.findById(facturaId)
  if (!factura) throw new NotFoundError('Factura')
  await repo.reabrir(facturaId)
}

/** El vale con su recarga y la factura que la cobra, o las que probablemente. */
export async function buscarPorVale(texto: string) {
  const t = texto.trim()
  if (t.length < 2) return []
  return repo.buscarPorVale(t, LITROS_TOLERANCIA_POR_IMPORTE)
}
