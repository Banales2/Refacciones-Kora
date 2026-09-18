import * as repo from '../repositories/facturasGasolinaRepo'
import type { Casado, RecargaCandidata, RenglonFactura } from '../repositories/facturasGasolinaRepo'
import { ConciliarGasolina, FacturaGasolinaCreate } from '../schemas/facturaGasolinaSchema'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../shared/errors'
import { aCentavos } from '../shared/totales'

// Conciliar la factura de la gasolinera: casar cada ticket del papel con la
// recarga que le corresponde.
//
// Ver `db/migrations/041_facturas_de_gasolina.sql`.

/** Quedaron renglones sin casar y no se confirmó cerrar así. */
export const RENGLONES_SIN_CASAR = 'RENGLONES_SIN_CASAR'
export const FACTURA_CONCILIADA = 'FACTURA_CONCILIADA'

export async function getAll(p: repo.FacturaGasolinaQuery) {
  const { data, total } = await repo.findAll(p)
  return { data, total, page: p.page, pageSize: p.pageSize }
}

export async function crear(
  data: FacturaGasolinaCreate, capturadoPor: string,
): Promise<number> {
  // El subtotal tiene que ser lo que suman los renglones. Si no cuadra, o falta
  // un renglón por capturar o hay un importe mal tecleado — y las dos cosas
  // envenenan el cuadre, porque un renglón que no existe nunca va a aparecer
  // como "falta en el sistema".
  const suma = aCentavos(data.renglones.reduce((s, r) => s + r.importe, 0))
  if (Math.abs(suma - data.subtotal) >= 0.01) {
    throw new ValidationError(
      `Los renglones suman ${suma.toFixed(2)} y el subtotal dice ${data.subtotal.toFixed(2)}. ` +
      'Revisa que estén todos los tickets y sus importes.',
    )
  }

  if (data.uuid) {
    const yaEsta = await repo.findByUuid(data.uuid)
    if (yaEsta) {
      throw new ConflictError(`Esa factura ya está capturada con el folio ${yaEsta.folio}.`)
    }
  }

  const existente = await repo.findByFolio(data.gasolinera_id, data.serie ?? null, data.folio)
  if (existente) {
    throw new ConflictError(`Esa gasolinera ya tiene una factura con el folio ${data.folio}.`)
  }

  return repo.crear({ ...data, renglones: data.renglones }, capturadoPor)
}

/** Los litros se comparan en milésimas: es lo que guarda la columna. */
function mismosLitros(a: number, b: number): boolean {
  return Math.round(a * 1000) === Math.round(b * 1000)
}

function normalizarTicket(t: string | null): string | null {
  if (!t) return null
  // El CFDI trae el ticket dentro de un identificador largo
  // ("PL/6809/EXP/ES/2015-8367437") y la recarga lo captura suelto ("8367437").
  // Se compara por el último tramo y sin ceros a la izquierda, que es lo que
  // varía entre los dos papeles.
  const ultimo = t.trim().split(/[-/\s]/).filter(Boolean).pop() ?? ''
  return ultimo.replace(/^0+/, '').toUpperCase() || null
}

export interface RenglonSugerido extends RenglonFactura {
  /** Lo que el sistema propone, si el renglón no está casado ya. */
  sugerida_recarga_id: number | null
  sugerido_metodo: 'ticket' | 'litros' | null
}

/**
 * Propone qué recarga corresponde a cada renglón.
 *
 * DOS PASADAS, y el orden importa:
 *
 *   1. POR TICKET. Si el renglón trae número de ticket y alguna recarga lo tiene
 *      capturado, eso no es una inferencia: es el mismo papel. Se casa y se saca
 *      del bote.
 *   2. POR LITROS, exactos a la milésima. Es lo que queda cuando el ticket no
 *      está —que hoy es siempre, porque la columna acaba de nacer—. Dos cargas
 *      del mismo día por 219.370 litros clavados prácticamente no existen.
 *
 * NO se propone nada por importe, y es deliberado: el importe del renglón es sin
 * IVA y el costo de la recarga es con IVA, así que "el más cercano" casaría
 * cosas equivocadas con toda confianza. Si los litros no alcanzan, el renglón se
 * queda sin proponer y lo resuelve una persona.
 *
 * Cuando hay empate —dos recargas con los mismos litros— gana la más reciente,
 * que es la que cae dentro del periodo que la factura está cobrando. La persona
 * puede cambiarla.
 */
export async function candidatas(facturaId: number): Promise<{
  factura: repo.FacturaGasolina
  renglones: RenglonSugerido[]
  recargas: RecargaCandidata[]
}> {
  const factura = await repo.findById(facturaId)
  if (!factura) throw new NotFoundError('Factura')

  const rens = await repo.renglones(facturaId)
  const recargas = await repo.candidatas(facturaId)

  const sugeridos: RenglonSugerido[] = rens.map((r) => ({
    ...r, sugerida_recarga_id: null, sugerido_metodo: null,
  }))

  if (factura.conciliada_en !== null) {
    return { factura, renglones: sugeridos, recargas }
  }

  // Las que ya están casadas en este mismo papel no se vuelven a ofrecer.
  const tomadas = new Set(
    sugeridos.map((r) => r.recarga_id).filter((id): id is number => id !== null),
  )
  const libres = () => recargas.filter((c) => !tomadas.has(c.id))

  // Pasada 1: ticket.
  for (const r of sugeridos) {
    if (r.recarga_id !== null) continue
    const t = normalizarTicket(r.ticket)
    if (!t) continue
    const match = libres().find((c) => normalizarTicket(c.ticket) === t)
    if (match) {
      r.sugerida_recarga_id = match.id
      r.sugerido_metodo = 'ticket'
      tomadas.add(match.id)
    }
  }

  // Pasada 2: litros exactos.
  for (const r of sugeridos) {
    if (r.recarga_id !== null || r.sugerida_recarga_id !== null) continue
    const match = libres().find((c) => mismosLitros(c.litros, r.litros))
    if (match) {
      r.sugerida_recarga_id = match.id
      r.sugerido_metodo = 'litros'
      tomadas.add(match.id)
    }
  }

  return { factura, renglones: sugeridos, recargas }
}

export interface ResultadoConciliacion {
  factura_id: number
  renglones: number
  casados: number
  /** Tickets del papel que no corresponden a ninguna recarga capturada. */
  sin_casar: number
  /** Lo que esos tickets valen, sin IVA. Es el gasto que no está registrado. */
  importe_sin_casar: number
  /** Litros de esos tickets. */
  litros_sin_casar: number
}

/**
 * Guarda los casados y sella la factura.
 *
 * LO QUE SALE DE AQUÍ Y VALE LA PENA MIRAR es `sin_casar`: los tickets del papel
 * que no corresponden a ninguna recarga capturada. Eso no es un descuadre de
 * dinero abstracto — es "el ticket 8368392, de 57.91 litros, que la gasolinera
 * está cobrando y que nadie registró". Con eso se puede ir a preguntar.
 *
 * Sellar con renglones sin casar es legítimo —la recarga puede capturarse la
 * semana que viene y entonces se reabre— pero exige confirmarlo, así que no
 * pasa por descuido.
 */
export async function conciliar(
  facturaId: number, datos: ConciliarGasolina, quien: string,
): Promise<ResultadoConciliacion> {
  const factura = await repo.findById(facturaId)
  if (!factura) throw new NotFoundError('Factura')

  if (factura.conciliada_en !== null) {
    throw new AppError(
      'Esta factura ya fue conciliada. Reábrela para volver a cuadrarla.',
      409, FACTURA_CONCILIADA,
    )
  }

  // Dos renglones no pueden llevarse la misma recarga. El índice único lo
  // rechazaría de todos modos, pero con un error de constraint que no dice cuál.
  const vistas = new Set<number>()
  for (const c of datos.casados) {
    if (c.recarga_id === null) continue
    if (vistas.has(c.recarga_id)) {
      throw new ValidationError(
        'Dos renglones de la factura están apuntando a la misma recarga.',
      )
    }
    vistas.add(c.recarga_id)
  }

  const casados: Casado[] = datos.casados.map((c) => ({
    renglon_id: c.renglon_id,
    recarga_id: c.recarga_id ?? null,
    metodo: c.metodo ?? 'manual',
  }))
  await repo.guardarCasados(facturaId, casados)

  const rens = await repo.renglones(facturaId)
  const sinCasar = rens.filter((r) => r.recarga_id === null)
  const resultado: ResultadoConciliacion = {
    factura_id: facturaId,
    renglones: rens.length,
    casados: rens.length - sinCasar.length,
    sin_casar: sinCasar.length,
    importe_sin_casar: aCentavos(sinCasar.reduce((s, r) => s + r.importe, 0)),
    litros_sin_casar: Math.round(sinCasar.reduce((s, r) => s + r.litros, 0) * 1000) / 1000,
  }

  if (sinCasar.length > 0 && !datos.confirmar_sin_casar) {
    throw new AppError(
      `${sinCasar.length} ticket(s) de la factura no corresponden a ninguna recarga capturada, ` +
      `por ${resultado.importe_sin_casar.toFixed(2)} sin IVA. Son cargas que la gasolinera ` +
      'cobra y que nadie registró.',
      409, RENGLONES_SIN_CASAR,
    )
  }

  const sellada = await repo.sellar(facturaId, quien, datos.nota?.trim() || null)
  if (!sellada) {
    throw new AppError('Alguien más acaba de conciliar esta factura', 409, FACTURA_CONCILIADA)
  }

  return resultado
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
