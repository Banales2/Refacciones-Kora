import * as repo from '../repositories/recargasRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import * as facturasGasolinaRepo from '../repositories/facturasGasolinaRepo'
import type { RecargaConGasolinera, RecargaConVehiculo } from '../repositories/recargasRepo'
import type { Alcance } from '../shared/alcance'
import type { RecargaCreate, RecargaEmergencia, RecargaUpdate, TicketRecarga } from '../schemas/recargaSchema'
import { AppError, NotFoundError, ValidationError, ConflictError } from '../shared/errors'

// El vale tiene que existir, haber sido emitido para el mismo vehículo que se
// está recargando (si no, la recarga quedaría amarrada al vale de otra unidad)
// y no haberse usado antes: cada vale sirve para una sola recarga.
async function validarVale(
  valeId: number, vehiculoId: number, recargaId?: number
): Promise<void> {
  const vehiculoDelVale = await repo.valeVehiculo(valeId)
  if (vehiculoDelVale === null) throw new NotFoundError('Vale')
  if (vehiculoDelVale !== vehiculoId) {
    throw new ValidationError('El vale corresponde a otro vehículo')
  }
  if (await repo.valeUsado(valeId, recargaId)) {
    throw new ConflictError('Ese vale ya se usó en otra recarga')
  }
  if (await repo.valeArchivado(valeId)) {
    throw new ConflictError(
      'Ese vale se dio por perdido y está archivado. Si apareció, restáuralo en ' +
      'Vales de gasolina y vuelve a intentarlo.'
    )
  }
}

export async function getAll(alcance: Alcance): Promise<RecargaConVehiculo[]> {
  return repo.findAll(alcance)
}

export async function getByVehiculo(vehiculoId: number): Promise<RecargaConGasolinera[]> {
  return repo.findByVehiculo(vehiculoId)
}

// Cargar gasolina es, igual que un mantenimiento, una ocasión en que se lee el
// odómetro: el kilometraje reportado pasa a ser el del vehículo.
// `avanzarKilometraje` solo sube (una recarga capturada tarde, con un km menor
// al ya registrado, no hace retroceder el odómetro) e ignora los tipos que no
// llevan. Al frontend se le avisa antes de guardar: ver ConfirmarAvanceKm.
export async function create(vehiculoId: number, data: RecargaCreate): Promise<RecargaConGasolinera> {
  if (!(await repo.vehiculoExists(vehiculoId))) throw new NotFoundError('Vehículo')
  await validarVale(data.vale_id, vehiculoId)
  const recarga = await repo.create(vehiculoId, data)
  if (data.kilometraje > 0) {
    await vehiculosRepo.avanzarKilometraje(vehiculoId, data.kilometraje)
  }
  return recarga
}

// La recarga de emergencia no lleva vale ni avanza el odómetro: no hay
// kilometraje que tomar.
export async function createEmergencia(
  vehiculoId: number, data: RecargaEmergencia
): Promise<RecargaConGasolinera> {
  if (!(await repo.vehiculoExists(vehiculoId))) throw new NotFoundError('Vehículo')
  return repo.createEmergencia(vehiculoId, data)
}

// `esAdmin`: las de emergencia solo las registra el admin, y corregirlas
// también es suyo; si no, un editor podría inflar después el costo de una
// carga que nadie respalda con vale.
export async function update(
  id: number, data: RecargaUpdate, esAdmin: boolean
): Promise<RecargaConGasolinera> {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Recarga')

  if (actual.emergencia) {
    if (!esAdmin) {
      throw new AppError('Solo un admin puede corregir una recarga de emergencia', 403, 'FORBIDDEN')
    }
    // Ponerle gasolinera o vale la volvería una recarga normal a medias; el
    // CHECK de la tabla lo rechazaría con un error ilegible.
    if (data.gasolinera_id !== undefined || data.vale_id !== undefined || data.kilometraje !== undefined) {
      throw new ValidationError('Una recarga de emergencia no lleva gasolinera, vale ni kilometraje')
    }
  }

  const tickets = resolverTickets(actual, data)
  await protegerCuadre(id, data, tickets)

  if (data.vale_id !== undefined) {
    await validarVale(data.vale_id, actual.vehiculo_id, id)
  }
  const { litros: _l, costo: _c, ...cambios } = data
  const result = await repo.update(id, { ...cambios, tickets })
  if (!result) throw new NotFoundError('Recarga')
  return result
}

// Los tickets que deben quedar, o undefined si la edición no los toca.
//
// `litros`/`costo` sueltos son de la pantalla de emergencia y de la PWA vieja:
// corrigen el único ticket. Con varios no se sabe a cuál se refieren, y adivinar
// descuadraría una factura.
function resolverTickets(
  actual: RecargaConGasolinera, data: RecargaUpdate,
): TicketRecarga[] | undefined {
  if (data.tickets) {
    const propios = new Set(actual.tickets.map((t) => t.id))
    if (data.tickets.some((t) => t.id !== undefined && !propios.has(t.id))) {
      throw new ValidationError('Uno de los tickets no es de esta recarga')
    }
    if (actual.emergencia && data.tickets.length > 1) {
      throw new ValidationError('Una recarga de emergencia lleva un solo ticket')
    }
    return data.tickets
  }
  if (data.litros === undefined && data.costo === undefined) return undefined
  if (actual.tickets.length > 1) {
    throw new ValidationError('Esta recarga tiene varios tickets: corrige cada uno por separado')
  }
  const [unico] = actual.tickets
  return [{
    id:     unico?.id,
    litros: data.litros ?? unico?.litros ?? actual.litros,
    costo:  data.costo  ?? unico?.costo  ?? actual.costo,
  }]
}

/** Las cantidades se comparan en milésimas: es lo que guarda la columna. */
function mismaCantidad(a: number, b: number): boolean {
  return Math.round(a * 1000) === Math.round(b * 1000)
}

// Un ticket que ya entró en una factura conciliada no puede cambiar de litros
// ni desaparecer: el renglón del papel se casó con él porque despacharon esa
// misma cantidad, y el cuadre dejaría de ser cierto sin que nadie se enterara.
// La fecha y la gasolinera tampoco, aunque no lo parezca: deciden si la recarga
// era siquiera candidata de esa factura.
//
// Lo demás —chofer, vale, kilometraje, costo, y tickets nuevos o que nadie ha
// conciliado— no toca el cuadre y se sigue corrigiendo: son datos de la
// operación, no del papel de la gasolinera. Para lo otro hay que reabrir la
// factura, volver a cuadrarla y sellarla.
async function protegerCuadre(
  recargaId: number, data: RecargaUpdate, tickets: TicketRecarga[] | undefined,
): Promise<void> {
  const tocaSitio = data.fecha !== undefined || data.gasolinera_id !== undefined
  if (!tocaSitio && !tickets) return

  const conciliados = await facturasGasolinaRepo.ticketsConciliados(recargaId)
  const roto = conciliados.find((c) => {
    if (tocaSitio) return true
    const nuevo = tickets!.find((t) => t.id === c.ticket_id)
    return !nuevo || !mismaCantidad(nuevo.litros, c.litros)
  })
  if (roto) {
    throw new AppError(
      `Esta recarga ya está conciliada en la factura ${roto.folio}. ` +
      'Reábrela para poder corregir los litros de ese ticket, la fecha o la gasolinera.',
      409, 'RECARGA_CONCILIADA',
    )
  }
}

