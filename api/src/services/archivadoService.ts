// La mitad de servicio del archivado de catálogos (migración 033). Igual que su
// repositorio, existe para no repetir ocho veces la misma comprobación y que una
// se quede atrás.
import * as repo from '../repositories/archivadoRepo'
import * as sucursalesRepo from '../repositories/sucursalesRepo'
import * as rutasRepo from '../repositories/rutasRepo'
import * as piezasVehiculoRepo from '../repositories/piezasVehiculoRepo'
import * as tiposPiezaRepo from '../repositories/tiposPiezaRepo'
import { NotFoundError, ConflictError } from '../shared/errors'

// Archivar es seguro casi siempre: el renglón se queda en la base y todo lo que
// lo referencia lo sigue resolviendo por id. La excepción es cuando algo VIVO
// —no histórico— va a necesitar volver a ELEGIRLO en un selector, porque ese
// selector ya no lo va a ofrecer. Ahí archivar no pierde el dato, pero deja el
// trabajo trabado, y eso es lo que estas guardas impiden.
//
// Por eso no están todas las que había cuando esto se borraba: que una
// gasolinera tenga recargas o un proveedor tenga lotes es historia, y la
// historia no se rompe al archivar. Que una sucursal tenga piezas dentro, sí.
const GUARDAS: Partial<Record<repo.TablaArchivable, (id: number) => Promise<void>>> = {
  async sucursales(id) {
    const unidades = await sucursalesRepo.countCamiones(id)
    if (unidades > 0) {
      throw new ConflictError(
        `Esta sucursal tiene ${unidades} unidad(es) de reparto asignada(s). ` +
        'Reasígnalas antes de archivarla, o al editarlas ya no vas a poder volver a elegirla.'
      )
    }
    // Archivar una sucursal con piezas dentro deja ese inventario varado: la
    // sucursal desaparece del selector de traspasos, que es justo por donde se
    // sacarían. Hay que vaciarla primero.
    const piezas = await sucursalesRepo.countExistencias(id)
    if (piezas > 0) {
      throw new ConflictError(
        `Esta sucursal tiene ${piezas} pieza(s) en inventario y no puede archivarse. ` +
        'Traspásalas a otra sucursal primero.'
      )
    }
  },

  async rutas(id) {
    const unidades = await rutasRepo.countTractocamiones(id)
    if (unidades > 0) {
      throw new ConflictError(
        `Esta ruta tiene ${unidades} unidad(es) de translado asignada(s). ` +
        'Reasígnalas antes de archivarla.'
      )
    }
  },

  async piezas(id) {
    const vehiculos = await piezasVehiculoRepo.countVehiculosConPieza(id)
    if (vehiculos > 0) {
      throw new ConflictError(
        `Esta refacción está montada en ${vehiculos} vehículo(s) y no puede archivarse. ` +
        'Quítala de esas unidades primero.'
      )
    }
  },

  async tipos_pieza(id) {
    const { modelos, vehiculos, piezas } = await tiposPiezaRepo.countReferencias(id)
    if (modelos > 0 || vehiculos > 0 || piezas > 0) {
      const partes = [
        modelos   > 0 ? `${modelos} modelo(s) lo requieren`        : null,
        vehiculos > 0 ? `${vehiculos} vehículo(s) lo necesitan`    : null,
        piezas    > 0 ? `${piezas} refacción(es) son de este tipo` : null,
      ].filter(Boolean)
      throw new ConflictError(`No se puede archivar: ${partes.join(', ')}`)
    }
  },
}

export async function archivar(
  tabla: repo.TablaArchivable, etiqueta: string, id: number, motivo?: string,
): Promise<void> {
  const estado = await repo.estaArchivado(tabla, id)
  if (estado === null) throw new NotFoundError(etiqueta)
  if (estado) throw new ConflictError(`${etiqueta} ya está archivado`)

  await GUARDAS[tabla]?.(id)

  if (!await repo.archivar(tabla, id, motivo?.trim() || null)) throw new NotFoundError(etiqueta)
}

// Restaurar nunca necesita guarda: devolver un renglón al catálogo no puede
// romper nada, solo vuelve a ofrecerlo.
export async function restaurar(
  tabla: repo.TablaArchivable, etiqueta: string, id: number,
): Promise<void> {
  const estado = await repo.estaArchivado(tabla, id)
  if (estado === null) throw new NotFoundError(etiqueta)
  if (!estado) throw new ConflictError(`${etiqueta} no está archivado`)
  if (!await repo.restaurar(tabla, id)) throw new NotFoundError(etiqueta)
}
