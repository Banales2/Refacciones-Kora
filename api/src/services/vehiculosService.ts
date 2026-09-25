import * as repo from '../repositories/vehiculosRepo'
import * as programaVehiculoService from './programaVehiculoService'
import * as garantiasRepo from '../repositories/garantiasRepo'
import * as modelosRepo from '../repositories/modelosRepo'
import * as dashboardService from './dashboardService'
import { getPool } from '../shared/db'
import {
  VehiculoQuery, VehiculoCreate, VehiculoUpdate, TipoVehiculo,
  TIPOS_CON_SEGURO, TIPOS_CON_PERMISO,
} from '../schemas/vehiculoSchema'
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors'
import { Alcance, SIN_ACOTAR, exigirVehiculo } from '../shared/alcance'
import { fechaMexico } from '../shared/fechaMexico'

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

export async function getAll(params: VehiculoQuery, alcance: Alcance = SIN_ACOTAR) {
  const offset = (params.page - 1) * params.pageSize

  // El atraso del programa lo clasifica el tablero, no SQL. Si no hay ninguna
  // unidad atrasada, la consulta sobra: se responde la página vacía.
  let idsAlerta: number[] | undefined
  if (params.alerta === 'programa_atrasado') {
    idsAlerta = await dashboardService.getVehiculosConProgramaAtrasado()
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
  }, alcance)
  return { ...result, page: params.page, pageSize: params.pageSize }
}

export async function getById(id: number, alcance: Alcance = SIN_ACOTAR) {
  await exigirVehiculo(id, alcance)
  const vehiculo = await repo.findById(id)
  if (!vehiculo) throw new NotFoundError('Vehículo')
  return vehiculo
}

export async function create(data: VehiculoCreate) {
  validateCreate(data)
  await validateTipoPermitido(data.modelo_id, data.tipo)
  await validateSerieYPlacas(data.serie, data.placas)
  const vehicle = await repo.create(data)
  // La unidad nace con lo que su modelo dice que trae: las garantías primero,
  // porque de la que esté marcada como principal depende qué programa se le
  // asigna en seguida.
  await garantiasRepo.copyModelToVehicle(vehicle.id, data.modelo_id)
  // Y el programa del fabricante, si el modelo lo tiene capturado. Arranca en
  // el odómetro de alta: una unidad que entra con 40,000 km no debe nacer con
  // ocho servicios vencidos.
  await programaVehiculoService.asignarProgramaDelModelo(vehicle.id, data.modelo_id)
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
// cuyo programa de mantenimiento asume kilometraje.
async function validateTipoPermitido(modeloId: number, tipo: TipoVehiculo) {
  // Un modelo descontinuado ya no genera unidades nuevas. El selector tampoco lo
  // ofrece, pero el id puede llegar de una pestaña vieja o de la API directa.
  const modelo = await modelosRepo.findById(modeloId)
  if (modelo?.descontinuado_en) {
    throw new ValidationError(
      'Este modelo está descontinuado y no admite unidades nuevas. Quítale lo descontinuado primero.'
    )
  }
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

// ---------------------------------------------------------------------------
// Reinicio de odómetro
// ---------------------------------------------------------------------------

export async function getReinicios(id: number, alcance: Alcance = SIN_ACOTAR) {
  await exigirVehiculo(id, alcance)
  return repo.findReinicios(id)
}

/**
 * El tablero se puso en cero: se guarda el tramo que deja de contar y la
 * lectura nueva.
 *
 * Lo que se captura es cuánto marcaba ANTES de reiniciarse, y por omisión es
 * lo que el sistema ya tenía. Casi siempre son el mismo número; cuando no
 * —porque la unidad rodó unos días sin que nadie capturara— manda lo que diga
 * quien vio el tablero, igual que en el chequeo.
 */
export async function registrarReinicio(
  id: number,
  data: { fecha?: string; km_al_reiniciar?: number; km_nuevo?: number; motivo?: string | null },
  registradoPor: string,
  alcance: Alcance = SIN_ACOTAR,
) {
  await exigirVehiculo(id, alcance)
  const vehiculo = await repo.findById(id)
  if (!vehiculo) throw new NotFoundError('Vehículo')

  // Una caja de tráiler no tiene odómetro que reiniciar. Aceptarlo guardaría
  // un acumulado que ninguna lectura va a usar nunca.
  const tabla = await repo.tablaKmDeVehiculo(id)
  if (!tabla) {
    throw new ValidationError('Este tipo de unidad no lleva odómetro')
  }

  const kmAlReiniciar = data.km_al_reiniciar ?? vehiculo.kilometraje ?? 0
  if (kmAlReiniciar <= 0) {
    throw new ValidationError(
      'Un odómetro que marcaba cero no se reinicia: no hay kilómetros que acumular.'
    )
  }
  // Bajar el número por debajo de lo registrado no es un reinicio, es una
  // corrección —y esa se hace con el chequeo, que sí deja fijar la lectura—.
  // Sin esto, un dedazo aquí inflaría la vida de la unidad para siempre y sin
  // dejar forma evidente de notarlo.
  if (vehiculo.kilometraje != null && kmAlReiniciar < vehiculo.kilometraje) {
    throw new ValidationError(
      `El sistema tiene ${vehiculo.kilometraje.toLocaleString('es-MX')} km en esta unidad. ` +
      'Para reiniciar, el último kilometraje no puede ser menor; si lo que quieres es ' +
      'corregir la lectura, hazlo desde el chequeo diario.'
    )
  }

  const kmNuevo = data.km_nuevo ?? 0
  if (kmNuevo < 0) throw new ValidationError('La lectura nueva no puede ser negativa')

  return repo.registrarReinicio(id, tabla, {
    fecha:  data.fecha ?? fechaMexico(),
    kmAlReiniciar,
    kmNuevo,
    motivo: data.motivo?.trim() || null,
  }, registradoPor)
}

export async function getModelos() {
  const pool = await getPool()
  // Selector del alta de unidades: los modelos descontinuados no se ofrecen.
  const r = await pool.request().query(
    'SELECT id, marca, nombre FROM modelos WHERE descontinuado_en IS NULL ORDER BY marca, nombre')
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
