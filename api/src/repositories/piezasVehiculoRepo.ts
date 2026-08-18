import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { fechaMexico } from '../shared/fechaMexico'

// Un tipo que necesita el vehículo, junto con la pieza que usa para cubrirlo.
// pieza_id es null mientras nadie la haya elegido: el tipo se sigue listando
// para que se vea que falta capturarla.
export interface PiezaDeVehiculo {
  tipo_pieza_id: number
  tipo_nombre:   string
  pieza_id:      number | null
  numero_serie:  string | null
  descripcion:   string | null
  // 'modelo': lo pide el modelo y se gestiona allá. 'vehiculo': es propio de
  // esta unidad y solo desde aquí se quita.
  origen:        'modelo' | 'vehiculo'
  // Del renglón abierto de la bitácora. Vienen null cuando la pieza se asignó
  // antes de que existiera el historial (renglones sembrados en la migración)
  // o cuando no se capturaron.
  fecha_instalacion: string | null
  km_instalacion:    number | null
}

// Los tipos del modelo más los propios del vehículo.
export async function findByVehiculo(vehiculoId: number): Promise<PiezaDeVehiculo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .query(`
      WITH requeridos AS (
        SELECT tpm.tipo_pieza_id, 1 AS del_modelo
        FROM vehiculos v
        JOIN tipos_pieza_modelo tpm ON tpm.modelo_id = v.modelo_id
        WHERE v.id = @vehiculoId
        UNION ALL
        SELECT tpv.tipo_pieza_id, 0
        FROM tipos_pieza_vehiculo tpv
        WHERE tpv.vehiculo_id = @vehiculoId
      )
      SELECT
        t.id     AS tipo_pieza_id,
        t.nombre AS tipo_nombre,
        p.id     AS pieza_id,
        p.numero_serie,
        p.descripcion,
        -- Un tipo puede estar en las dos listas; ahí gana 'modelo', porque es
        -- el modelo el que manda y quitarlo del vehículo no lo sacaría.
        CASE WHEN MAX(r.del_modelo) = 1 THEN 'modelo' ELSE 'vehiculo' END AS origen,
        i.fecha_instalacion,
        i.km_instalacion
      FROM requeridos r
      JOIN tipos_pieza t ON t.id = r.tipo_pieza_id
      LEFT JOIN piezas_vehiculo pv ON pv.vehiculo_id = @vehiculoId AND pv.tipo_pieza_id = t.id
      LEFT JOIN piezas p           ON p.id = pv.pieza_id
      -- El renglón vigente de la bitácora, para saber desde cuándo trae puesta
      -- esa pieza. El índice único filtrado garantiza que hay a lo sumo uno,
      -- así que agruparlo por sus columnas no puede multiplicar filas.
      LEFT JOIN instalaciones_pieza i
             ON i.vehiculo_id = @vehiculoId AND i.tipo_pieza_id = t.id
            AND i.fecha_retiro IS NULL
      GROUP BY t.id, t.nombre, p.id, p.numero_serie, p.descripcion,
               i.fecha_instalacion, i.km_instalacion
      ORDER BY t.nombre`)
  return r.recordset
}

// ¿El vehículo necesita este tipo, ya sea por su modelo o por sí mismo? Solo a
// esos tipos se les puede asignar una pieza.
export async function vehiculoRequiereTipo(vehiculoId: number, tipoId: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('tipoId',     sql.Int, tipoId)
    .query(`
      SELECT TOP 1 v.id
      FROM vehiculos v
      WHERE v.id = @vehiculoId
        AND (
          EXISTS (
            SELECT 1 FROM tipos_pieza_modelo tpm
            WHERE tpm.modelo_id = v.modelo_id AND tpm.tipo_pieza_id = @tipoId
          )
          OR EXISTS (
            SELECT 1 FROM tipos_pieza_vehiculo tpv
            WHERE tpv.vehiculo_id = v.id AND tpv.tipo_pieza_id = @tipoId
          )
        )`)
  return r.recordset.length > 0
}

// Datos que acompañan a un montaje. Todos opcionales: capturar la trazabilidad
// es lo deseable, pero no poder capturarla no debe impedir asignar la pieza.
// Sin `lote_id` el renglón queda sin rastro de compra, igual que antes de que
// existiera la bitácora.
export interface DatosMontaje {
  lote_id?:           number | null
  fecha_instalacion?: string | null
  km_instalacion?:    number | null
  mantenimiento_id?:  number | null
  // De la pieza que sale, cuando esto es un reemplazo.
  motivo_retiro?:     string | null
  destino?:           string | null
  km_retiro?:         number | null
}

// Dónde se hizo el trabajo. Sale de la tabla hija del vehículo, y solo camiones
// y montacargas la tienen; en los demás tipos queda NULL hasta que exista el
// inventario por sucursal y se decida de dónde sacarla.
const SUCURSAL_DEL_VEHICULO = `
  (SELECT COALESCE(c.sucursal_id, mc.sucursal_id)
   FROM vehiculos v
   LEFT JOIN camiones    c  ON c.vehiculo_id  = v.id
   LEFT JOIN montacargas mc ON mc.vehiculo_id = v.id
   WHERE v.id = @vehiculoId)`

// Una pieza por (vehículo, tipo): volver a asignar reemplaza la anterior.
//
// Además del estado actual en `piezas_vehiculo`, escribe la bitácora: cierra el
// renglón de la pieza que sale y abre uno para la que entra. Va en transacción
// porque un estado actual sin su renglón —o al revés— es justo la divergencia
// que la bitácora existe para evitar.
//
// Reasignar la MISMA pieza no es un reemplazo: no cierra nada ni abre renglón
// nuevo, solo corrige los datos del que ya está abierto. Tratarlo como cambio
// fabricaría una sustitución que nunca ocurrió y ensuciaría la vida útil.
export async function setPieza(
  vehiculoId: number, tipoId: number, piezaId: number, datos: DatosMontaje = {},
): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const actual = await tx.request()
      .input('vehiculoId', sql.Int, vehiculoId)
      .input('tipoId',     sql.Int, tipoId)
      .query(`
        SELECT pieza_id FROM piezas_vehiculo
        WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId`)
    const anterior: number | null = actual.recordset[0]?.pieza_id ?? null
    const esCambioDePieza = anterior !== piezaId

    await tx.request()
      .input('vehiculoId', sql.Int, vehiculoId)
      .input('tipoId',     sql.Int, tipoId)
      .input('piezaId',    sql.Int, piezaId)
      .input('loteId',     sql.Int, datos.lote_id ?? null)
      .query(`
        UPDATE piezas_vehiculo SET pieza_id = @piezaId, lote_id = @loteId
        WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId;

        IF @@ROWCOUNT = 0
          INSERT INTO piezas_vehiculo (vehiculo_id, tipo_pieza_id, pieza_id, lote_id)
          VALUES (@vehiculoId, @tipoId, @piezaId, @loteId);`)

    if (esCambioDePieza) {
      // Se llama aunque no hubiera pieza anterior: si por lo que sea quedó un
      // renglón abierto sin su fila en `piezas_vehiculo`, cerrarlo aquí evita
      // que el INSERT de abajo choque contra el índice único. Sin renglón
      // abierto no hace nada.
      await cerrarRenglon(tx, vehiculoId, tipoId, {
        fecha_retiro:  datos.fecha_instalacion ?? null,
        km_retiro:     datos.km_retiro ?? datos.km_instalacion ?? null,
        motivo_retiro: datos.motivo_retiro ?? null,
        destino:       datos.destino ?? null,
      })
      await tx.request()
        .input('vehiculoId', sql.Int,          vehiculoId)
        .input('tipoId',     sql.Int,          tipoId)
        .input('piezaId',    sql.Int,          piezaId)
        .input('loteId',     sql.Int,          datos.lote_id ?? null)
        .input('mttoId',     sql.Int,          datos.mantenimiento_id ?? null)
        .input('fecha',      sql.Date,         datos.fecha_instalacion ?? null)
        .input('km',         sql.Int,          datos.km_instalacion ?? null)
        .query(`
          INSERT INTO instalaciones_pieza
            (vehiculo_id, tipo_pieza_id, pieza_id, lote_id, sucursal_id,
             mantenimiento_id, fecha_instalacion, km_instalacion)
          VALUES
            (@vehiculoId, @tipoId, @piezaId, @loteId, ${SUCURSAL_DEL_VEHICULO},
             @mttoId, @fecha, @km)`)
    } else {
      // Misma pieza: es una corrección de datos, no un cambio. Solo se pisan
      // los campos que vinieron; los que no, se quedan como estaban.
      await tx.request()
        .input('vehiculoId', sql.Int,  vehiculoId)
        .input('tipoId',     sql.Int,  tipoId)
        .input('loteId',     sql.Int,  datos.lote_id ?? null)
        .input('mttoId',     sql.Int,  datos.mantenimiento_id ?? null)
        .input('fecha',      sql.Date, datos.fecha_instalacion ?? null)
        .input('km',         sql.Int,  datos.km_instalacion ?? null)
        .query(`
          UPDATE instalaciones_pieza SET
            lote_id           = COALESCE(@loteId, lote_id),
            mantenimiento_id  = COALESCE(@mttoId, mantenimiento_id),
            fecha_instalacion = COALESCE(@fecha,  fecha_instalacion),
            km_instalacion    = COALESCE(@km,     km_instalacion)
          WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId
            AND fecha_retiro IS NULL`)
    }

    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

interface DatosRetiro {
  fecha_retiro?:  string | null
  km_retiro?:     number | null
  motivo_retiro?: string | null
  destino?:       string | null
}

// Cierra el renglón vigente de (vehículo, tipo). El índice único filtrado
// garantiza que hay a lo sumo uno. Sin fecha explícita se usa la de hoy en
// México, no la del server: en UTC ya es mañana desde las 18:00.
async function cerrarRenglon(
  tx: sql.Transaction, vehiculoId: number, tipoId: number, datos: DatosRetiro,
): Promise<void> {
  await tx.request()
    .input('vehiculoId', sql.Int,          vehiculoId)
    .input('tipoId',     sql.Int,          tipoId)
    .input('fecha',      sql.Date,         datos.fecha_retiro ?? null)
    .input('km',         sql.Int,          datos.km_retiro ?? null)
    .input('motivo',     sql.NVarChar(30), datos.motivo_retiro ?? null)
    .input('destino',    sql.NVarChar(30), datos.destino ?? null)
    .input('hoy',        sql.Date,         fechaMexico())
    .query(`
      UPDATE instalaciones_pieza SET
        fecha_retiro  = COALESCE(@fecha, @hoy),
        km_retiro     = @km,
        motivo_retiro = @motivo,
        destino       = @destino
      WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId
        AND fecha_retiro IS NULL`)
}

export interface InstalacionHistorial {
  id:                number
  tipo_pieza_id:     number
  tipo_nombre:       string
  pieza_id:          number
  numero_serie:      string
  descripcion:       string
  lote_id:           number | null
  num_factura:       string | null
  proveedor:         string | null
  costo_unitario:    number | null
  fecha_compra:      string | null
  sucursal:          string | null
  mantenimiento_id:  number | null
  fecha_instalacion: string | null
  km_instalacion:    number | null
  fecha_retiro:      string | null
  km_retiro:         number | null
  motivo_retiro:     string | null
  destino:           string | null
}

// Todo lo que este vehículo ha traído montado. Las vigentes primero (su
// fecha_retiro es NULL) y luego las cerradas de más reciente a más antigua.
//
// El proveedor y la factura salen del lote: son la respuesta a "esta pieza
// falló, ¿contra quién reclamo?". Vienen NULL cuando no se registró el lote o
// cuando la refacción se eliminó y el FK dejó `lote_id` en NULL.
export async function findHistorial(vehiculoId: number): Promise<InstalacionHistorial[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .query(`
      SELECT
        i.id, i.tipo_pieza_id, t.nombre AS tipo_nombre,
        i.pieza_id, p.numero_serie, p.descripcion,
        i.lote_id, l.num_factura, pr.nombre AS proveedor,
        l.costo_unitario, l.fecha_compra,
        s.nombre AS sucursal,
        i.mantenimiento_id,
        i.fecha_instalacion, i.km_instalacion,
        i.fecha_retiro, i.km_retiro, i.motivo_retiro, i.destino
      FROM instalaciones_pieza i
      JOIN piezas p            ON p.id  = i.pieza_id
      JOIN tipos_pieza t       ON t.id  = i.tipo_pieza_id
      LEFT JOIN lotes_pieza l  ON l.id  = i.lote_id
      LEFT JOIN proveedores pr ON pr.id = l.proveedor_id
      LEFT JOIN sucursales s   ON s.id  = i.sucursal_id
      WHERE i.vehiculo_id = @vehiculoId
      ORDER BY
        CASE WHEN i.fecha_retiro IS NULL THEN 0 ELSE 1 END,
        i.fecha_retiro DESC, i.fecha_instalacion DESC, i.id DESC`)
  return r.recordset
}

export async function countVehiculosConPieza(piezaId: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('piezaId', sql.Int, piezaId)
    .query('SELECT COUNT(*) AS cnt FROM piezas_vehiculo WHERE pieza_id = @piezaId')
  return r.recordset[0].cnt
}

// Al cambiar el tipo de una pieza, los vehículos que la habían elegido para el
// tipo anterior quedan con una asignación que ya no corresponde: se borra.
export async function removeAsignacionesFueraDeTipo(piezaId: number): Promise<void> {
  const pool = await getPool()
  // Los renglones abiertos de esas asignaciones se cierran junto con ellas: si
  // no, la bitácora seguiría diciendo que la pieza está montada cuando ya no lo
  // está, y el índice único bloquearía el próximo montaje de ese tipo. El
  // motivo no es un retiro físico, así que va sin motivo ni destino.
  await pool.request()
    .input('piezaId', sql.Int,  piezaId)
    .input('hoy',     sql.Date, fechaMexico())
    .query(`
      UPDATE i SET i.fecha_retiro = @hoy
      FROM instalaciones_pieza i
      JOIN piezas p ON p.id = i.pieza_id
      WHERE i.pieza_id = @piezaId
        AND i.fecha_retiro IS NULL
        AND (p.tipo_pieza_id IS NULL OR i.tipo_pieza_id <> p.tipo_pieza_id);

      DELETE pv
      FROM piezas_vehiculo pv
      JOIN piezas p ON p.id = pv.pieza_id
      WHERE pv.pieza_id = @piezaId
        AND (p.tipo_pieza_id IS NULL OR pv.tipo_pieza_id <> p.tipo_pieza_id)`)
}

// Quitar la pieza sin poner otra. Borra el estado actual y cierra el renglón:
// el vehículo deja de traerla, pero que la trajo no se borra.
export async function removePieza(
  vehiculoId: number, tipoId: number, datos: DatosRetiro = {},
): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const r = await tx.request()
      .input('vehiculoId', sql.Int, vehiculoId)
      .input('tipoId',     sql.Int, tipoId)
      .query(`
        DELETE FROM piezas_vehiculo
        OUTPUT DELETED.id
        WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId`)
    const habia = r.recordset.length > 0
    if (habia) await cerrarRenglon(tx, vehiculoId, tipoId, datos)
    await tx.commit()
    return habia
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
