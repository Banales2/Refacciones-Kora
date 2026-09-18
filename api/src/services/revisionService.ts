import * as repo from '../repositories/revisionRepo'
import * as facturasRepo from '../repositories/facturasRepo'
import * as facturasService from '../services/facturasService'
import * as lotesService from '../services/lotesService'
import { CabeceraRevisar, RenglonRevisar } from '../schemas/revisionSchema'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../shared/errors'
import { RENGLON_REVISADO, CABECERA_REVISADA } from '../shared/revision'
import { aCentavos, contribucionRenglon, totalesFactura } from '../shared/totales'

// Revisar una factura contra su papel.
//
// CÓMO SE LE PONE PRECIO A UN ERROR. Es lo único no evidente de este archivo.
// La respuesta ingenua —"puso 1,200 en vez de 1,250, son 50 pesos"— está mal en
// cuanto la factura trae descuento o IVA: esos 50 de lista son 52.20 de los que
// de verdad se pagaron. Así que el importe de una corrección es siempre la
// diferencia en el TOTAL de la factura, pasando por `shared/totales`.
//
// CUANDO CAMBIAN DOS COSAS A LA VEZ —la cantidad Y el costo del mismo renglón—
// repartir el importe entre las dos es arbitrario si se hace mal. Aquí se
// aplican EN CADENA: primero la cantidad sobre el costo viejo, después el costo
// sobre la cantidad ya corregida. Cada corrección se queda con lo que ella sola
// movió, y la suma de las dos da exactamente el cambio total. Sin la cadena, dos
// correcciones medidas por separado se solapan y suman de más.

/** Un decimal de la base puede volver con ruido; se compara en centavos. */
function mismoImporte(a: number, b: number): boolean {
  return aCentavos(a) === aCentavos(b)
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return String(v)
}

export interface ResultadoRevision {
  factura_id: number
  correcciones: number
  /** Lo que la revisión movió del total de la factura, en pesos. */
  delta_total: number
}

/**
 * Verifica un renglón contra el papel y lo sella.
 *
 * El cuerpo trae lo que dice la factura, siempre completo. Lo que no coincida
 * con lo guardado se corrige, se cobra y se registra a nombre de quien lo
 * capturó; lo que coincida no deja rastro, porque no pasó nada.
 */
export async function revisarRenglon(
  loteId: number, datos: RenglonRevisar, quien: string,
): Promise<ResultadoRevision> {
  const r = await repo.leerRenglon(loteId)
  if (!r) throw new NotFoundError('Renglón')

  if (r.revisado_en !== null) {
    throw new AppError('Este renglón ya fue revisado', 409, RENGLON_REVISADO)
  }
  if (r.factura_id === null) {
    // El lote de recuperación (migración 024) no salió de ninguna compra: no
    // hay papel contra el cual cuadrarlo y no es trabajo pendiente de nadie.
    throw new ValidationError('Este lote no pertenece a ninguna factura, así que no hay nada que revisar')
  }

  const { descuento_pct: desc, tasa_iva: iva } = r
  const correcciones: repo.Correccion[] = []

  // Paso 1: la cantidad, sobre el costo todavía sin corregir.
  const contribInicial = contribucionRenglon(r.costo_unitario, r.cantidad_inicial, desc, iva)
  let contribCorriente = contribInicial

  if (datos.cantidad_inicial !== r.cantidad_inicial) {
    const tras = contribucionRenglon(r.costo_unitario, datos.cantidad_inicial, desc, iva)
    correcciones.push({
      lote_id: loteId,
      campo: 'cantidad_inicial',
      valor_antes: texto(r.cantidad_inicial),
      valor_despues: texto(datos.cantidad_inicial),
      capturado_por: r.capturado_por,
      delta_dinero: aCentavos(tras - contribCorriente),
    })
    contribCorriente = tras
  }

  // Paso 2: el costo, ya sobre la cantidad corregida.
  if (!mismoImporte(datos.costo_unitario, r.costo_unitario)) {
    const tras = contribucionRenglon(datos.costo_unitario, datos.cantidad_inicial, desc, iva)
    correcciones.push({
      lote_id: loteId,
      campo: 'costo_unitario',
      valor_antes: texto(aCentavos(r.costo_unitario)),
      valor_despues: texto(aCentavos(datos.costo_unitario)),
      capturado_por: r.capturado_por,
      delta_dinero: aCentavos(tras - contribCorriente),
    })
    contribCorriente = tras
  }

  // Se aplica pasando por el service del lote, que es quien sabe ajustar la
  // existencia cuando cambia la cantidad y quien impide reducirla por debajo de
  // lo que ya se consumió. Ese error sale tal cual: el verificador tiene que
  // saber que el papel dice menos piezas de las que ya se usaron, porque eso ya
  // no es un error de captura sino un descuadre.
  if (correcciones.length > 0) {
    await lotesService.updateLote(loteId, {
      costo_unitario: datos.costo_unitario,
      cantidad_inicial: datos.cantidad_inicial,
    })
  }

  const sellado = await repo.sellarRenglon(loteId, r.factura_id, correcciones, quien)
  if (!sellado) {
    throw new AppError('Alguien más acaba de revisar este renglón', 409, RENGLON_REVISADO)
  }

  return {
    factura_id: r.factura_id,
    correcciones: correcciones.length,
    delta_total: aCentavos(contribCorriente - contribInicial),
  }
}

export interface ResultadoCabecera extends ResultadoRevision {
  /**
   * El folio corregido resultó ser de otra factura del mismo proveedor y las
   * dos se fusionaron. La cabecera NO queda sellada: la factura de origen dejó
   * de existir y lo que hay que revisar ahora es la de destino.
   */
  fusionada: boolean
}

/**
 * Verifica la cabecera —folio, fecha, IVA y descuento— y la sella.
 *
 * El IVA y el descuento son los dos únicos campos de aquí que mueven dinero, y
 * lo mueven sobre la factura entera, no sobre un renglón. Por eso su importe se
 * mide contra el total completo y se le carga a quien registró la compra
 * (`facturas.autorizado_por`), que es lo más cerca que se puede estar de quien
 * tecleó una cabecera que no pertenece a ningún renglón.
 */
export async function revisarCabecera(
  facturaId: number, datos: CabeceraRevisar, quien: string,
): Promise<ResultadoCabecera> {
  const c = await repo.leerCabecera(facturaId)
  if (!c) throw new NotFoundError('Factura')

  if (c.cabecera_revisada_en !== null) {
    throw new AppError('Esta factura ya fue revisada', 409, CABECERA_REVISADA)
  }

  // El folio va primero y aparte, porque puede fusionar la factura con otra y
  // entonces esta deja de existir: no hay dónde sellar ni a qué factura colgarle
  // las correcciones. Se hace antes de tocar nada más para no dejar a medias una
  // cabecera que se va a fusionar de todos modos.
  if (datos.num_factura !== c.folio) {
    const res = await facturasService.setFolio(
      facturaId, c.proveedor_id, datos.num_factura, datos.confirmar_fusion,
    )
    if (res.fusionada) {
      return { factura_id: facturaId, correcciones: 0, delta_total: 0, fusionada: true }
    }
  }

  const correcciones: repo.Correccion[] = []

  if (datos.num_factura !== c.folio) {
    correcciones.push({
      lote_id: null,
      campo: 'folio',
      valor_antes: c.folio,
      valor_despues: datos.num_factura,
      capturado_por: c.autorizado_por,
      delta_dinero: 0,
    })
  }

  if (datos.fecha_compra !== c.fecha_compra) {
    await facturasRepo.setFecha(facturaId, datos.fecha_compra)
    correcciones.push({
      lote_id: null,
      campo: 'fecha_compra',
      valor_antes: c.fecha_compra,
      valor_despues: datos.fecha_compra,
      capturado_por: c.autorizado_por,
      delta_dinero: 0,
    })
  }

  // El descuento y el IVA, en cadena y en ese orden: es el orden en que el
  // proveedor los aplica, así que es el orden en que cada uno mueve el total.
  const totalInicial = totalesFactura(c.subtotal, c.descuento_pct, c.tasa_iva).total
  let totalCorriente = totalInicial

  const descNuevo = datos.descuento_pct ?? null
  const ivaNuevo = datos.tasa_iva ?? null

  if (descNuevo !== (c.descuento_pct ?? null)) {
    const tras = totalesFactura(c.subtotal, descNuevo, c.tasa_iva).total
    correcciones.push({
      lote_id: null,
      campo: 'descuento_pct',
      valor_antes: texto(c.descuento_pct),
      valor_despues: texto(descNuevo),
      capturado_por: c.autorizado_por,
      delta_dinero: aCentavos(tras - totalCorriente),
    })
    totalCorriente = tras
  }

  if (ivaNuevo !== (c.tasa_iva ?? null)) {
    const tras = totalesFactura(c.subtotal, descNuevo, ivaNuevo).total
    correcciones.push({
      lote_id: null,
      campo: 'tasa_iva',
      valor_antes: texto(c.tasa_iva),
      valor_despues: texto(ivaNuevo),
      capturado_por: c.autorizado_por,
      delta_dinero: aCentavos(tras - totalCorriente),
    })
    totalCorriente = tras
  }

  if (descNuevo !== (c.descuento_pct ?? null) || ivaNuevo !== (c.tasa_iva ?? null)) {
    await facturasRepo.setTotales(facturaId, ivaNuevo, descNuevo)
  }

  const sellado = await repo.sellarCabecera(
    facturaId, correcciones, quien, datos.nota?.trim() || null,
  )
  if (!sellado) {
    throw new AppError('Alguien más acaba de revisar esta factura', 409, CABECERA_REVISADA)
  }

  return {
    factura_id: facturaId,
    correcciones: correcciones.length,
    delta_total: aCentavos(totalCorriente - totalInicial),
    fusionada: false,
  }
}

/** Quita los sellos de la factura para poder corregirla. Las correcciones ya registradas se quedan. */
export async function reabrir(facturaId: number): Promise<number> {
  const c = await repo.leerCabecera(facturaId)
  if (!c) throw new NotFoundError('Factura')
  return repo.reabrir(facturaId)
}

/**
 * Quita el renglón que se capturó de más y no está en el papel.
 *
 * Antes comprueba que de verdad nunca existió. El caso que más se parece a este
 * y NO es este: el renglón sí se compró, pero pertenece a otra factura. Eso se
 * mueve, no se borra, y el mensaje lo dice.
 */
export async function quitarRenglon(
  loteId: number,
): Promise<{ factura_id: number | null; factura_borrada: boolean }> {
  const r = await repo.leerRenglon(loteId)
  if (!r) throw new NotFoundError('Renglón')

  if (r.revisado_en !== null) {
    throw new AppError(
      'Este renglón ya fue revisado. Reabre la revisión de la factura para poder quitarlo.',
      409, RENGLON_REVISADO,
    )
  }

  const motivos = await repo.motivosParaNoQuitar(loteId)
  if (motivos.length > 0) {
    throw new ConflictError(
      `No se puede quitar este renglón porque ${motivos.join('; ')}. ` +
      'Si la compra sí existió pero es de otra factura, no lo quites: cámbiale el folio para moverlo.',
    )
  }

  const borrado = await repo.quitarRenglon(loteId)
  if (!borrado) throw new NotFoundError('Renglón')

  const facturaBorrada = r.factura_id !== null
    ? await repo.borrarFacturaSiQuedoVacia(r.factura_id)
    : false

  return { factura_id: r.factura_id, factura_borrada: facturaBorrada }
}

/** Cuánto lleva equivocado cada quien. */
export async function errores(desde?: string, hasta?: string) {
  return repo.erroresPorPersona(desde, hasta)
}

/** Lo que se corrigió en una factura. */
export async function correcciones(facturaId: number) {
  return repo.correccionesDeFactura(facturaId)
}

/** El detalle detrás del acumulado: qué correcciones lo componen. */
export async function detalleCorrecciones(
  desde?: string, hasta?: string, capturadoPor?: string,
) {
  return repo.correccionesEnRango(desde, hasta, capturadoPor)
}
