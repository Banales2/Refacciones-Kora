// Reglas del programa de mantenimiento de un modelo. El repositorio guarda la
// cuadrícula; aquí vive lo que la hace válida y lo que se deriva de ella.
import * as repo from '../repositories/programaRepo'
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors'
import type {
  ProgramaCreate, ProgramaUpdate, ProgramaCompleto,
  OperacionCreate, OperacionUpdate, FaseEntrada, Fase,
} from '../repositories/programaRepo'

export async function getAcciones() {
  return repo.findAcciones()
}

export async function getByModelo(modeloId: number): Promise<ProgramaCompleto | null> {
  return repo.findByModelo(modeloId)
}

export async function getById(id: number): Promise<ProgramaCompleto> {
  const programa = await repo.findById(id)
  if (!programa) throw new NotFoundError('Programa de mantenimiento')
  return programa
}

export async function create(modeloId: number, data: Omit<ProgramaCreate, 'modelo_id'>) {
  // Mientras sea uno por modelo (migración 012) conviene decirlo con un 409 y
  // no dejar que reviente el índice único con un 500.
  if (await repo.findByModelo(modeloId)) {
    throw new ConflictError('Este modelo ya tiene un programa de mantenimiento')
  }
  return repo.create({ ...data, modelo_id: modeloId })
}

export async function update(id: number, data: ProgramaUpdate) {
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Programa de mantenimiento')
  return updated
}

export async function remove(id: number) {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Programa de mantenimiento')
}

// ─── Fases ──────────────────────────────────────────────────────────────────

export async function setFases(programaId: number, fases: FaseEntrada[]) {
  if (!await repo.findCabecera(programaId)) throw new NotFoundError('Programa de mantenimiento')
  await repo.setFases(programaId, fases)
  return getById(programaId)
}

// ─── Operaciones ────────────────────────────────────────────────────────────

export async function createOperacion(programaId: number, data: OperacionCreate) {
  if (!await repo.findCabecera(programaId)) throw new NotFoundError('Programa de mantenimiento')
  return repo.createOperacion(programaId, data)
}

export async function updateOperacion(id: number, data: OperacionUpdate) {
  if (!await repo.updateOperacion(id, data)) throw new NotFoundError('Operación')
  return (await repo.findOperacion(id))!
}

export async function removeOperacion(id: number) {
  if (!await repo.removeOperacion(id)) throw new NotFoundError('Operación')
}

export async function reordenarOperaciones(programaId: number, ids: number[]) {
  if (!await repo.findCabecera(programaId)) throw new NotFoundError('Programa de mantenimiento')
  await repo.reordenarOperaciones(programaId, ids)
  return getById(programaId)
}

// ─── Celdas ─────────────────────────────────────────────────────────────────

export async function setCeldas(
  operacionId: number,
  celdas: { fase_id: number; accion: string }[],
) {
  const programa = await repo.findProgramaDeOperacion(operacionId)
  if (!programa) throw new NotFoundError('Operación')

  // Una celda solo puede caer en una columna de su propio programa: aceptar la
  // fase de otro modelo dejaría un renglón que no se puede ni dibujar.
  const propias = new Set(await repo.idsDeFases(programa.id))
  const ajena = celdas.find((c) => !propias.has(c.fase_id))
  if (ajena) throw new ValidationError('Hay una celda que no corresponde a una fase de este programa')

  const acciones = new Set((await repo.findAcciones()).map((a) => a.codigo))
  const desconocida = celdas.find((c) => !acciones.has(c.accion))
  if (desconocida) throw new ValidationError(`La acción "${desconocida.accion}" no está en el catálogo`)

  await repo.setCeldas(operacionId, celdas)
  return getById(programa.id)
}

// ─── Calendario derivado ────────────────────────────────────────────────────

export interface ServicioProgramado {
  /** Cuántos servicios van antes que este, desde el arranque del programa. */
  indice: number
  /** Kilometraje de odómetro, contado desde el arranque del programa. */
  km:     number
  fase:   Fase
}

// Cuánto avanza el odómetro para llegar a una fase desde la anterior. Es la
// diferencia entre marcas; para la primera del programa, su propia marca. Al
// dar la vuelta se usa la de la fase de retorno, que es justo lo que hace que
// de 105,000 se pase a 120,000 con la columna de 30,000 (migración 012).
function saltoHacia(fases: Fase[], i: number): number {
  return i === 0 ? fases[0].km : fases[i].km - fases[i - 1].km
}

// Los siguientes `cuantos` servicios del programa, en orden, a partir de los que
// ya se hicieron. Es la traducción de la tabla del fabricante a "a qué
// kilometraje toca cada visita", y con ella se calcula el vencimiento por km.
//
// `serviciosHechos` cuenta desde el arranque del programa, así que el índice
// dice también qué columna toca: las únicas se consumen en la primera pasada y
// después el recorrido se queda dando vueltas sobre el resto.
export function proximosServicios(
  fases:           Fase[],
  serviciosHechos: number,
  cuantos:         number = 1,
): ServicioProgramado[] {
  if (!fases.length || cuantos <= 0) return []
  const bucle = fases.filter((f) => !f.unica)
  if (!bucle.length) return []

  const salida: ServicioProgramado[] = []
  let km = 0
  for (let i = 0; salida.length < cuantos; i++) {
    // Las fases únicas solo existen en la primera pasada; agotadas, el índice
    // se reparte entre las del bucle.
    const posicion = i < fases.length
      ? i
      : fases.length - bucle.length + ((i - fases.length) % bucle.length)
    km += saltoHacia(fases, posicion)
    if (i >= serviciosHechos) {
      salida.push({ indice: i, km, fase: fases[posicion] })
    }
    // Cinturón: sin fases del bucle ya salimos arriba, pero un programa mal
    // capturado no debe colgar el proceso.
    if (i > serviciosHechos + cuantos + fases.length * 2) break
  }
  return salida
}
