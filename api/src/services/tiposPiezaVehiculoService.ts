import * as repo from '../repositories/tiposPiezaVehiculoRepo'
import * as piezasRepo from '../repositories/piezasVehiculoRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import * as tiposRepo from '../repositories/tiposPiezaRepo'
import { NotFoundError, ValidationError } from '../shared/errors'

// Todos los tipos entran con la MISMA etiqueta: es la posición que se está
// capturando para esta unidad.
export async function addTipos(
  vehiculoId: number, tipoIds: number[], etiqueta = '',
): Promise<void> {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')

  for (const tipoId of tipoIds) {
    const tipo = await tiposRepo.findById(tipoId)
    if (!tipo) throw new NotFoundError('Tipo de pieza')

    // El renglón puede venir del modelo o de la propia unidad: en los dos casos
    // ya está en la lista y volver a insertarlo no agregaría nada. Sin este
    // aviso el INSERT lo ignora en silencio y parece que el botón no sirve.
    if (await piezasRepo.vehiculoRequiereTipo(vehiculoId, tipoId, etiqueta)) {
      throw new ValidationError(
        etiqueta === ''
          ? `Este vehículo ya necesita ${tipo.nombre}. Para agregarlo otra vez ponle ` +
            'una etiqueta que lo distinga (por ejemplo "delantero").'
          : `Este vehículo ya necesita ${tipo.nombre} con la etiqueta "${etiqueta}". Usa otra.`
      )
    }
  }

  await repo.addTipos(vehiculoId, tipoIds.map((id) => ({ tipo_pieza_id: id, etiqueta })))
}

export async function removeTipo(
  vehiculoId: number, tipoId: number, etiqueta = '',
): Promise<void> {
  const ok = await repo.removeTipo(vehiculoId, tipoId, etiqueta)
  // Falla también cuando el renglón viene del modelo: no está en la lista propia
  // del vehículo, y quitarlo se hace desde el modelo.
  if (!ok) throw new NotFoundError('Tipo de pieza propio de este vehículo')
}
