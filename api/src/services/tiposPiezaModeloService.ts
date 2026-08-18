import * as repo from '../repositories/tiposPiezaModeloRepo'
import type { TipoPiezaDeModelo } from '../repositories/tiposPiezaModeloRepo'
import * as modelosRepo from '../repositories/modelosRepo'
import * as tiposRepo from '../repositories/tiposPiezaRepo'
import { NotFoundError, ValidationError } from '../shared/errors'

export async function getByModelo(modeloId: number): Promise<TipoPiezaDeModelo[]> {
  return repo.findByModelo(modeloId)
}

// Todos los tipos entran con la MISMA etiqueta: es la posición que se está
// capturando ("delantero"), y agregar varios tipos a la vez para esa posición es
// lo que se hace al dar de alta una plantilla.
export async function addTipos(
  modeloId: number, tipoIds: number[], etiqueta = '',
): Promise<void> {
  const modelo = await modelosRepo.findById(modeloId)
  if (!modelo) throw new NotFoundError('Modelo')

  for (const tipoId of tipoIds) {
    if (!(await tiposRepo.findById(tipoId))) throw new NotFoundError('Tipo de pieza')
  }

  // Sin etiqueta un tipo solo cabe una vez, y el INSERT ignora en silencio lo
  // que ya estaba: sin este aviso, "Agregar" no haría nada y no se sabría por
  // qué. Con etiqueta ocupada pasa lo mismo.
  const yaEstan = await repo.findByModelo(modeloId)
  const repetido = tipoIds.find((id) =>
    yaEstan.some((t) => t.id === id && t.etiqueta === etiqueta))
  if (repetido !== undefined) {
    const nombre = yaEstan.find((t) => t.id === repetido)!.nombre
    throw new ValidationError(
      etiqueta === ''
        ? `Este modelo ya pide ${nombre}. Para pedirlo otra vez ponle una etiqueta ` +
          'que lo distinga (por ejemplo "delantero").'
        : `Este modelo ya pide ${nombre} con la etiqueta "${etiqueta}". Usa otra.`
    )
  }

  await repo.addTipos(modeloId, tipoIds.map((id) => ({ tipo_pieza_id: id, etiqueta })))
}

// Renombrar la posición de un renglón ("delantero" → "izquierdo"). La refacción
// montada y el historial de cada unidad viajan con ella: es la misma posición
// con otro nombre.
export async function renameEtiqueta(
  modeloId: number, tipoId: number, actual: string, nueva: string,
): Promise<void> {
  if (nueva === actual) return

  const renglones = await repo.findByModelo(modeloId)
  const renglon = renglones.find((t) => t.id === tipoId && t.etiqueta === actual)
  if (!renglon) throw new NotFoundError('Tipo de pieza en este modelo')

  if (renglones.some((t) => t.id === tipoId && t.etiqueta === nueva)) {
    throw new ValidationError(
      nueva === ''
        ? `Este modelo ya pide ${renglon.nombre} sin etiqueta. Ponle una que lo distinga.`
        : `Este modelo ya pide ${renglon.nombre} con la etiqueta "${nueva}". Usa otra.`
    )
  }

  // La etiqueta destino puede estar ocupada en una unidad suelta, por un renglón
  // que esa unidad agregó por su cuenta. Se avisa antes de tocar nada: a media
  // operación el choque saldría como error de clave única, sin decir dónde.
  const unidades = await repo.unidadesConEtiquetaPropia(modeloId, tipoId, nueva)
  if (unidades > 0) {
    throw new ValidationError(
      `${unidades} vehículo(s) de este modelo ya piden ${renglon.nombre} ` +
      `${nueva === '' ? 'sin etiqueta' : `con la etiqueta "${nueva}"`} por su cuenta. ` +
      'Quita ese renglón en esas unidades o usa otra etiqueta.'
    )
  }

  const ok = await repo.renameEtiqueta(modeloId, tipoId, actual, nueva)
  if (!ok) throw new NotFoundError('Tipo de pieza en este modelo')
}

export async function removeTipo(
  modeloId: number, tipoId: number, etiqueta = '',
): Promise<void> {
  const ok = await repo.removeTipo(modeloId, tipoId, etiqueta)
  if (!ok) throw new NotFoundError('Tipo de pieza en este modelo')
}
