import * as repo from '../repositories/vehiculosRepo'
import * as plantillaRepo from '../repositories/plantillaRepo'
import * as modelosRepo from '../repositories/modelosRepo'
import * as dashboardService from './dashboardService'
import { getPool } from '../shared/db'
import {
  VehiculoQuery, VehiculoCreate, VehiculoUpdate, TipoVehiculo,
  TIPOS_CON_SEGURO, TIPOS_CON_PERMISO,
} from '../schemas/vehiculoSchema'
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
    requireField(data.pies,    'Pies')
    requireField(data.status,  'Status')
    requireField(data.ruta_id, 'Ruta')
  }
  if (t === 'utilitario') {
    requireField(data.combustible, 'Combustible')
    requireField(data.status,      'Status')
    if (data.kilometraje == null) throw new ValidationError('Kilometraje es requerido')
  }
  if (t === 'montacargas') {
    requireField(data.combustible, 'Combustible')
    requireField(data.status,      'Status')
    requireField(data.sucursal_id, 'Sucursal')
  }
}

export async function getAll(params: VehiculoQuery) {
  const offset = (params.page - 1) * params.pageSize

  // Los requerimientos vencidos los clasifica el tablero, no SQL. Si no hay
  // ninguno, la consulta sobra: se responde la página vacía.
  let idsAlerta: number[] | undefined
  if (params.alerta === 'requerimientos_vencidos') {
    idsAlerta = await dashboardService.getVehiculosConRequerimientosVencidos()
    if (idsAlerta.length === 0) {
      return { data: [], total: 0, page: params.page, pageSize: params.pageSize }
    }
  }

  const result = await repo.findAll({
    offset, pageSize: params.pageSize,
    search: params.search, tipo: params.tipo, modelo_id: params.modelo_id,
    alerta: params.alerta,
    limite: params.alerta === 'permiso_por_vencer' ? dashboardService.limiteAlertaDocumentos() : undefined,
    idsAlerta,
  })
  return { ...result, page: params.page, pageSize: params.pageSize }
}

export async function getById(id: number) {
  const vehiculo = await repo.findById(id)
  if (!vehiculo) throw new NotFoundError('Vehículo')
  return vehiculo
}

export async function create(data: VehiculoCreate) {
  validateCreate(data)
  await validateTipoPermitido(data.modelo_id, data.tipo)
  await validateSerieYPlacas(data.serie, data.placas)
  const vehicle = await repo.create(data)
  await plantillaRepo.copyModelToVehicle(vehicle.id, data.modelo_id)
  return vehicle
}

// El número de serie es único; las placas son únicas solo cuando existen (un
// vehículo puede no tener placas). exceptId excluye el propio registro al editar.
async function validateSerieYPlacas(
  serie: string | undefined, placas: string | null | undefined, exceptId?: number
) {
  if (serie !== undefined && await repo.existsSerie(serie, exceptId)) {
    throw new ConflictError(`Ya existe un vehículo con el número de serie ${serie}`)
  }
  const p = placas?.trim()
  if (p && await repo.existsPlacas(p, exceptId)) {
    throw new ConflictError(`Ya existe un vehículo con las placas ${p}`)
  }
}

// El modelo puede restringir qué tipos de vehículo genera (vacío = sin
// restricción). Así se evita, p. ej., crear un montacargas desde un modelo
// cuya plantilla asume kilometraje.
async function validateTipoPermitido(modeloId: number, tipo: TipoVehiculo) {
  const permitidos = await modelosRepo.findTiposPermitidos(modeloId)
  if (permitidos.length > 0 && !permitidos.includes(tipo)) {
    throw new ValidationError('El tipo de vehículo seleccionado no está permitido para este modelo')
  }
}

// Al editar, el tipo no viaja en el payload (no se puede cambiar): sale del
// registro actual, así que la regla de qué documentos admite se revisa aquí y
// no en el esquema.
function validateDocumentos(tipo: TipoVehiculo, data: VehiculoUpdate) {
  if (data.seguro_id != null && !TIPOS_CON_SEGURO.includes(tipo)) {
    throw new ValidationError('Este tipo de unidad no se asegura')
  }
  if (data.permiso_id != null && !TIPOS_CON_PERMISO.includes(tipo)) {
    throw new ValidationError('Este tipo de unidad no lleva permiso de circulación')
  }
}

export async function update(id: number, data: VehiculoUpdate) {
  const current = await repo.findById(id)
  if (!current) throw new NotFoundError('Vehículo')
  validateDocumentos(current.tipo as TipoVehiculo, data)
  await validateSerieYPlacas(data.serie, data.placas, id)
  const updated = await repo.update(id, current.tipo as TipoVehiculo, data)
  if (!updated) throw new NotFoundError('Vehículo')
  return updated
}

export async function remove(id: number) {
  const deps = await repo.countDependencies(id)
  const bloqueos: string[] = []
  if (deps.mantenimientos > 0) bloqueos.push(`${deps.mantenimientos} mantenimiento(s)`)
  if (deps.recargas       > 0) bloqueos.push(`${deps.recargas} recarga(s) de combustible`)
  if (deps.vales          > 0) bloqueos.push(`${deps.vales} vale(s) de gasolina`)
  if (bloqueos.length) {
    throw new ConflictError(
      `Este vehículo tiene ${bloqueos.join(', ')} y no puede eliminarse. ` +
      'Elimina primero esos registros.'
    )
  }
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
