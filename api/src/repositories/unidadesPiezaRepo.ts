import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Piezas físicas identificadas una por una. Solo existen para los tipos con
// `rastreo_individual` (migración 025); lo que se cuenta a granel no las tiene.
//
// Lo que la tabla guarda es poco a propósito: de qué refacción es, de qué compra
// salió, en qué estante vive y qué folio físico trae. Todo lo demás —si está
// montada, si es nueva o usada, cuántos kilómetros lleva— sale de
// `instalaciones_pieza` y se calcula aquí. Ver la cabecera de la migración 027:
// guardarlo obligaría a mantenerlo en cada montaje y cada retiro, y basta que
// uno falle para que la unidad mienta.

export type EstadoUnidad =
  | 'almacen'     // en el estante, lista para usarse
  | 'montada'     // puesta en un vehículo ahora mismo
  | 'desechada'
  | 'vendida'
  | 'devuelta'    // regresó al proveedor
  | 'reacondicionar'

export interface UnidadPieza {
  id: number
  pieza_id: number
  numero_serie: string
  descripcion: string
  lote_id: number | null
  /** El folio de la compra de la que salió. `null` si no salió de ninguna. */
  num_factura: string | null
  proveedor: string | null
  costo_unitario: number | null
  sucursal_id: number | null
  sucursal: string | null
  etiqueta: string | null
  /** Derivado de sus instalaciones. Ver `ESTADO`. */
  estado: EstadoUnidad
  /** Derivada: usada en cuanto tiene un montaje cerrado a sus espaldas. */
  condicion: 'nueva' | 'usada'
  /** El vehículo donde está puesta ahora, si lo está. */
  vehiculo_id: number | null
  vehiculo: string | null
  /** Desde cuándo lleva puesta la instalación vigente. */
  desde: string | null
  /** Cuántas veces se ha montado. */
  montajes: number
  /**
   * Kilómetros acumulados: la suma de sus tramos cerrados más lo que lleve
   * recorrido el vehículo donde esté ahora. `null` si nunca se ha montado o si
   * no se capturaron los kilometrajes.
   */
  km_recorridos: number | null
}

// El estado sale del último renglón de la bitácora de esa unidad:
//
//   instalación abierta        -> montada.
//   cerrada, con destino       -> donde acabó.
//   cerrada, sin destino       -> nadie dijo a dónde fue; se asume el estante,
//                                 que es lo que pasa cuando se cambia una pieza
//                                 y no se captura el destino.
//   sin instalaciones          -> nunca se ha usado: está en el estante.
const ESTADO = `
  CASE
    WHEN ult.id IS NULL                THEN 'almacen'
    WHEN ult.fecha_retiro IS NULL      THEN 'montada'
    WHEN ult.destino = 'desecho'       THEN 'desechada'
    WHEN ult.destino = 'venta'         THEN 'vendida'
    WHEN ult.destino = 'devolucion_proveedor' THEN 'devuelta'
    WHEN ult.destino = 'reacondicionar'       THEN 'reacondicionar'
    ELSE 'almacen'
  END`

// Los kilómetros de los tramos ya cerrados. Los que no capturaron kilometraje
// no suman: es preferible quedarse corto que inventar.
const KM_CERRADOS = `
  (SELECT COALESCE(SUM(i.km_retiro - i.km_instalacion), 0)
   FROM instalaciones_pieza i
   WHERE i.unidad_id = u.id
     AND i.km_retiro IS NOT NULL AND i.km_instalacion IS NOT NULL)`

// Lo que la unidad lleva recorrido en el vehículo donde está puesta ahora. El
// odómetro vive en la tabla hija según el tipo de vehículo.
const KM_ABIERTO = `
  (SELECT COALESCE(
     CASE WHEN veh.tipo = 'camion'       THEN c.kilometraje
          WHEN veh.tipo = 'tractocamion' THEN t.kilometraje
          WHEN veh.tipo = 'utilitario'   THEN utl.kilometraje END
     - ult.km_instalacion, 0)
   FROM vehiculos veh
   LEFT JOIN camiones      c   ON c.vehiculo_id   = veh.id
   LEFT JOIN tractocamiones t  ON t.vehiculo_id   = veh.id
   LEFT JOIN vehiculos_utilitarios utl ON utl.vehiculo_id = veh.id
   WHERE veh.id = ult.vehiculo_id AND ult.fecha_retiro IS NULL
     AND ult.km_instalacion IS NOT NULL)`

const SELECT_UNIDAD = `
  SELECT u.id, u.pieza_id, p.numero_serie, p.descripcion,
         u.lote_id, fac.folio AS num_factura, pr.nombre AS proveedor,
         l.costo_unitario,
         u.sucursal_id, s.nombre AS sucursal, u.etiqueta,
         ${ESTADO} AS estado,
         CASE WHEN EXISTS (
                SELECT 1 FROM instalaciones_pieza i
                WHERE i.unidad_id = u.id AND i.fecha_retiro IS NOT NULL)
              THEN 'usada' ELSE 'nueva' END AS condicion,
         CASE WHEN ult.fecha_retiro IS NULL THEN ult.vehiculo_id END AS vehiculo_id,
         CASE WHEN ult.fecha_retiro IS NULL
              THEN COALESCE(NULLIF(v.placas, ''), v.numero_serie) END AS vehiculo,
         CASE WHEN ult.fecha_retiro IS NULL
              THEN CONVERT(char(10), ult.fecha_instalacion, 23) END AS desde,
         (SELECT COUNT(*) FROM instalaciones_pieza i WHERE i.unidad_id = u.id) AS montajes,
         CASE WHEN EXISTS (SELECT 1 FROM instalaciones_pieza i WHERE i.unidad_id = u.id)
              THEN ${KM_CERRADOS} + COALESCE(${KM_ABIERTO}, 0) END AS km_recorridos
  FROM unidades_pieza u
  JOIN piezas p            ON p.id = u.pieza_id
  LEFT JOIN lotes_pieza l  ON l.id = u.lote_id
  LEFT JOIN facturas fac   ON fac.id = l.factura_id
  LEFT JOIN proveedores pr ON pr.id = fac.proveedor_id
  LEFT JOIN sucursales s   ON s.id = u.sucursal_id
  -- El último renglón de su bitácora: es de donde salen el estado y el vehículo.
  OUTER APPLY (
    SELECT TOP 1 i.id, i.vehiculo_id, i.fecha_instalacion, i.fecha_retiro,
           i.km_instalacion, i.destino
    FROM instalaciones_pieza i
    WHERE i.unidad_id = u.id
    ORDER BY i.fecha_instalacion DESC, i.id DESC
  ) ult
  LEFT JOIN vehiculos v ON v.id = ult.vehiculo_id`

/** Las unidades de una refacción, con su estado y su vida útil. */
export async function findByPieza(piezaId: number): Promise<UnidadPieza[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('piezaId', sql.Int, piezaId)
    .query(`${SELECT_UNIDAD} WHERE u.pieza_id = @piezaId ORDER BY u.id`)
  return r.recordset
}

/**
 * Da de alta N unidades de una compra, dentro de su transacción.
 *
 * Se llama solo si el tipo de la refacción tiene rastreo individual. Va en la
 * misma transacción que el lote y su existencia: unidades sin existencia (o al
 * revés) es justo la divergencia que hay que evitar mientras las dos capas
 * convivan.
 */
export async function crearDeCompra(
  tx: sql.Transaction, piezaId: number, loteId: number,
  sucursalId: number | null, cuantas: number, etiquetas: (string | null)[] = [],
): Promise<void> {
  if (cuantas < 1) return

  // Con identificadores capturados hay que ir una por una: cada fila lleva el
  // suyo. Son pocas —lo que se rastrea llega de cuatro en cuatro, no de mil—, y
  // etiquetar es justo el momento en que alguien está mirando cada pieza.
  if (etiquetas.some((e) => e)) {
    for (let i = 0; i < cuantas; i++) {
      await tx.request()
        .input('piezaId', sql.Int, piezaId)
        .input('loteId',  sql.Int, loteId)
        .input('suc',     sql.Int, sucursalId)
        .input('et',      sql.NVarChar(40), etiquetas[i] || null)
        .query(`
          INSERT INTO unidades_pieza (pieza_id, lote_id, sucursal_id, etiqueta)
          VALUES (@piezaId, @loteId, @suc, @et)`)
    }
    return
  }

  // Sin identificadores, todas las filas son iguales y entran de un golpe. El
  // generador evita mandar N INSERT por separado.
  await tx.request()
    .input('piezaId', sql.Int, piezaId)
    .input('loteId',  sql.Int, loteId)
    .input('suc',     sql.Int, sucursalId)
    .input('n',       sql.Int, cuantas)
    .query(`
      WITH numeros AS (
        SELECT TOP (@n) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
        FROM sys.all_objects
      )
      INSERT INTO unidades_pieza (pieza_id, lote_id, sucursal_id)
      SELECT @piezaId, @loteId, @suc FROM numeros`)
}

/**
 * Da identidad al stock que ya estaba en el estante cuando se encendió el
 * rastreo de su tipo.
 *
 * Es el hueco que la migración 025 dejó anotado: encender el flag no hace
 * aparecer unidades para lo que ya se había comprado, así que esas piezas
 * existen en la existencia pero no se pueden identificar. Esto crea las que
 * faltan, por (lote, sucursal), hasta igualar lo que dice el inventario — que es
 * exactamente la diferencia que reporta `contarPorSucursal`.
 *
 * Nacen sin etiqueta: nadie sabe cuál es cuál hasta que alguien vaya al estante
 * y las rotule. Eso es correcto y es el punto — primero existen, luego se
 * identifican.
 *
 * Es idempotente: si ya cuadran, no crea nada.
 */
export async function generarFaltantes(piezaId: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('piezaId', sql.Int, piezaId)
    .query(`
      WITH stock AS (
        SELECT ex.lote_id, ex.sucursal_id, SUM(ex.cantidad) AS cantidad
        FROM existencias_lote ex
        JOIN lotes_pieza l ON l.id = ex.lote_id
        WHERE l.pieza_id = @piezaId AND ex.cantidad > 0
        GROUP BY ex.lote_id, ex.sucursal_id
      ),
      libres AS (
        SELECT u.lote_id, u.sucursal_id, COUNT(*) AS n
        FROM unidades_pieza u
        WHERE u.pieza_id = @piezaId
          AND NOT EXISTS (
            SELECT 1 FROM instalaciones_pieza i
            WHERE i.unidad_id = u.id AND i.fecha_retiro IS NULL)
        GROUP BY u.lote_id, u.sucursal_id
      ),
      faltan AS (
        SELECT st.lote_id, st.sucursal_id,
               st.cantidad - COALESCE(lb.n, 0) AS faltan
        FROM stock st
        LEFT JOIN libres lb
          ON lb.lote_id = st.lote_id
         AND (lb.sucursal_id = st.sucursal_id
              OR (lb.sucursal_id IS NULL AND st.sucursal_id IS NULL))
      ),
      numeros AS (
        SELECT TOP 1000 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
        FROM sys.all_objects
      )
      INSERT INTO unidades_pieza (pieza_id, lote_id, sucursal_id)
      SELECT @piezaId, f.lote_id, f.sucursal_id
      FROM faltan f
      JOIN numeros nm ON nm.n <= f.faltan
      WHERE f.faltan > 0`)
  return r.rowsAffected[0] ?? 0
}

/**
 * Una unidad disponible de esa refacción para montar, preferiendo la del lote
 * del que salió el consumo.
 *
 * "Disponible" es no tener una instalación abierta: si la tiene, está puesta en
 * un vehículo y montarla otra vez sería la misma pieza en dos lados. Devuelve
 * `null` si no hay ninguna libre, y entonces el montaje sigue adelante sin
 * unidad — el consumo es válido igual, y la ficha lo dirá.
 */
export async function tomarDisponible(
  tx: sql.Transaction, piezaId: number, loteId: number | null, sucursalId: number | null,
): Promise<number | null> {
  const r = await tx.request()
    .input('piezaId', sql.Int, piezaId)
    .input('loteId',  sql.Int, loteId)
    .input('suc',     sql.Int, sucursalId)
    .query(`
      SELECT TOP 1 u.id
      FROM unidades_pieza u
      WHERE u.pieza_id = @piezaId
        AND NOT EXISTS (
          SELECT 1 FROM instalaciones_pieza i
          WHERE i.unidad_id = u.id AND i.fecha_retiro IS NULL)
      -- La del lote y la sucursal del consumo primero: es la unidad que de
      -- verdad se descontó. Si no la hay, cualquiera libre de esa refacción.
      ORDER BY
        CASE WHEN @loteId IS NOT NULL AND u.lote_id = @loteId THEN 0 ELSE 1 END,
        CASE WHEN @suc    IS NOT NULL AND u.sucursal_id = @suc THEN 0 ELSE 1 END,
        u.id`)
  return r.recordset[0]?.id ?? null
}

/**
 * Mueve N unidades de un lote de una sucursal a otra, para acompañar un traspaso
 * de existencias.
 *
 * Sin esto, traspasar stock movía las piezas en `existencias_lote` y dejaba sus
 * unidades diciendo que siguen en el estante de origen. Solo se mueven las que
 * están libres: una unidad con instalación abierta está puesta en un vehículo y
 * no es parte del stock que se traspasa.
 *
 * Puede mover menos de las pedidas si no hay tantas libres —los tipos a granel
 * no tienen unidades en absoluto, y ahí mueve cero—. Eso no es un error: la
 * existencia es la que manda, y el descuadre lo reporta la comprobación de
 * `contarPorSucursal`.
 */
export async function moverEntreSucursales(
  tx: sql.Transaction, loteId: number, origenId: number, destinoId: number, cuantas: number,
): Promise<number> {
  const r = await tx.request()
    .input('lote',    sql.Int, loteId)
    .input('origen',  sql.Int, origenId)
    .input('destino', sql.Int, destinoId)
    .input('n',       sql.Int, cuantas)
    .query(`
      UPDATE u SET u.sucursal_id = @destino
      FROM unidades_pieza u
      JOIN (
        SELECT TOP (@n) up.id
        FROM unidades_pieza up
        WHERE up.lote_id = @lote AND up.sucursal_id = @origen
          AND NOT EXISTS (
            SELECT 1 FROM instalaciones_pieza i
            WHERE i.unidad_id = up.id AND i.fecha_retiro IS NULL)
        ORDER BY up.id
      ) elegidas ON elegidas.id = u.id`)
  return r.rowsAffected[0] ?? 0
}

/**
 * Cuántas unidades libres hay por (refacción, sucursal) frente a lo que dice la
 * existencia. Es la comprobación que las dos capas necesitan mientras convivan:
 * las unidades son identidad, `existencias_lote` es quien cuenta, y que
 * discrepen significa que algún movimiento tocó una y no la otra.
 */
export interface CuadreUnidades {
  pieza_id: number
  numero_serie: string
  descripcion: string
  sucursal_id: number | null
  sucursal: string | null
  /** Unidades libres —sin instalación abierta— en ese estante. */
  unidades: number
  /** Lo que dice `existencias_lote` para esa refacción en ese estante. */
  existencia: number
}

export async function contarPorSucursal(): Promise<CuadreUnidades[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    WITH libres AS (
      SELECT u.pieza_id, u.sucursal_id, COUNT(*) AS unidades
      FROM unidades_pieza u
      WHERE NOT EXISTS (
        SELECT 1 FROM instalaciones_pieza i
        WHERE i.unidad_id = u.id AND i.fecha_retiro IS NULL)
      GROUP BY u.pieza_id, u.sucursal_id
    ),
    stock AS (
      SELECT l.pieza_id, ex.sucursal_id, SUM(ex.cantidad) AS existencia
      FROM existencias_lote ex
      JOIN lotes_pieza l ON l.id = ex.lote_id
      GROUP BY l.pieza_id, ex.sucursal_id
    )
    SELECT COALESCE(lb.pieza_id, st.pieza_id)       AS pieza_id,
           p.numero_serie, p.descripcion,
           COALESCE(lb.sucursal_id, st.sucursal_id) AS sucursal_id,
           s.nombre AS sucursal,
           COALESCE(lb.unidades, 0)    AS unidades,
           COALESCE(st.existencia, 0)  AS existencia
    FROM libres lb
    FULL OUTER JOIN stock st
      ON st.pieza_id = lb.pieza_id
     AND (st.sucursal_id = lb.sucursal_id
          OR (st.sucursal_id IS NULL AND lb.sucursal_id IS NULL))
    JOIN piezas p           ON p.id = COALESCE(lb.pieza_id, st.pieza_id)
    JOIN tipos_pieza t      ON t.id = p.tipo_pieza_id
    LEFT JOIN sucursales s  ON s.id = COALESCE(lb.sucursal_id, st.sucursal_id)
    -- Solo los tipos rastreados: en los de granel no hay unidades que cuadrar y
    -- saldrían todos como si faltaran.
    WHERE t.rastreo_individual = 1
      AND COALESCE(lb.unidades, 0) <> COALESCE(st.existencia, 0)
    ORDER BY p.numero_serie, s.nombre`)
  return r.recordset
}

/** Dónde vive la unidad ahora. Se mueve al montarla y al devolverla al estante. */
export async function setSucursal(
  tx: sql.Transaction, unidadId: number, sucursalId: number | null,
): Promise<void> {
  await tx.request()
    .input('id',  sql.Int, unidadId)
    .input('suc', sql.Int, sucursalId)
    .query('UPDATE unidades_pieza SET sucursal_id = @suc WHERE id = @id')
}

/** El folio físico pegado a la pieza. Se corrige desde la ficha de la unidad. */
export async function setEtiqueta(unidadId: number, etiqueta: string | null): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',  sql.Int, unidadId)
    .input('et',  sql.NVarChar(40), etiqueta)
    .query('UPDATE unidades_pieza SET etiqueta = @et WHERE id = @id')
  return (r.rowsAffected[0] ?? 0) > 0
}

/** ¿La refacción es de un tipo que se rastrea una por una? */
export async function piezaEsRastreada(tx: sql.Transaction, piezaId: number): Promise<boolean> {
  const r = await tx.request()
    .input('id', sql.Int, piezaId)
    .query(`
      SELECT TOP 1 1 AS si
      FROM piezas p
      JOIN tipos_pieza t ON t.id = p.tipo_pieza_id
      WHERE p.id = @id AND t.rastreo_individual = 1`)
  return r.recordset.length > 0
}
