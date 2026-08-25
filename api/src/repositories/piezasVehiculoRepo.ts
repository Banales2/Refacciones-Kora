import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { fechaMexico } from '../shared/fechaMexico'
import { moverExistencia } from './inventarioSql'

// Un renglón que necesita el vehículo, junto con la pieza que usa para
// cubrirlo. pieza_id es null mientras nadie la haya elegido: el renglón se sigue
// listando para que se vea que falta capturarla.
//
// El renglón NO es el tipo: es el par (tipo, etiqueta). Una unidad que lleva dos
// filtros de aire trae dos renglones del mismo tipo con etiquetas distintas
// ("delantero", "trasero"), cada uno con su refacción, su lote y su historial.
// La etiqueta vacía es el caso normal de un tipo que va una sola vez.
export interface PiezaDeVehiculo {
  tipo_pieza_id: number
  tipo_nombre:   string
  etiqueta:      string
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
        SELECT tpm.tipo_pieza_id, tpm.etiqueta, 1 AS del_modelo
        FROM vehiculos v
        JOIN tipos_pieza_modelo tpm ON tpm.modelo_id = v.modelo_id
        WHERE v.id = @vehiculoId
        UNION ALL
        SELECT tpv.tipo_pieza_id, tpv.etiqueta, 0
        FROM tipos_pieza_vehiculo tpv
        WHERE tpv.vehiculo_id = @vehiculoId
      )
      SELECT
        t.id       AS tipo_pieza_id,
        t.nombre   AS tipo_nombre,
        r.etiqueta,
        p.id       AS pieza_id,
        p.numero_serie,
        p.descripcion,
        -- Un renglón puede estar en las dos listas; ahí gana 'modelo', porque es
        -- el modelo el que manda y quitarlo del vehículo no lo sacaría.
        CASE WHEN MAX(r.del_modelo) = 1 THEN 'modelo' ELSE 'vehiculo' END AS origen,
        i.fecha_instalacion,
        i.km_instalacion
      FROM requeridos r
      JOIN tipos_pieza t ON t.id = r.tipo_pieza_id
      -- Todo se empata por (tipo, etiqueta): dos filtros de aire con etiquetas
      -- distintas son dos renglones independientes y cada uno trae lo suyo.
      LEFT JOIN piezas_vehiculo pv ON pv.vehiculo_id = @vehiculoId
                                  AND pv.tipo_pieza_id = t.id
                                  AND pv.etiqueta      = r.etiqueta
      LEFT JOIN piezas p           ON p.id = pv.pieza_id
      -- El renglón vigente de la bitácora, para saber desde cuándo trae puesta
      -- esa pieza. El índice único filtrado garantiza que hay a lo sumo uno,
      -- así que agruparlo por sus columnas no puede multiplicar filas.
      LEFT JOIN instalaciones_pieza i
             ON i.vehiculo_id = @vehiculoId AND i.tipo_pieza_id = t.id
            AND i.etiqueta = r.etiqueta
            AND i.fecha_retiro IS NULL
      GROUP BY t.id, t.nombre, r.etiqueta, p.id, p.numero_serie, p.descripcion,
               i.fecha_instalacion, i.km_instalacion
      ORDER BY t.nombre, r.etiqueta`)
  return r.recordset
}

// ¿El vehículo necesita este renglón (tipo + etiqueta), ya sea por su modelo o
// por sí mismo? Solo a esos renglones se les puede asignar una pieza. La
// etiqueta entra en la pregunta: pedir "filtro de aire delantero" no autoriza a
// montar un "filtro de aire trasero" que nadie pidió.
export async function vehiculoRequiereTipo(
  vehiculoId: number, tipoId: number, etiqueta: string,
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('tipoId',     sql.Int, tipoId)
    .input('etiqueta',   sql.NVarChar(40), etiqueta)
    .query(`
      SELECT TOP 1 v.id
      FROM vehiculos v
      WHERE v.id = @vehiculoId
        AND (
          EXISTS (
            SELECT 1 FROM tipos_pieza_modelo tpm
            WHERE tpm.modelo_id = v.modelo_id
              AND tpm.tipo_pieza_id = @tipoId
              AND tpm.etiqueta      = @etiqueta
          )
          OR EXISTS (
            SELECT 1 FROM tipos_pieza_vehiculo tpv
            WHERE tpv.vehiculo_id = v.id
              AND tpv.tipo_pieza_id = @tipoId
              AND tpv.etiqueta      = @etiqueta
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
  // De qué sucursal sale la pieza. Con ella (y sin consumo ligado) el montaje
  // descuenta 1 del almacén; sin ella no se descuenta nada, que es el caso de
  // la captura retroactiva de una pieza que ya estaba puesta.
  sucursal_id?:       number | null
  // El renglón de consumo del mantenimiento que YA descontó esta pieza. Si
  // viene, el montaje no vuelve a descontar: solo se cuelga de él.
  detalle_mtto_pieza_id?: number | null
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

// Una pieza por (vehículo, tipo, etiqueta): volver a asignar reemplaza la
// anterior. Los otros renglones del mismo tipo no se enteran: cambiar el filtro
// delantero no toca al trasero.
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
  vehiculoId: number, tipoId: number, etiqueta: string, piezaId: number,
  datos: DatosMontaje = {},
): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const actual = await tx.request()
      .input('vehiculoId', sql.Int, vehiculoId)
      .input('tipoId',     sql.Int, tipoId)
      .input('etiqueta',   sql.NVarChar(40), etiqueta)
      .query(`
        SELECT pieza_id FROM piezas_vehiculo
        WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId
          AND etiqueta = @etiqueta`)
    const anterior: number | null = actual.recordset[0]?.pieza_id ?? null
    const esCambioDePieza = anterior !== piezaId

    await tx.request()
      .input('vehiculoId', sql.Int, vehiculoId)
      .input('tipoId',     sql.Int, tipoId)
      .input('etiqueta',   sql.NVarChar(40), etiqueta)
      .input('piezaId',    sql.Int, piezaId)
      .input('loteId',     sql.Int, datos.lote_id ?? null)
      .query(`
        UPDATE piezas_vehiculo SET pieza_id = @piezaId, lote_id = @loteId
        WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId
          AND etiqueta = @etiqueta;

        IF @@ROWCOUNT = 0
          INSERT INTO piezas_vehiculo (vehiculo_id, tipo_pieza_id, etiqueta, pieza_id, lote_id)
          VALUES (@vehiculoId, @tipoId, @etiqueta, @piezaId, @loteId);`)

    if (esCambioDePieza) {
      // De dónde salió la que se va, por si regresa al almacén. Se lee antes de
      // cerrar el renglón porque el filtro es `fecha_retiro IS NULL`.
      const saliente = await tx.request()
        .input('vehiculoId', sql.Int, vehiculoId)
        .input('tipoId',     sql.Int, tipoId)
        .input('etiqueta',   sql.NVarChar(40), etiqueta)
        .query(`
          SELECT lote_id, sucursal_id FROM instalaciones_pieza
          WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId
            AND etiqueta = @etiqueta AND fecha_retiro IS NULL`)

      // Se llama aunque no hubiera pieza anterior: si por lo que sea quedó un
      // renglón abierto sin su fila en `piezas_vehiculo`, cerrarlo aquí evita
      // que el INSERT de abajo choque contra el índice único. Sin renglón
      // abierto no hace nada.
      await cerrarRenglon(tx, vehiculoId, tipoId, etiqueta, {
        fecha_retiro:  datos.fecha_instalacion ?? null,
        km_retiro:     datos.km_retiro ?? datos.km_instalacion ?? null,
        motivo_retiro: datos.motivo_retiro ?? null,
        destino:       datos.destino ?? null,
      })

      // La que sale vuelve al estante: se devuelve a su lote y su sucursal. Es
      // la contraparte del descuento de más abajo, y en un reemplazo las dos
      // cosas pasan en la misma transacción.
      const sal = saliente.recordset[0]
      if (datos.destino === 'stock' && sal?.lote_id != null && sal?.sucursal_id != null) {
        await moverExistencia(tx, sal.lote_id, sal.sucursal_id, 1)
      }

      await tx.request()
        .input('vehiculoId', sql.Int,          vehiculoId)
        .input('tipoId',     sql.Int,          tipoId)
        .input('etiqueta',   sql.NVarChar(40), etiqueta)
        .input('piezaId',    sql.Int,          piezaId)
        .input('loteId',     sql.Int,          datos.lote_id ?? null)
        .input('mttoId',     sql.Int,          datos.mantenimiento_id ?? null)
        .input('detId',      sql.Int,          datos.detalle_mtto_pieza_id ?? null)
        // De dónde salió la pieza. Cuando se eligió una existencia concreta esa
        // manda; si no, se cae a la sucursal del vehículo, que es lo que se
        // guardaba antes de que el montaje moviera inventario.
        .input('sucId',      sql.Int,          datos.sucursal_id ?? null)
        .input('fecha',      sql.Date,         datos.fecha_instalacion ?? null)
        .input('km',         sql.Int,          datos.km_instalacion ?? null)
        .query(`
          INSERT INTO instalaciones_pieza
            (vehiculo_id, tipo_pieza_id, etiqueta, pieza_id, lote_id, sucursal_id,
             mantenimiento_id, detalle_mtto_pieza_id, fecha_instalacion, km_instalacion)
          VALUES
            (@vehiculoId, @tipoId, @etiqueta, @piezaId, @loteId,
             COALESCE(@sucId, ${SUCURSAL_DEL_VEHICULO}),
             @mttoId, @detId, @fecha, @km)`)

      // La pieza sale del almacén aquí y ahora: se descuenta. Si viene ligada a
      // un consumo de mantenimiento no se toca nada — ese renglón ya la
      // descontó, y hacerlo otra vez es contar dos veces la misma unidad.
      if (datos.detalle_mtto_pieza_id == null &&
          datos.lote_id != null && datos.sucursal_id != null) {
        await moverExistencia(tx, datos.lote_id, datos.sucursal_id, -1)
      }
    } else {
      // Misma pieza: es una corrección de datos, no un cambio. Solo se pisan
      // los campos que vinieron; los que no, se quedan como estaban.
      await tx.request()
        .input('vehiculoId', sql.Int,  vehiculoId)
        .input('tipoId',     sql.Int,  tipoId)
        .input('etiqueta',   sql.NVarChar(40), etiqueta)
        .input('loteId',     sql.Int,  datos.lote_id ?? null)
        .input('mttoId',     sql.Int,  datos.mantenimiento_id ?? null)
        .input('detId',      sql.Int,  datos.detalle_mtto_pieza_id ?? null)
        .input('fecha',      sql.Date, datos.fecha_instalacion ?? null)
        .input('km',         sql.Int,  datos.km_instalacion ?? null)
        .query(`
          UPDATE instalaciones_pieza SET
            lote_id               = COALESCE(@loteId, lote_id),
            mantenimiento_id      = COALESCE(@mttoId, mantenimiento_id),
            detalle_mtto_pieza_id = COALESCE(@detId,  detalle_mtto_pieza_id),
            fecha_instalacion     = COALESCE(@fecha,  fecha_instalacion),
            km_instalacion        = COALESCE(@km,     km_instalacion)
          WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId
            AND etiqueta = @etiqueta
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

// Cierra el renglón vigente de (vehículo, tipo, etiqueta). El índice único
// filtrado garantiza que hay a lo sumo uno. Sin fecha explícita se usa la de hoy
// en México, no la del server: en UTC ya es mañana desde las 18:00.
async function cerrarRenglon(
  tx: sql.Transaction, vehiculoId: number, tipoId: number, etiqueta: string,
  datos: DatosRetiro,
): Promise<void> {
  await tx.request()
    .input('vehiculoId', sql.Int,          vehiculoId)
    .input('tipoId',     sql.Int,          tipoId)
    .input('etiqueta',   sql.NVarChar(40), etiqueta)
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
        AND etiqueta = @etiqueta
        AND fecha_retiro IS NULL`)
}

export interface InstalacionHistorial {
  id:                number
  tipo_pieza_id:     number
  tipo_nombre:       string
  etiqueta:          string
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
  // Cuando no es null, esta pieza se descontó del almacén como consumo del
  // mantenimiento y el montaje solo se colgó de ese renglón.
  detalle_mtto_pieza_id: number | null
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
        i.id, i.tipo_pieza_id, t.nombre AS tipo_nombre, i.etiqueta,
        i.pieza_id, p.numero_serie, p.descripcion,
        i.lote_id, l.num_factura, pr.nombre AS proveedor,
        l.costo_unitario, l.fecha_compra,
        s.nombre AS sucursal,
        i.mantenimiento_id, i.detalle_mtto_pieza_id,
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
  vehiculoId: number, tipoId: number, etiqueta: string, datos: DatosRetiro = {},
): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const r = await tx.request()
      .input('vehiculoId', sql.Int, vehiculoId)
      .input('tipoId',     sql.Int, tipoId)
      .input('etiqueta',   sql.NVarChar(40), etiqueta)
      .query(`
        DELETE FROM piezas_vehiculo
        OUTPUT DELETED.id
        WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId
          AND etiqueta = @etiqueta`)
    const habia = r.recordset.length > 0
    if (habia) {
      // Antes de cerrarlo hay que leer de dónde salió: el renglón cerrado sigue
      // ahí, pero la devolución necesita el par (lote, sucursal) y es más claro
      // resolverlo en un solo lugar.
      const origen = await tx.request()
        .input('vehiculoId', sql.Int, vehiculoId)
        .input('tipoId',     sql.Int, tipoId)
        .input('etiqueta',   sql.NVarChar(40), etiqueta)
        .query(`
          SELECT lote_id, sucursal_id FROM instalaciones_pieza
          WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId
            AND etiqueta = @etiqueta AND fecha_retiro IS NULL`)
      const fila = origen.recordset[0]

      await cerrarRenglon(tx, vehiculoId, tipoId, etiqueta, datos)

      // La pieza vuelve al almacén: se devuelve al lote y a la sucursal de los
      // que salió. Vale igual si el montaje la descontó o si la descontó el
      // consumo del mantenimiento — en los dos casos la unidad ya no estaba
      // contada, y ahora está de vuelta en el estante.
      //
      // Los demás destinos (desecho, venta, devolución al proveedor) no
      // devuelven nada: la pieza no regresa al inventario.
      if (datos.destino === 'stock' && fila?.lote_id != null && fila?.sucursal_id != null) {
        await moverExistencia(tx, fila.lote_id, fila.sucursal_id, 1)
      }
    }
    await tx.commit()
    return habia
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// ---------------------------------------------------------------------------
// Consumos de mantenimiento pendientes de montar (migración 008)
// ---------------------------------------------------------------------------

// La sucursal de la que salió un consumo. Los anteriores al inventario por
// sucursal la tienen en NULL; para ellos vale la de recepción del lote, que es
// donde la migración 002 puso todo el stock. Es la misma regla que usa
// `detalleMttoPiezaRepo`, y tiene que serlo: si aquí se devolviera una sucursal
// distinta, la liga apuntaría a una existencia que nunca se movió.
const SUCURSAL_DEL_CONSUMO = 'COALESCE(d.sucursal_id, l.sucursal_id)'

// Cuántas piezas de un consumo ya se colgaron de él. Un consumo de 4 balatas
// respalda 4 montajes, no uno.
const YA_MONTADAS = `
  (SELECT COUNT(*) FROM instalaciones_pieza ip
   WHERE ip.detalle_mtto_pieza_id = d.id)`

export interface ConsumoSinMontar {
  id:                  number
  mantenimiento_id:    number
  fecha_mantenimiento: string
  tipo_mantenimiento:  string | null
  lote_id:             number
  sucursal_id:         number | null
  sucursal:            string | null
  costo_unitario:      number
  num_factura:         string | null
  proveedor:           string | null
  fecha_compra:        string | null
  cantidad:            number
  /** De ese consumo, cuántas piezas siguen sin montarse en ninguna unidad. */
  sin_montar:          number
}

// Piezas de esta refacción que ya se descontaron del almacén en un
// mantenimiento DE ESTE VEHÍCULO y que todavía no se han montado. Son las
// candidatas a ligar: montarlas no debe volver a descontar.
//
// Se limita al vehículo del mantenimiento a propósito. Una pieza consumida en
// el mantenimiento de otra unidad no tiene por qué aparecer aquí: si de verdad
// terminó en esta, lo que está mal es el consumo, y corregirlo allá es lo
// honesto.
export async function findConsumosSinMontar(
  vehiculoId: number, piezaId: number,
): Promise<ConsumoSinMontar[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('piezaId',    sql.Int, piezaId)
    .query(`
      SELECT d.id, d.mantenimiento_id, m.fecha AS fecha_mantenimiento,
             m.tipo AS tipo_mantenimiento,
             d.lote_id, ${SUCURSAL_DEL_CONSUMO} AS sucursal_id,
             s.nombre AS sucursal, d.costo_unitario,
             l.num_factura, pr.nombre AS proveedor, l.fecha_compra,
             d.cantidad, d.cantidad - ${YA_MONTADAS} AS sin_montar
      FROM detalle_mtto_pieza d
      JOIN mantenimiento m     ON m.id  = d.mantenimiento_id
      JOIN lotes_pieza l       ON l.id  = d.lote_id
      LEFT JOIN proveedores pr ON pr.id = l.proveedor_id
      LEFT JOIN sucursales s   ON s.id  = ${SUCURSAL_DEL_CONSUMO}
      WHERE m.vehiculo_id = @vehiculoId
        AND l.pieza_id    = @piezaId
        AND d.cantidad - ${YA_MONTADAS} > 0
      ORDER BY m.fecha DESC, d.id DESC`)
  return r.recordset
}

// Lo necesario para validar una liga: de qué refacción y de qué vehículo es el
// consumo, y si le queda cupo. Null si el renglón no existe.
export async function findConsumoParaLigar(detalleId: number): Promise<{
  pieza_id: number; lote_id: number; sucursal_id: number | null
  vehiculo_id: number; mantenimiento_id: number
  cantidad: number; ya_montadas: number
} | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, detalleId)
    .query(`
      SELECT l.pieza_id, d.lote_id, ${SUCURSAL_DEL_CONSUMO} AS sucursal_id,
             m.vehiculo_id, d.mantenimiento_id,
             d.cantidad, ${YA_MONTADAS} AS ya_montadas
      FROM detalle_mtto_pieza d
      JOIN mantenimiento m ON m.id = d.mantenimiento_id
      JOIN lotes_pieza l   ON l.id = d.lote_id
      WHERE d.id = @id`)
  return r.recordset[0] ?? null
}

// Cuántas piezas montadas dependen de este consumo. Se pregunta antes de
// borrarlo: el borrado devuelve stock al almacén, y hacerlo con la pieza aún
// puesta en el carro la dejaría contada en los dos lados.
export async function countMontadasDeConsumo(detalleId: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, detalleId)
    .query(`SELECT COUNT(*) AS n FROM instalaciones_pieza WHERE detalle_mtto_pieza_id = @id`)
  return r.recordset[0]?.n ?? 0
}

// Lo que queda de un lote en una sucursal. El montaje lo pregunta antes de
// descontar para poder fallar con un mensaje entendible en vez de reventar
// contra el CHECK que impide existencias negativas.
export async function disponibleDeLoteEnSucursal(
  loteId: number, sucursalId: number,
): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('lid', sql.Int, loteId)
    .input('suc', sql.Int, sucursalId)
    .query(`
      SELECT COALESCE((SELECT ex.cantidad FROM existencias_lote ex
                       WHERE ex.lote_id = @lid AND ex.sucursal_id = @suc), 0) AS n`)
  return r.recordset[0]?.n ?? 0
}

// Qué refacción trae ahora mismo ese renglón, o null si está vacío. Se usa para
// distinguir un montaje real de una corrección de datos sobre la pieza que ya
// estaba puesta: solo el primero mueve inventario.
export async function piezaVigente(
  vehiculoId: number, tipoId: number, etiqueta: string,
): Promise<number | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vehiculoId', sql.Int, vehiculoId)
    .input('tipoId',     sql.Int, tipoId)
    .input('etiqueta',   sql.NVarChar(40), etiqueta)
    .query(`
      SELECT pieza_id FROM piezas_vehiculo
      WHERE vehiculo_id = @vehiculoId AND tipo_pieza_id = @tipoId
        AND etiqueta = @etiqueta`)
  return r.recordset[0]?.pieza_id ?? null
}
