import * as repo from '../repositories/vehiculosRepo'
import * as plantillaRepo from '../repositories/plantillaRepo'
import { getPool } from '../shared/db'
import { VehiculoQuery, VehiculoCreate, VehiculoUpdate, TipoVehiculo } from '../schemas/vehiculoSchema'
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors'

function requireField(value: unknown, label: string) {
  if (value == null || value === '') throw new ValidationError(`${label} es requerido`)
}

function validateCreate(data: VehiculoCreate) {
  const t = data.tipo
  if (t === 'camion') {
    requireField(data.combustible,  'Combustible')
    requireField(data.status,       'Status')
    requireField(data.sucursal_id,  'Sucursal')
    if (data.kilometraje == null)   throw new ValidationError('Kilometraje es requerido')
  }
  if (t === 'tractocamion') {
    requireField(data.combustible, 'Combustible')
    requireField(data.status,      'Status')
    requireField(data.ruta_id,     'Ruta')
    requireField(data.tonelaje,    'Tonelaje')
    if (data.kilometraje == null)  throw new ValidationError('Kilometraje es requerido')
  }
  if (t === 'caja_trailer') {
    requireField(data.pies,   'Pies')
    requireField(data.status, 'Status')
  }
  if (t === 'utilitario') {
    requireField(data.combustible, 'Combustible')
    requireField(data.status,      'Status')
    if (data.kilometraje == null) throw new ValidationError('Kilometraje es requerido')
  }
}

export async function getAll(params: VehiculoQuery) {
  const offset = (params.page - 1) * params.pageSize
  const result = await repo.findAll({ offset, pageSize: params.pageSize, search: params.search, tipo: params.tipo, modelo_id: params.modelo_id })
  return { ...result, page: params.page, pageSize: params.pageSize }
}

export async function getById(id: number) {
  const vehiculo = await repo.findById(id)
  if (!vehiculo) throw new NotFoundError('Vehículo')
  return vehiculo
}

export async function create(data: VehiculoCreate) {
  validateCreate(data)
  const vehicle = await repo.create(data)
  await plantillaRepo.copyModelToVehicle(vehicle.id, data.modelo_id)
  return vehicle
}

export async function update(id: number, data: VehiculoUpdate) {
  const current = await repo.findById(id)
  if (!current) throw new NotFoundError('Vehículo')
  const updated = await repo.update(id, current.tipo as TipoVehiculo, data)
  if (!updated) throw new NotFoundError('Vehículo')
  return updated
}

export async function remove(id: number) {
  const deps = await repo.countDependencies(id)
  if (deps > 0)
    throw new ConflictError(`Este vehículo tiene ${deps} registro(s) vinculado(s) y no puede eliminarse`)
  const current = await repo.findById(id)
  if (!current) throw new NotFoundError('Vehículo')
  await repo.remove(id)
}

export async function getModelos() {
  const pool = await getPool()
  const r = await pool.request().query('SELECT id, marca, nombre FROM modelos ORDER BY marca, nombre')
  return r.recordset as { id: number; marca: string; nombre: string }[]
}

export async function getSucursales() {
  const pool = await getPool()
  const r = await pool.request().query('SELECT id, nombre FROM sucursales ORDER BY nombre')
  return r.recordset as { id: number; nombre: string }[]
}

export async function getRutas() {
  const pool = await getPool()
  const r = await pool.request().query('SELECT id, nombre FROM rutas ORDER BY nombre')
  return r.recordset as { id: number; nombre: string }[]
}
