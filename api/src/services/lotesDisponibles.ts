// El candado de "este lote todavía no llega", en un solo sitio.
//
// Son tres las puertas por las que una pieza sale del almacén —el consumo de un
// mantenimiento, el montaje en una unidad y el traspaso entre sucursales— y las
// tres tienen que negarse igual. Vive aquí y no en cada servicio porque el
// mensaje importa tanto como la negativa: decir "no hay existencia" de un lote
// que sí se compró manda a buscar un faltante que no existe, y lo que hay que
// decir es cuándo llega.
//
// Ver `db/migrations/051_fecha_de_llegada_del_lote.sql`.
import { llegadaPendiente } from '../repositories/inventarioSql'
import { ValidationError } from '../shared/errors'

/** "2026-03-12" → "12/03/2026". Sin Date de por medio: no hay zona que corra. */
function enEspanol(iso: string): string {
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

export async function exigirLoteLlegado(loteId: number): Promise<void> {
  const llega = await llegadaPendiente(loteId)
  if (llega) {
    throw new ValidationError(
      `Ese lote llega el ${enEspanol(llega)}: todavía no está en el almacén y no se puede usar. ` +
      'Si ya llegó, corrige su fecha de llegada en la refacción.'
    )
  }
}
