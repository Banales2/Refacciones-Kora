import * as repo from '../repositories/facturasGasolinaRepo'
import type { Casado, RecargaCandidata, RenglonFactura } from '../repositories/facturasGasolinaRepo'
import {
  ConciliarGasolina, FacturaGasolinaCreate, SinFacturarQuery,
} from '../schemas/facturaGasolinaSchema'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../shared/errors'
import { aCentavos } from '../shared/totales'

// Conciliar la factura de la gasolinera: casar cada renglón del papel con la
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
  const existente = await repo.findByFolio(data.gasolinera_id, data.folio)
  if (existente) {
    throw new ConflictError(`Esa gasolinera ya tiene una factura con el folio ${data.folio}.`)
  }
  return repo.crear(data, capturadoPor)
}

/**
 * Las recargas que ninguna factura ha reclamado.
 *
 * Es el reverso de "el renglón sin recarga": allá la gasolinera cobra algo que
 * no está capturado; aquí está capturado algo que la gasolinera no ha cobrado.
 */
export async function sinFacturar(p: SinFacturarQuery) {
  const r = await repo.recargasSinFacturar(p)
  return { ...r, page: p.page, pageSize: p.pageSize }
}

/** Las cantidades se comparan en milésimas: es lo que guarda la columna. */
function mismaCantidad(a: number, b: number): boolean {
  return Math.round(a * 1000) === Math.round(b * 1000)
}

export interface RenglonSugerido extends RenglonFactura {
  /** Lo que el sistema propone, si el renglón no está casado ya. */
  sugerida_recarga_id: number | null
}

/**
 * Propone qué recarga corresponde a cada renglón, por CANTIDAD exacta.
 *
 * POR QUÉ NO POR IMPORTE: el importe del renglón suele venir sin IVA y el costo
 * de la recarga es lo que se pagó en la bomba, que sí lo incluye. "El más
 * cercano" casaría cosas equivocadas con toda confianza. Los litros son el mismo
 * número de los dos lados y con tres decimales prácticamente no se repiten.
 *
 * Lo que no case por cantidad se queda sin proponer y lo resuelve una persona:
 * es preferible a inventar un emparejamiento que nadie va a revisar.
 *
 * En empate —dos recargas con los mismos litros— gana la más reciente, que es la
 * que cae dentro del periodo que la factura cobra. Se puede cambiar a mano.
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

  const sugeridos: RenglonSugerido[] = rens.map((r) => ({ ...r, sugerida_recarga_id: null }))

  if (factura.conciliada_en !== null) {
    return { factura, renglones: sugeridos, recargas }
  }

  const tomadas = new Set(
    sugeridos.map((r) => r.recarga_id).filter((id): id is number => id !== null),
  )

  for (const r of sugeridos) {
    if (r.recarga_id !== null) continue
    const match = recargas.find(
      (c) => !tomadas.has(c.id) && mismaCantidad(c.litros, r.cantidad),
    )
    if (match) {
      r.sugerida_recarga_id = match.id
      tomadas.add(match.id)
    }
  }

  return { factura, renglones: sugeridos, recargas }
}

export interface ResultadoConciliacion {
  factura_id: number
  renglones: number
  casados: number
  /** Renglones del papel que no corresponden a ninguna recarga capturada. */
  sin_casar: number
  /** Lo que valen esos renglones: el gasto que no está registrado. */
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
      throw new ValidationError('Dos renglones están apuntando a la misma recarga.')
    }
    vistas.add(c.recarga_id)
  }

  const casados: Casado[] = datos.casados.map((c) => ({
    renglon_id: c.renglon_id,
    recarga_id: c.recarga_id ?? null,
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
    cantidad_sin_casar: Math.round(sinCasar.reduce((s, r) => s + r.cantidad, 0) * 1000) / 1000,
  }

  if (sinCasar.length > 0 && !datos.confirmar_sin_casar) {
    throw new AppError(
      `${sinCasar.length} renglón(es) de la factura no corresponden a ninguna recarga ` +
      `capturada, por ${resultado.importe_sin_casar.toFixed(2)}. Son cargas que la ` +
      'gasolinera cobra y que nadie registró.',
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
