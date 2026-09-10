import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Descuadres de inventario: lo que el sistema sabe que quedó mal contado y no
// puede arreglar solo. Ver `db/migrations/022_descuadres_inventario.sql`.
//
// Hoy los produce un único caso —el montaje retroactivo que le cambia el destino
// a una pieza ya devuelta al almacén— pero la tabla no lo asume: `origen` es
// texto justamente para que el siguiente no obligue a migrarla.

export type StatusDescuadre = 'abierto' | 'ajustado' | 'aceptado'

/** Cómo se cierra un descuadre. Los dos son finales legítimos. */
export type ResolucionDescuadre = Exclude<StatusDescuadre, 'abierto'>

export interface DescuadreCreate {
  pieza_id:          number
  sucursal_id:       number
  lote_id?:          number | null
  /** Signo del almacén: +1 = el sistema cuenta una unidad que no está. */
  diferencia:        number
  origen:            string
  motivo:            string
  vehiculo_id?:      number | null
  instalacion_id?:   number | null
  mantenimiento_id?: number | null
  creado_por?:       string | null
}

export interface Descuadre {
  id:               number
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  sucursal_id:      number
  sucursal:         string
  lote_id:          number | null
  num_factura:      string | null
  diferencia:       number
  origen:           string
  motivo:           string
  vehiculo_id:      number | null
  /** Placas de la unidad, o su número de serie si no las trae. */
  vehiculo:         string | null
  instalacion_id:   number | null
  mantenimiento_id: number | null
  status:           StatusDescuadre
  nota_resolucion:  string | null
  resuelto_por:     string | null
  resuelto_en:      string | null
  creado_por:       string | null
  created_at:       string
}

/**
 * Deja constancia del descuadre DENTRO de la transacción que lo produjo.
 *
 * Exige la transacción en curso a propósito, igual que `pendientesRepo.insert`:
 * el descuadre solo tiene sentido si el movimiento que lo causó se guardó. Si el
 * montaje se cae, esto se cae con él y no queda un pendiente fantasma pidiendo
 * que se cuente un estante que nadie tocó.
 */
export async function crear(tx: sql.Transaction, d: DescuadreCreate): Promise<number> {
  const r = await tx.request()
    .input('piezaId',     sql.Int,           d.pieza_id)
    .input('sucursalId',  sql.Int,           d.sucursal_id)
    .input('loteId',      sql.Int,           d.lote_id ?? null)
    .input('diferencia',  sql.Int,           d.diferencia)
    .input('origen',      sql.NVarChar(30),  d.origen)
    .input('motivo',      sql.NVarChar(500), d.motivo)
    .input('vehiculoId',  sql.Int,           d.vehiculo_id ?? null)
    .input('instalacion', sql.Int,           d.instalacion_id ?? null)
    .input('mttoId',      sql.Int,           d.mantenimiento_id ?? null)
    .input('creadoPor',   sql.NVarChar(255), d.creado_por ?? null)
    .query(`
      INSERT INTO descuadres_inventario
        (pieza_id, sucursal_id, lote_id, diferencia, origen, motivo,
         vehiculo_id, instalacion_id, mantenimiento_id, creado_por)
      OUTPUT INSERTED.id
      VALUES
        (@piezaId, @sucursalId, @loteId, @diferencia, @origen, @motivo,
         @vehiculoId, @instalacion, @mttoId, @creadoPor)`)
  return r.recordset[0].id as number
}

const SELECT_DESCUADRE = `
  SELECT d.id, d.pieza_id, p.numero_serie, p.descripcion,
         d.sucursal_id, s.nombre AS sucursal,
         d.lote_id, l.num_factura,
         d.diferencia, d.origen, d.motivo,
         d.vehiculo_id,
         COALESCE(NULLIF(v.placas, ''), v.numero_serie) AS vehiculo,
         d.instalacion_id, d.mantenimiento_id,
         d.status, d.nota_resolucion, d.resuelto_por, d.resuelto_en,
         d.creado_por, d.created_at
  FROM descuadres_inventario d
  JOIN piezas p     ON p.id = d.pieza_id
  JOIN sucursales s ON s.id = d.sucursal_id
  LEFT JOIN lotes_pieza l ON l.id = d.lote_id
  LEFT JOIN vehiculos   v ON v.id = d.vehiculo_id`

/**
 * Los descuadres abiertos, opcionalmente los de una sola sucursal.
 *
 * Sin filtro devuelve los de toda la flota: es lo que necesita el aviso de
 * arriba de la pantalla, que existe para que un descuadre en una sucursal que
 * nadie abre no se quede invisible para siempre.
 */
export async function findAbiertos(sucursalId?: number): Promise<Descuadre[]> {
  const pool = await getPool()
  const req = pool.request()
  let filtro = ''
  if (sucursalId !== undefined) {
    req.input('sucursalId', sql.Int, sucursalId)
    filtro = ' AND d.sucursal_id = @sucursalId'
  }
  const r = await req.query(`
    ${SELECT_DESCUADRE}
    WHERE d.status = 'abierto'${filtro}
    ORDER BY d.created_at DESC`)
  return r.recordset
}

export async function findById(id: number): Promise<Descuadre | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_DESCUADRE} WHERE d.id = @id`)
  return r.recordset[0] ?? null
}

/**
 * Cierra un descuadre. Solo pasa de 'abierto' a un final: reabrirlo o cambiarle
 * el final sería reescribir lo que alguien ya fue a contar al estante, y el
 * WHERE lo impide. Si hace falta volver a mirarlo, lo que corresponde es un
 * descuadre nuevo con la fecha del conteo nuevo.
 */
export async function resolver(
  id: number, status: ResolucionDescuadre, nota: string | null, usuario: string,
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',      sql.Int,           id)
    .input('status',  sql.NVarChar(20),  status)
    .input('nota',    sql.NVarChar(500), nota)
    .input('usuario', sql.NVarChar(255), usuario)
    .query(`
      UPDATE descuadres_inventario SET
        status          = @status,
        nota_resolucion = @nota,
        resuelto_por    = @usuario,
        resuelto_en     = SYSUTCDATETIME()
      WHERE id = @id AND status = 'abierto'`)
  return (r.rowsAffected[0] ?? 0) > 0
}
