import * as repo from '../repositories/agendaMantenimientoRepo'
import * as mantenimientoRepo from '../repositories/mantenimientoRepo'
import { NotFoundError, ValidationError } from '../shared/errors'
import type { AgendaMantenimientoCreate, AgendaMantenimientoUpdate } from '../repositories/agendaMantenimientoRepo'
import type { MantenimientoCreate } from '../repositories/mantenimientoRepo'

export async function getByVehiculo(vehiculoId: number) {
  return repo.findByVehiculo(vehiculoId)
}

export async function getAllConVehiculo() {
  return repo.findAllConVehiculo()
}

export async function create(vehiculoId: number, data: Omit<AgendaMantenimientoCreate, 'vehiculo_id'>) {
  if (data.fecha_fin < data.fecha_inicio) {
    throw new ValidationError('La fecha de fin no puede ser anterior a la fecha de inicio')
  }
  return repo.create({ ...data, vehiculo_id: vehiculoId })
}

export async function update(id: number, data: AgendaMantenimientoUpdate) {
  const current = await repo.findById(id)
  if (!current) throw new NotFoundError('Agenda de mantenimiento')
  if (current.status !== 'pendiente') {
    throw new ValidationError('Esta agenda ya fue completada o cancelada y no se puede editar')
  }
  const fechaInicio = data.fecha_inicio ?? current.fecha_inicio
  const fechaFin    = data.fecha_fin    ?? current.fecha_fin
  if (fechaFin < fechaInicio) {
    throw new ValidationError('La fecha de fin no puede ser anterior a la fecha de inicio')
  }
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Agenda de mantenimiento')
  return updated
}

export async function cancelar(id: number) {
  const current = await repo.findById(id)
  if (!current) throw new NotFoundError('Agenda de mantenimiento')
  if (current.status !== 'pendiente') {
    throw new ValidationError('Esta agenda ya fue completada o cancelada')
  }
  const updated = await repo.update(id, { status: 'cancelada' })
  if (!updated) throw new NotFoundError('Agenda de mantenimiento')
  return updated
}

export async function remove(id: number) {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Agenda de mantenimiento')
}

export async function completar(id: number, data: Omit<MantenimientoCreate, 'vehiculo_id'>) {
  const agenda = await repo.findById(id)
  if (!agenda) throw new NotFoundError('Agenda de mantenimiento')
  if (agenda.status !== 'pendiente') {
    throw new ValidationError('Esta agenda ya fue completada o cancelada')
  }
  const mantenimiento = await mantenimientoRepo.create({ ...data, vehiculo_id: agenda.vehiculo_id })
  await repo.marcarCompletada(id, mantenimiento.id)
  return mantenimiento
}
