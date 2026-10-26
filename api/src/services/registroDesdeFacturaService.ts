import * as facturasRepo from '../repositories/facturasGasolinaRepo'
import * as valesRepo from '../repositories/valesGasolinaRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import type { AgregarTicketDesdeFactura, RegistrarDesdeFactura } from '../schemas/registroDesdeFacturaSchema'
import { TICKETS_MAX } from '../schemas/recargaSchema'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../shared/errors'
import { productoPara, validarKmPorFecha } from './recargasService'
import { resolverCreador, validarReferencias } from './valesGasolinaService'
import { FACTURA_CONCILIADA } from './facturasGasolinaService'

// La recarga que el chofer no reportó —y el vale que el encargado no registró,
// si tampoco estaba— dadas de alta desde el renglón de la factura que las
// cobra. Ver la migración 069.
//
// Pasa por las mismas reglas que el alta normal de vales y recargas: el vale es
// de la unidad, no se gasta dos veces y no está cancelado; el folio no se
// repite; el producto sale de la unidad. Y por las de la conciliación: la
// recarga tiene que poder ser candidata de esta factura.

/** `2026-10-03` + 3 → `2026-10-06`. En UTC para que el horario de verano no mueva el día. */
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export interface Registrada {
  recarga_id: number
  vale_id:    number
  ticket_id:  number
  vale_nuevo: boolean
}

/**
 * `usuario`: quien registra (la sesión). `sucursalUsuario`: la sucursal a la
 * que está acotado, como en el alta de vales.
 */
export async function registrar(
  facturaId: number, renglonId: number, data: RegistrarDesdeFactura,
  usuario: string, sucursalUsuario: number | null,
): Promise<Registrada> {
  const factura = await facturasRepo.findById(facturaId)
  if (!factura) throw new NotFoundError('Factura')
  if (factura.conciliada_en !== null) {
    throw new AppError(
      'La factura ya está conciliada. Reábrela para registrar la recarga que falta.',
      409, FACTURA_CONCILIADA,
    )
  }

  // Si quedara después del corte, la recarga ni sería candidata de esta factura.
  const corte = sumarDias(factura.fecha.slice(0, 10), facturasRepo.DIAS_DE_GRACIA)
  if (data.fecha > corte) {
    throw new ValidationError(
      `La recarga no puede ser posterior al ${corte}: la fecha de la factura más ` +
      `${facturasRepo.DIAS_DE_GRACIA} días de gracia.`,
    )
  }

  let valeNuevo: facturasRepo.ValeNuevoDesdeFactura | null = null
  if (data.vale_id !== undefined) {
    const vale = await valesRepo.findById(data.vale_id)
    if (!vale) throw new NotFoundError('Vale')
    if (vale.vehiculo_id !== data.vehiculo_id) {
      throw new ValidationError(
        `El vale ${vale.folio} se emitió para otra unidad. Corrígelo en Vales de gasolina si se capturó mal.`,
      )
    }
    if (vale.estado === 'usado') {
      throw new ConflictError(`El vale ${vale.folio} ya se usó en otra recarga.`)
    }
    if (vale.estado === 'archivado') {
      throw new ConflictError(
        `El vale ${vale.folio} está cancelado. Si apareció, quítale la cancelación en ` +
        'Vales de gasolina y vuelve a intentarlo.',
      )
    }
    if (data.fecha < vale.fecha) {
      throw new ValidationError(`La recarga no puede ser anterior al vale (${vale.fecha}).`)
    }
    await validarReferencias(data.conductor_id, data.vehiculo_id)
  } else {
    const v = data.vale_nuevo!
    const sucursalId = sucursalUsuario ?? v.sucursal_id
    if (sucursalId === undefined) throw new ValidationError('Sucursal del vale requerida')
    if (data.fecha < v.fecha) {
      throw new ValidationError('La recarga no puede ser anterior a la fecha del vale.')
    }
    await validarReferencias(data.conductor_id, data.vehiculo_id, sucursalId)
    if (await valesRepo.existsFolio(v.folio)) {
      throw new ConflictError(`Ya existe un vale con el folio ${v.folio}`)
    }
    valeNuevo = {
      folio: v.folio,
      creado_por: await resolverCreador(v.creado_por, usuario, sucursalUsuario),
      capturado_por: usuario,
      sucursal_id: sucursalId,
      fecha: v.fecha,
    }
  }

  const producto = await productoPara(data.vehiculo_id, data.producto)
  const kilometraje = data.kilometraje ?? null
  await validarKmPorFecha(data.vehiculo_id, data.fecha, kilometraje)

  const r = await facturasRepo.registrarDesdeFactura(facturaId, {
    renglonId,
    valeId: data.vale_id ?? null,
    valeNuevo,
    vehiculoId: data.vehiculo_id,
    conductorId: data.conductor_id,
    fecha: data.fecha,
    litros: data.litros,
    costo: data.costo,
    kilometraje,
    producto,
    capturadoPor: usuario,
  })
  switch (r.estado) {
    case 'no_existe':      throw new NotFoundError('Factura')
    case 'ya_conciliada':
      throw new AppError('Alguien acaba de conciliar esta factura. Reábrela para registrar la recarga.',
        409, FACTURA_CONCILIADA)
    case 'renglon_ajeno':  throw new NotFoundError('Renglón')
    case 'renglon_casado':
      throw new ConflictError('Ese renglón ya tiene una recarga. Vuelve a abrir la factura.')
    case 'folio_repetido': throw new ConflictError(`Ya existe un vale con el folio ${valeNuevo!.folio}`)
    case 'vale_usado':     throw new ConflictError('Ese vale ya se usó en otra recarga.')
  }

  // Igual que el alta normal: la lectura solo sube el odómetro, nunca lo baja.
  if (kilometraje != null && kilometraje > 0) {
    await vehiculosRepo.avanzarKilometraje(data.vehiculo_id, kilometraje)
  }
  return {
    recarga_id: r.recarga_id, vale_id: r.vale_id, ticket_id: r.ticket_id,
    vale_nuevo: valeNuevo !== null,
  }
}

/** Las recargas a las que se les puede agregar el ticket de un renglón de esta factura. */
export async function recargasParaTicket(facturaId: number) {
  const factura = await facturasRepo.findById(facturaId)
  if (!factura) throw new NotFoundError('Factura')
  return facturasRepo.recargasParaTicket(facturaId, TICKETS_MAX)
}

/**
 * El tercer caso: la recarga sí se reportó, pero el chofer entregó el ticket de
 * un solo tanque y la gasolinera cobra los dos. El ticket que faltaba se agrega
 * a esa recarga y queda casado con el renglón. Ver la migración 077.
 */
export async function agregarTicket(
  facturaId: number, renglonId: number, data: AgregarTicketDesdeFactura,
): Promise<{ recarga_id: number; ticket_id: number }> {
  const r = await facturasRepo.agregarTicketDesdeFactura(facturaId, {
    renglonId,
    recargaId: data.recarga_id,
    litros: data.litros,
    costo: data.costo,
    ticketsMax: TICKETS_MAX,
  })
  switch (r.estado) {
    case 'no_existe':      throw new NotFoundError('Factura')
    case 'ya_conciliada':
      throw new AppError('La factura ya está conciliada. Reábrela para agregar el ticket que falta.',
        409, FACTURA_CONCILIADA)
    case 'renglon_ajeno':  throw new NotFoundError('Renglón')
    case 'renglon_casado':
      throw new ConflictError('Ese renglón ya tiene una recarga. Vuelve a abrir la factura.')
    case 'recarga_no_existe': throw new NotFoundError('Recarga')
    case 'otra_gasolinera':
      throw new ValidationError('Esa recarga es de otra gasolinera: su ticket no puede cobrarlo esta factura.')
    case 'fuera_de_corte':
      throw new ValidationError(
        `Esa recarga es posterior a la fecha de la factura más ${facturasRepo.DIAS_DE_GRACIA} días de gracia.`,
      )
    case 'tickets_completos':
      throw new ConflictError(`Esa recarga ya tiene ${TICKETS_MAX} tickets, el máximo.`)
  }
  return { recarga_id: data.recarga_id, ticket_id: r.ticket_id }
}

export async function sinReportar(p: { desde?: string; hasta?: string }) {
  return facturasRepo.sinReportar(p)
}
