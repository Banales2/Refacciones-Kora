// El candado de la revisión.
//
// Un renglón sellado ya no se edita, y una cabecera sellada tampoco: el sentido
// de que alguien verifique una factura contra su papel se pierde si después
// cualquiera puede cambiar lo verificado sin que se note.
//
// EL CANDADO ES DE LA CAPTURA, NO DEL ALMACÉN. Esto es lo que más fácil se
// rompe al tocar este archivo, así que conviene dejarlo escrito: lo que se
// bloquea es lo que dice el papel —costo, cantidad, folio, fecha, IVA,
// descuento, proveedor—. Las existencias, los montajes, los consumos, los
// traspasos y los descuadres siguen moviéndose igual sobre un lote sellado.
// Una pieza revisada se sigue montando en un camión; congelar el papel no puede
// congelar el estante.
//
// Qué NO bloquea, y es deliberado: agregar un renglón nuevo a una factura ya
// cerrada. El renglón nace sin sello, así que la factura deja de estar cerrada y
// vuelve sola a la bandeja — que es justo lo que tiene que pasar cuando el
// verificador encuentra en el papel una pieza que nadie capturó.
//
// Ver `db/migrations/040_revision_de_facturas.sql`.
import * as sql from 'mssql'
import { getPool } from './db'
import { AppError } from './errors'

/** El cliente usa estos códigos para explicar el bloqueo sin adivinar por el texto. */
export const RENGLON_REVISADO = 'RENGLON_REVISADO'
export const CABECERA_REVISADA = 'CABECERA_REVISADA'
export const MANO_OBRA_REVISADA = 'MANO_OBRA_REVISADA'

export interface EstadoRevision {
  factura_id: number | null
  renglon_revisado: boolean
  renglon_revisado_por: string | null
  cabecera_revisada: boolean
  cabecera_revisada_por: string | null
}

/**
 * Cómo está de revisión el renglón y la cabecera a la que pertenece.
 *
 * Devuelve `null` si el lote no existe. Un lote sin factura —el de recuperación
 * de la migración 024— nunca está sellado: no salió de ninguna compra y no hay
 * papel contra el cual cuadrarlo.
 */
export async function estadoDeLote(loteId: number): Promise<EstadoRevision | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, loteId)
    .query(`
      SELECT l.factura_id,
             l.revisado_en, l.revisado_por,
             f.cabecera_revisada_en, f.cabecera_revisada_por
      FROM lotes_pieza l
      LEFT JOIN facturas f ON f.id = l.factura_id
      WHERE l.id = @id`)
  const fila = r.recordset[0]
  if (!fila) return null
  return {
    factura_id: fila.factura_id ?? null,
    renglon_revisado: fila.revisado_en !== null,
    renglon_revisado_por: fila.revisado_por ?? null,
    cabecera_revisada: fila.cabecera_revisada_en !== null,
    cabecera_revisada_por: fila.cabecera_revisada_por ?? null,
  }
}

/** Si la cabecera de esa factura ya está sellada. */
export async function cabeceraRevisada(
  facturaId: number,
): Promise<{ revisada: boolean; por: string | null; folio: string } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`SELECT folio, cabecera_revisada_en, cabecera_revisada_por
            FROM facturas WHERE id = @id`)
  const fila = r.recordset[0]
  if (!fila) return null
  return {
    revisada: fila.cabecera_revisada_en !== null,
    por: fila.cabecera_revisada_por ?? null,
    folio: fila.folio as string,
  }
}

function bloqueo(mensaje: string, code: string): AppError {
  // 409 y no 403: no es que a esta persona le falten permisos —un admin tampoco
  // puede—, es que el registro está en un estado que no admite el cambio.
  return new AppError(mensaje, 409, code)
}

/**
 * Rechaza el cambio si el renglón ya fue revisado.
 *
 * `tocaCabecera` distingue los dos candados, porque `PUT /lotes/{id}` puede
 * cambiar las dos cosas: el costo y la cantidad son del renglón, pero el
 * proveedor, la fecha, el IVA y quién compró son de la factura y se aplican a
 * todos sus renglones (ver `lotesRepo.update`). Editar la cabecera "desde un
 * lote" tiene que chocar con el sello de la cabecera, no con el del renglón.
 */
export async function assertLoteEditable(
  loteId: number, opciones: { tocaRenglon?: boolean; tocaCabecera?: boolean } = {},
): Promise<void> {
  const { tocaRenglon = true, tocaCabecera = false } = opciones
  const estado = await estadoDeLote(loteId)
  if (!estado) return // No existe: que el 404 lo dé quien sepa de qué habla.

  if (tocaRenglon && estado.renglon_revisado) {
    throw bloqueo(
      `Este renglón ya fue revisado${estado.renglon_revisado_por ? ` por ${estado.renglon_revisado_por}` : ''} ` +
      'y no se puede editar. Reabre la revisión de la factura para corregirlo.',
      RENGLON_REVISADO,
    )
  }

  if (tocaCabecera && estado.cabecera_revisada) {
    throw bloqueo(
      `Los datos de esta factura ya fueron revisados${estado.cabecera_revisada_por ? ` por ${estado.cabecera_revisada_por}` : ''} ` +
      'y no se pueden editar. Reabre la revisión de la factura para corregirlos.',
      CABECERA_REVISADA,
    )
  }
}

/** Rechaza el cambio si la cabecera de esa factura ya fue revisada. */
export async function assertCabeceraEditable(facturaId: number): Promise<void> {
  const estado = await cabeceraRevisada(facturaId)
  if (!estado || !estado.revisada) return
  throw bloqueo(
    `La factura ${estado.folio} ya fue revisada${estado.por ? ` por ${estado.por}` : ''} ` +
    'y no se puede editar. Reábrela para corregirla.',
    CABECERA_REVISADA,
  )
}

/**
 * Rechaza el cambio si la mano de obra de ese mantenimiento ya se cuadró.
 *
 * ES EL CANDADO MÁS ESTRECHO DE LOS TRES, y tiene que serlo. Lo único que la
 * factura del taller da por bueno es `mantenimiento.costo`; la fecha, el
 * kilometraje, las observaciones, las piezas consumidas y las incidencias que
 * cerró no salen de ningún papel y se siguen corrigiendo igual sobre un
 * mantenimiento sellado. Es el mismo principio que allá: se congela lo que dice
 * el papel, no el expediente del camión.
 *
 * Ver `db/migrations/046_facturas_de_mantenimiento.sql`.
 */
export async function assertManoObraEditable(mantenimientoId: number): Promise<void> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, mantenimientoId)
    .query('SELECT revisado_en, revisado_por FROM mantenimiento WHERE id = @id')
  const fila = r.recordset[0]
  if (!fila || fila.revisado_en === null) return

  throw bloqueo(
    `La mano de obra de este servicio ya se cuadró contra su factura` +
    `${fila.revisado_por ? ` por ${fila.revisado_por}` : ''} y no se puede cambiar. ` +
    'Reabre la revisión de esa factura para corregirla.',
    MANO_OBRA_REVISADA,
  )
}

/**
 * Rechaza la fusión si cualquiera de las dos facturas está revisada.
 *
 * Las dos, no solo la de origen: fusionar mete renglones ajenos en la factura
 * destino y le cambia el total, que es exactamente lo que alguien ya dio por
 * bueno contra el papel.
 */
export async function assertFusionPermitida(
  origenId: number, destinoId: number,
): Promise<void> {
  await assertCabeceraEditable(origenId)
  await assertCabeceraEditable(destinoId)
}
