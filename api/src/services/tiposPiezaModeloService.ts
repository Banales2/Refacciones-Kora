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

export async function removeTipo(
  modeloId: number, tipoId: number, etiqueta = '',
): Promise<void> {
  const ok = await repo.removeTipo(modeloId, tipoId, etiqueta)
  if (!ok) throw new NotFoundError('Tipo de pieza en este modelo')
}
