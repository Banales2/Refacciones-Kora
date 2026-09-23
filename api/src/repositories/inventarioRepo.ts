// Inventario por sucursal: qué hay en cada una, los traspasos entre ellas y los
// mínimos que cada una debe mantener.
//
// La existencia vive en `existencias_lote (lote_id, sucursal_id, cantidad)`.
// Que la llave incluya el lote es lo que permite saber de qué compra salió cada
// pieza de una sucursal — proveedor, factura y costo — sin llegar todavía a
// identificar la pieza una por una.
import * as sql from 'mssql'
import { folioDelLote, fechaDelLote, joinFactura, joinProveedorDelLote } from './facturaSql'
import * as unidadesRepo from './unidadesPiezaRepo'
import { getPool } from '../shared/db'
import { Alcance, SIN_ACOTAR, conAlcance } from '../shared/alcance'

export interface ExistenciaEnSucursal {
  lote_id:        number
  sucursal_id:    number
  sucursal:       string
  cantidad:       number
  pieza_id:       number
  numero_serie:   string
  descripcion:    string
  tipo_pieza_id:  number | null
  tipo_pieza:     string | null
  /** `null` en el lote de recuperación: no se le compró a nadie. */
  proveedor:      string | null
  num_factura:    string | null
  costo_unitario: number
  fecha_compra:   string
  /**
   * Cuántas piezas de este lote salieron de esta sucursal en un traspaso que
   * nadie ha aceptado todavía. Ya no están en `cantidad` —salieron del estante
   * al enviarse, migración 035— y por eso hay que decirlo: si no, una caja que
   * va en camino se ve igual que una que se esfumó.
   */
  en_camino:      number
}

/**
 * Qué hay en una sucursal, renglón por lote. Sin sucursal, toda la flota.
 *
 * Un renglón puede tener `cantidad` en cero y aun así aparecer, si todo lo que
 * había salió en un traspaso sin aceptar. Es justo el caso en el que la pieza
 * desaparecería de la pantalla sin explicación, que es lo que este renglón
 * existe para evitar.
 */
export async function findExistencias(sucursalId?: number): Promise<ExistenciaEnSucursal[]> {
  const pool = await getPool()
  const req = pool.request()
  let where = 'WHERE (ex.cantidad > 0 OR cam.en_camino > 0)'
  if (sucursalId !== undefined) {
    req.input('suc', sql.Int, sucursalId)
    where += ' AND ex.sucursal_id = @suc'
  }
  const r = await req.query(`
    SELECT ex.lote_id, ex.sucursal_id, s.nombre AS sucursal, ex.cantidad,
           p.id AS pieza_id, p.numero_serie, p.descripcion,
           p.tipo_pieza_id, t.nombre AS tipo_pieza,
           pr.nombre AS proveedor, l.costo_unitario,
           ${folioDelLote()} AS num_factura,
           ${fechaDelLote()} AS fecha_compra,
           cam.en_camino
    FROM existencias_lote ex
    JOIN sucursales s      ON s.id  = ex.sucursal_id
    JOIN lotes_pieza l     ON l.id  = ex.lote_id
    JOIN piezas p          ON p.id  = l.pieza_id
    ${joinFactura()}
    -- LEFT: el lote de recuperación va sin factura ni proveedor (024 y 026) y
    -- aquí tiene que aparecer — es stock real en el estante.
    ${joinProveedorDelLote()}
    LEFT JOIN tipos_pieza t ON t.id = p.tipo_pieza_id
    -- Lo que salió de este estante y sigue sin aceptarse en el otro. Va como
    -- APPLY y no como subconsulta repetida porque se usa dos veces: en el
    -- SELECT y en el filtro que deja pasar los renglones que quedaron en cero.
    OUTER APPLY (
      SELECT COALESCE(SUM(tr.cantidad), 0) AS en_camino
      FROM traspasos_pieza tr
      WHERE tr.estado = 'pendiente'
        AND tr.lote_id = ex.lote_id
        AND tr.origen_sucursal_id = ex.sucursal_id
    ) cam
    ${where}
    ORDER BY s.nombre, p.numero_serie, ${fechaDelLote()}`)
  return r.recordset
}

/** Total por refacción en una sucursal, sin desglosar el lote. */
export async function findResumen(sucursalId: number): Promise<{
  pieza_id: number; numero_serie: string; descripcion: string
  tipo_pieza: string | null; cantidad: number
}[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('suc', sql.Int, sucursalId)
    .query(`
      SELECT p.id AS pieza_id, p.numero_serie, p.descripcion,
             t.nombre AS tipo_pieza, SUM(ex.cantidad) AS cantidad
      FROM existencias_lote ex
      JOIN lotes_pieza l      ON l.id = ex.lote_id
      JOIN piezas p           ON p.id = l.pieza_id
      LEFT JOIN tipos_pieza t ON t.id = p.tipo_pieza_id
      WHERE ex.sucursal_id = @suc AND ex.cantidad > 0
      GROUP BY p.id, p.numero_serie, p.descripcion, t.nombre
      ORDER BY p.numero_serie`)
  return r.recordset
}

// ---------------------------------------------------------------------------
// Traspasos
// ---------------------------------------------------------------------------

export type EstadoTraspaso = 'pendiente' | 'aceptado' | 'rechazado' | 'cancelado'

export interface Traspaso {
  id:                  number
  lote_id:             number
  origen_sucursal_id:  number
  origen:              string
  destino_sucursal_id: number
  destino:             string
  cantidad:            number
  fecha:               string
  // Quien lo capturó (la cuenta de la sesión) y quien dio el visto bueno para
  // mover la mercancía. El segundo es texto libre: rara vez tiene cuenta. NULL
  // solo en los traspasos anteriores a la migración 034.
  usuario_email:       string | null
  autorizado_por:      string | null
  // Un traspaso nace 'pendiente' y lo resuelve el destino aceptándolo o
  // rechazándolo, o el origen cancelándolo (migración 035). Mientras siga
  // pendiente, su mercancía no está en ninguna sucursal.
  estado:              EstadoTraspaso
  resuelto_por:        string | null
  resuelto_en:         string | null
  motivo_resolucion:   string | null
  observaciones:       string | null
  pieza_id:            number
  numero_serie:        string
  descripcion:         string
}

const SELECT_TRASPASO = `
  SELECT tr.id, tr.lote_id, tr.origen_sucursal_id, so.nombre AS origen,
         tr.destino_sucursal_id, sd.nombre AS destino,
         tr.cantidad, tr.fecha, tr.usuario_email, tr.autorizado_por,
         tr.estado, tr.resuelto_por,
         CONVERT(varchar(19), tr.resuelto_en, 126) AS resuelto_en,
         tr.motivo_resolucion, tr.observaciones,
         p.id AS pieza_id, p.numero_serie, p.descripcion
  FROM traspasos_pieza tr
  JOIN sucursales so ON so.id = tr.origen_sucursal_id
  JOIN sucursales sd ON sd.id = tr.destino_sucursal_id
  JOIN lotes_pieza l ON l.id = tr.lote_id
  JOIN piezas p      ON p.id = l.pieza_id
`

export async function findTraspasos(sucursalId?: number): Promise<Traspaso[]> {
  const pool = await getPool()
  const req = pool.request()
  let where = ''
  if (sucursalId !== undefined) {
    req.input('suc', sql.Int, sucursalId)
    // Las dos puntas: para una sucursal importa tanto lo que recibió como lo
    // que entregó.
    where = 'WHERE tr.origen_sucursal_id = @suc OR tr.destino_sucursal_id = @suc'
  }
  // Los pendientes arriba: son los únicos sobre los que hay algo que hacer, y
  // se pierden si quedan mezclados por fecha entre el historial ya resuelto.
  const r = await req.query(`
    ${SELECT_TRASPASO} ${where}
    ORDER BY CASE WHEN tr.estado = 'pendiente' THEN 0 ELSE 1 END,
             tr.fecha DESC, tr.id DESC`)
  return r.recordset
}

export async function findTraspasoById(id: number): Promise<Traspaso | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_TRASPASO} WHERE tr.id = @id`)
  return r.recordset[0] ?? null
}

// Quienes ya han autorizado un traspaso, para ofrecerlos en el formulario. No
// hay catálogo de jefes de almacén: el nombre es texto libre y las repeticiones
// salen de lo ya capturado, igual que los reportadores de incidencias.
export async function findAutorizadores(alcance: Alcance = SIN_ACOTAR): Promise<string[]> {
  const pool = await getPool()
  // Acotado: sólo los traspasos que salieron de su sucursal o llegaron a ella.
  const r = await conAlcance(pool.request(), alcance).query(`
    SELECT DISTINCT autorizado_por FROM traspasos_pieza
    WHERE autorizado_por IS NOT NULL AND LTRIM(RTRIM(autorizado_por)) <> ''
      AND (@alcance IS NULL OR @alcance IN (origen_sucursal_id, destino_sucursal_id))
    ORDER BY autorizado_por
  `)
  return r.recordset.map((row: { autorizado_por: string }) => row.autorizado_por)
}

/** Existencia de un lote en una sucursal. 0 si no hay fila. */
export async function getExistencia(loteId: number, sucursalId: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('lid', sql.Int, loteId)
    .input('suc', sql.Int, sucursalId)
    .query('SELECT cantidad FROM existencias_lote WHERE lote_id=@lid AND sucursal_id=@suc')
  return r.recordset[0]?.cantidad ?? 0
}

export interface TraspasoCreate {
  lote_id:             number
  origen_sucursal_id:  number
  destino_sucursal_id: number
  cantidad:            number
  fecha:               string
  autorizado_por:      string
  observaciones?:      string | null
}

// Enviar es la primera mitad del traspaso: la mercancía sale del origen y se
// queda en camino —sin estante— hasta que el destino la acepte (migración 035).
// Restar la existencia, reservar las unidades y registrar el traspaso van en la
// misma transacción: a medias, el inventario pierde o inventa piezas. El CHECK
// de cantidad >= 0 es la red por si la validación previa se quedó corta por una
// captura concurrente.
export async function createTraspaso(data: TraspasoCreate, usuarioEmail: string): Promise<Traspaso> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request()
      .input('lid',  sql.Int, data.lote_id)
      .input('suc',  sql.Int, data.origen_sucursal_id)
      .input('cant', sql.Int, data.cantidad)
      .query(`
        UPDATE existencias_lote SET cantidad = cantidad - @cant
        WHERE lote_id = @lid AND sucursal_id = @suc`)

    const ins = await tx.request()
      .input('lid',    sql.Int,           data.lote_id)
      .input('origen', sql.Int,           data.origen_sucursal_id)
      .input('dest',   sql.Int,           data.destino_sucursal_id)
      .input('cant',   sql.Int,           data.cantidad)
      .input('fecha',  sql.Date,          data.fecha)
      .input('user',   sql.NVarChar(255), usuarioEmail)
      .input('autoriza', sql.NVarChar(120), data.autorizado_por)
      .input('obs',    sql.NVarChar(300), data.observaciones ?? null)
      .query(`
        INSERT INTO traspasos_pieza
          (lote_id, origen_sucursal_id, destino_sucursal_id, cantidad, fecha,
           usuario_email, autorizado_por, estado, observaciones)
        OUTPUT INSERTED.id
        VALUES (@lid, @origen, @dest, @cant, @fecha, @user, @autoriza, 'pendiente', @obs)`)

    const traspasoId: number = ins.recordset[0].id

    // Las piezas identificadas van con su stock, pero reservadas y no movidas:
    // su sucursal sigue siendo la de origen hasta que alguien acepte. Así,
    // rechazar es no hacer nada con ellas. En los tipos a granel no hay unidades
    // y no reserva ninguna.
    await unidadesRepo.reservarParaTraspaso(
      tx, traspasoId, data.lote_id, data.origen_sucursal_id, data.cantidad,
    )

    await tx.commit()
    return (await findTraspasoById(traspasoId))!
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * La segunda mitad. `aceptado` mete la mercancía al estante del destino;
 * `rechazado` y `cancelado` la devuelven al del origen. En los tres casos las
 * unidades reservadas dejan de estar en camino.
 *
 * El cambio de estado va como UPDATE condicionado a que siga pendiente, y si no
 * mueve ningún renglón la transacción se deshace: es lo que impide que dos
 * personas acepten el mismo traspaso a la vez y la mercancía entre dos veces.
 * Devuelve null si el traspaso ya no estaba pendiente.
 */
export async function resolverTraspaso(
  id: number, estado: Exclude<EstadoTraspaso, 'pendiente'>,
  usuarioEmail: string, motivo: string | null,
): Promise<Traspaso | null> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const cambio = await tx.request()
      .input('id',     sql.Int,           id)
      .input('estado', sql.NVarChar(20),  estado)
      .input('user',   sql.NVarChar(255), usuarioEmail)
      .input('motivo', sql.NVarChar(300), motivo)
      .query(`
        UPDATE traspasos_pieza
        SET estado = @estado, resuelto_por = @user, resuelto_en = SYSDATETIME(),
            motivo_resolucion = @motivo
        OUTPUT INSERTED.lote_id, INSERTED.origen_sucursal_id,
               INSERTED.destino_sucursal_id, INSERTED.cantidad
        WHERE id = @id AND estado = 'pendiente'`)

    const t = cambio.recordset[0]
    if (!t) {
      await tx.rollback()
      return null
    }

    // A dónde va la mercancía: al destino si la aceptaron, de vuelta al origen
    // si no. Es la única diferencia entre los tres desenlaces.
    const sucursalDestino = estado === 'aceptado'
      ? t.destino_sucursal_id
      : t.origen_sucursal_id

    await tx.request()
      .input('lid',  sql.Int, t.lote_id)
      .input('suc',  sql.Int, sucursalDestino)
      .input('cant', sql.Int, t.cantidad)
      .query(`
        UPDATE existencias_lote SET cantidad = cantidad + @cant
        WHERE lote_id = @lid AND sucursal_id = @suc;

        IF @@ROWCOUNT = 0
          INSERT INTO existencias_lote (lote_id, sucursal_id, cantidad)
          VALUES (@lid, @suc, @cant);`)

    if (estado === 'aceptado') {
      await unidadesRepo.confirmarTraspaso(tx, id, t.destino_sucursal_id)
    } else {
      await unidadesRepo.liberarTraspaso(tx, id)
    }

    await tx.commit()
    return await findTraspasoById(id)
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// ---------------------------------------------------------------------------
// Mínimos por sucursal
// ---------------------------------------------------------------------------

export interface MinimoSucursal {
  id:            number
  sucursal_id:   number
  sucursal:      string
  pieza_id:      number
  numero_serie:  string
  descripcion:   string
  tipo_pieza:    string | null
  minimo:        number
  observaciones: string | null
  /** Lo que hay hoy en esa sucursal, para comparar contra el mínimo. */
  existencia:    number
}

const SELECT_MINIMO = `
  SELECT m.id, m.sucursal_id, s.nombre AS sucursal,
         m.pieza_id, p.numero_serie, p.descripcion, t.nombre AS tipo_pieza,
         m.minimo, m.observaciones,
         COALESCE((SELECT SUM(ex.cantidad)
                   FROM existencias_lote ex
                   JOIN lotes_pieza l ON l.id = ex.lote_id
                   WHERE l.pieza_id = m.pieza_id AND ex.sucursal_id = m.sucursal_id), 0) AS existencia
  FROM minimos_sucursal m
  JOIN sucursales s       ON s.id = m.sucursal_id
  JOIN piezas p           ON p.id = m.pieza_id
  LEFT JOIN tipos_pieza t ON t.id = p.tipo_pieza_id
`

export async function findMinimos(sucursalId?: number): Promise<MinimoSucursal[]> {
  const pool = await getPool()
  const req = pool.request()
  let where = ''
  if (sucursalId !== undefined) {
    req.input('suc', sql.Int, sucursalId)
    where = 'WHERE m.sucursal_id = @suc'
  }
  const r = await req.query(`${SELECT_MINIMO} ${where} ORDER BY s.nombre, p.numero_serie`)
  return r.recordset
}

export async function findMinimoById(id: number): Promise<MinimoSucursal | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_MINIMO} WHERE m.id = @id`)
  return r.recordset[0] ?? null
}

/** Solo los que están por debajo: es la lista que hay que salir a surtir. */
export async function findFaltantes(sucursalId?: number): Promise<MinimoSucursal[]> {
  const todos = await findMinimos(sucursalId)
  return todos.filter((m) => m.existencia < m.minimo)
}

export async function createMinimo(
  sucursalId: number, piezaId: number, minimo: number, observaciones?: string | null,
): Promise<MinimoSucursal> {
  const pool = await getPool()
  const r = await pool.request()
    .input('suc', sql.Int,           sucursalId)
    .input('pza', sql.Int,           piezaId)
    .input('min', sql.Int,           minimo)
    .input('obs', sql.NVarChar(300), observaciones ?? null)
    .query(`
      INSERT INTO minimos_sucursal (sucursal_id, pieza_id, minimo, observaciones)
      OUTPUT INSERTED.id
      VALUES (@suc, @pza, @min, @obs)`)
  return (await findMinimoById(r.recordset[0].id))!
}

export async function updateMinimo(
  id: number, minimo?: number, observaciones?: string | null,
): Promise<MinimoSucursal | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (minimo !== undefined)        { req.input('min', sql.Int, minimo); sets.push('minimo=@min') }
  if (observaciones !== undefined) { req.input('obs', sql.NVarChar(300), observaciones ?? null); sets.push('observaciones=@obs') }
  if (sets.length === 0) return findMinimoById(id)

  const r = await req.query(`UPDATE minimos_sucursal SET ${sets.join(',')} OUTPUT INSERTED.id WHERE id=@id`)
  if (r.recordset.length === 0) return null
  return findMinimoById(id)
}

export async function removeMinimo(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM minimos_sucursal OUTPUT DELETED.id WHERE id=@id')
  return r.recordset.length > 0
}

/** ¿Ya hay un mínimo para esta refacción en esta sucursal? Solo puede haber uno. */
export async function findMinimoDe(sucursalId: number, piezaId: number): Promise<{ id: number } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('suc', sql.Int, sucursalId)
    .input('pza', sql.Int, piezaId)
    .query('SELECT id FROM minimos_sucursal WHERE sucursal_id=@suc AND pieza_id=@pza')
  return r.recordset[0] ?? null
}
