// Lo que una unidad lleva hecho de su programa de mantenimiento: qué programa
// sigue y desde dónde, qué visitas al taller cerró, y cuándo se atendió por
// última vez cada renglón. Ver la migración 013 para por qué son tres cosas
// separadas.
//
// El catálogo del modelo no se copia aquí: se lee con programaRepo y se cruza
// en el servicio.
import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface VinculoPrograma {
  vehiculo_id:  number
  programa_id:  number
  /** Odómetro desde el que se cuenta el recorrido. Una unidad usada no arranca en cero. */
  km_inicio:    number
  fecha_inicio: string | null
}

export interface Visita {
  id:               number
  vehiculo_id:      number
  fase_id:          number
  /** Posición en el recorrido desde el arranque: la columna sola no la identifica. */
  indice:           number
  fecha:            string
  km:               number | null
  mantenimiento_id: number | null
}

export interface EstadoOperacion {
  operacion_id: number
  ultima_fecha: string
  ultimo_km:    number | null
  visita_id:    number | null
}

export interface VisitaCreate {
  vehiculo_id:      number
  fase_id:          number
  indice:           number
  fecha:            string
  km?:              number | null
  mantenimiento_id?: number | null
  /** Los renglones que esa columna manda hacer: se cierran todos con la visita. */
  operacion_ids:    number[]
}

// ─── Vínculo ────────────────────────────────────────────────────────────────

export async function findVinculo(vehiculoId: number): Promise<VinculoPrograma | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`
      SELECT vehiculo_id, programa_id, km_inicio, fecha_inicio
      FROM vehiculo_programa WHERE vehiculo_id=@vid`)
  return r.recordset[0] ?? null
}

// Alta o cambio del programa que sigue la unidad. Cambiar de programa no borra
// el historial: las visitas viejas apuntan a las fases del programa anterior y
// siguen siendo ciertas, solo dejan de contar para el recorrido nuevo.
export async function setVinculo(v: VinculoPrograma): Promise<VinculoPrograma> {
  const pool = await getPool()
  await pool.request()
    .input('vid',   sql.Int,  v.vehiculo_id)
    .input('pid',   sql.Int,  v.programa_id)
    .input('km',    sql.Int,  v.km_inicio)
    .input('fecha', sql.Date, v.fecha_inicio ?? null)
    .query(`
      MERGE INTO vehiculo_programa AS tgt
      USING (SELECT @vid AS vehiculo_id) AS src ON tgt.vehiculo_id = src.vehiculo_id
      WHEN MATCHED THEN UPDATE SET
        programa_id = @pid, km_inicio = @km, fecha_inicio = @fecha,
        updated_at = SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (vehiculo_id, programa_id, km_inicio, fecha_inicio)
        VALUES (@vid, @pid, @km, @fecha);
    `)
  return (await findVinculo(v.vehiculo_id))!
}

// Quita el programa de la unidad y con él todo su avance: las visitas y los
// estados solo tienen sentido contra el recorrido que se está dejando.
export async function removeVinculo(vehiculoId: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    // Los estados apuntan a las visitas con NO ACTION: van primero.
    await tx.request().input('vid', sql.Int, vehiculoId)
      .query('DELETE FROM vehiculo_operacion_estado WHERE vehiculo_id=@vid')
    await tx.request().input('vid', sql.Int, vehiculoId)
      .query('DELETE FROM vehiculo_programa_visita WHERE vehiculo_id=@vid')
    const r = await tx.request().input('vid', sql.Int, vehiculoId)
      .query('DELETE FROM vehiculo_programa OUTPUT DELETED.vehiculo_id WHERE vehiculo_id=@vid')
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// El odómetro y la fecha de compra de la unidad: el punto contra el que se mide
// todo. Vive aquí y no en vehiculosRepo porque es la misma proyección por tipo
// que ya hace el tablero, y traer la ficha entera para dos campos sale caro.
export interface DatosVehiculo {
  kilometraje:  number | null
  fecha_compra: string | null
  modelo_id:    number
}

export async function findDatosVehiculo(vehiculoId: number): Promise<DatosVehiculo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`
      SELECT CASE WHEN v.tipo='camion'       THEN c.kilometraje
                  WHEN v.tipo='tractocamion' THEN t.kilometraje
                  WHEN v.tipo='utilitario'   THEN u.kilometraje
                  ELSE NULL END AS kilometraje,
             v.fecha_compra, v.modelo_id
      FROM vehiculos v
      LEFT JOIN camiones              c ON c.vehiculo_id = v.id
      LEFT JOIN tractocamiones        t ON t.vehiculo_id = v.id
      LEFT JOIN vehiculos_utilitarios u ON u.vehiculo_id = v.id
      WHERE v.id = @vid`)
  return r.recordset[0] ?? null
}

// ─── Visitas y estados ──────────────────────────────────────────────────────

export async function findVisitas(vehiculoId: number): Promise<Visita[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`
      SELECT id, vehiculo_id, fase_id, indice, fecha, km, mantenimiento_id
      FROM vehiculo_programa_visita WHERE vehiculo_id=@vid ORDER BY indice`)
  return r.recordset
}

export async function findEstados(vehiculoId: number): Promise<EstadoOperacion[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`
      SELECT operacion_id, ultima_fecha, ultimo_km, visita_id
      FROM vehiculo_operacion_estado WHERE vehiculo_id=@vid`)
  return r.recordset
}

// Cierra una columna completa: deja la visita y pone al día, de un golpe, todos
// los renglones que esa columna manda hacer.
export async function crearVisita(data: VisitaCreate): Promise<Visita> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const r = await tx.request()
      .input('vid',    sql.Int,  data.vehiculo_id)
      .input('fid',    sql.Int,  data.fase_id)
      .input('indice', sql.Int,  data.indice)
      .input('fecha',  sql.Date, data.fecha)
      .input('km',     sql.Int,  data.km ?? null)
      .input('mid',    sql.Int,  data.mantenimiento_id ?? null)
      .query(`
        INSERT INTO vehiculo_programa_visita
          (vehiculo_id, fase_id, indice, fecha, km, mantenimiento_id)
        OUTPUT INSERTED.id, INSERTED.vehiculo_id, INSERTED.fase_id, INSERTED.indice,
               INSERTED.fecha, INSERTED.km, INSERTED.mantenimiento_id
        VALUES (@vid, @fid, @indice, @fecha, @km, @mid)`)
    const visita: Visita = r.recordset[0]

    for (const opId of data.operacion_ids) {
      await tx.request()
        .input('vid',    sql.Int,  data.vehiculo_id)
        .input('oid',    sql.Int,  opId)
        .input('fecha',  sql.Date, data.fecha)
        .input('km',     sql.Int,  data.km ?? null)
        .input('visita', sql.Int,  visita.id)
        .query(`
          MERGE INTO vehiculo_operacion_estado AS tgt
          USING (SELECT @vid AS vehiculo_id, @oid AS operacion_id) AS src
            ON tgt.vehiculo_id = src.vehiculo_id AND tgt.operacion_id = src.operacion_id
          WHEN MATCHED THEN UPDATE SET
            ultima_fecha = @fecha, ultimo_km = @km, visita_id = @visita
          WHEN NOT MATCHED THEN
            INSERT (vehiculo_id, operacion_id, ultima_fecha, ultimo_km, visita_id)
            VALUES (@vid, @oid, @fecha, @km, @visita);`)
    }

    await tx.commit()
    return visita
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// Deshace una visita. Los renglones que esa visita cerró vuelven a quedar sin
// atención: no se puede saber qué decían antes, y dejarles la fecha vieja sería
// peor que dejarlos vencidos —diría que se hicieron cuando no se hicieron—.
// Los que se atendieron por su cuenta (visita_id nulo) no se tocan.
export async function borrarVisita(id: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM vehiculo_operacion_estado WHERE visita_id=@id')
    const r = await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM vehiculo_programa_visita OUTPUT DELETED.id WHERE id=@id')
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

export async function findVisita(id: number): Promise<Visita | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT id, vehiculo_id, fase_id, indice, fecha, km, mantenimiento_id
      FROM vehiculo_programa_visita WHERE id=@id`)
  return r.recordset[0] ?? null
}

// Atención suelta de un renglón: el "o cada N meses" venció antes que el
// kilometraje de su columna. No deja visita —no se hizo la columna— y por eso
// el estado queda con `visita_id` nulo.
export async function atenderOperacion(
  vehiculoId: number, operacionId: number, fecha: string, km: number | null,
): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('vid',   sql.Int,  vehiculoId)
    .input('oid',   sql.Int,  operacionId)
    .input('fecha', sql.Date, fecha)
    .input('km',    sql.Int,  km ?? null)
    .query(`
      MERGE INTO vehiculo_operacion_estado AS tgt
      USING (SELECT @vid AS vehiculo_id, @oid AS operacion_id) AS src
        ON tgt.vehiculo_id = src.vehiculo_id AND tgt.operacion_id = src.operacion_id
      WHEN MATCHED THEN UPDATE SET
        ultima_fecha = @fecha, ultimo_km = @km, visita_id = NULL
      WHEN NOT MATCHED THEN
        INSERT (vehiculo_id, operacion_id, ultima_fecha, ultimo_km, visita_id)
        VALUES (@vid, @oid, @fecha, @km, NULL);`)
}

// ─── Integridad contra el catálogo del modelo ───────────────────────────────

/** Cuántas unidades siguen un programa. Se consulta antes de borrarlo. */
export async function contarVehiculosDePrograma(programaId: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request().input('pid', sql.Int, programaId)
    .query('SELECT COUNT(*) AS n FROM vehiculo_programa WHERE programa_id=@pid')
  return r.recordset[0].n
}

/** Fases con visitas ya registradas: quitarlas del programa borraría historial. */
export async function fasesConVisitas(faseIds: number[]): Promise<number[]> {
  if (!faseIds.length) return []
  const pool = await getPool()
  const req = pool.request()
  const params = faseIds.map((id, i) => { req.input(`f${i}`, sql.Int, id); return `@f${i}` })
  const r = await req.query(`
    SELECT DISTINCT fase_id FROM vehiculo_programa_visita
    WHERE fase_id IN (${params.join(',')})`)
  return r.recordset.map((f: { fase_id: number }) => f.fase_id)
}

/** Suelta el estado que las unidades tengan de una operación que se va a borrar. */
export async function borrarEstadosDeOperacion(operacionId: number): Promise<void> {
  const pool = await getPool()
  await pool.request().input('oid', sql.Int, operacionId)
    .query('DELETE FROM vehiculo_operacion_estado WHERE operacion_id=@oid')
}

// ─── Toda la flota, para el tablero ─────────────────────────────────────────

export interface VinculoFleet extends VinculoPrograma {
  vehiculo_nombre: string
  kilometraje:     number | null
  fecha_compra:    string | null
  modelo_id:       number
}

export async function findVinculosFleet(): Promise<VinculoFleet[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT vp.vehiculo_id, vp.programa_id, vp.km_inicio, vp.fecha_inicio,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
           CASE WHEN v.tipo='camion'       THEN c.kilometraje
                WHEN v.tipo='tractocamion' THEN t.kilometraje
                WHEN v.tipo='utilitario'   THEN u.kilometraje
                ELSE NULL END AS kilometraje,
           v.fecha_compra, v.modelo_id
    FROM vehiculo_programa vp
    JOIN vehiculos v ON v.id = vp.vehiculo_id
    JOIN modelos mo  ON mo.id = v.modelo_id
    LEFT JOIN camiones              c ON c.vehiculo_id = v.id
    LEFT JOIN tractocamiones        t ON t.vehiculo_id = v.id
    LEFT JOIN vehiculos_utilitarios u ON u.vehiculo_id = v.id
  `)
  return r.recordset
}

/** Visitas y estados de varias unidades de un jalón, para no consultar por unidad. */
export async function findVisitasDeVehiculos(ids: number[]): Promise<Visita[]> {
  if (!ids.length) return []
  const pool = await getPool()
  const req = pool.request()
  const params = ids.map((id, i) => { req.input(`v${i}`, sql.Int, id); return `@v${i}` })
  const r = await req.query(`
    SELECT id, vehiculo_id, fase_id, indice, fecha, km, mantenimiento_id
    FROM vehiculo_programa_visita WHERE vehiculo_id IN (${params.join(',')})
    ORDER BY vehiculo_id, indice`)
  return r.recordset
}

export interface EstadoFleet extends EstadoOperacion {
  vehiculo_id: number
}

export async function findEstadosDeVehiculos(ids: number[]): Promise<EstadoFleet[]> {
  if (!ids.length) return []
  const pool = await getPool()
  const req = pool.request()
  const params = ids.map((id, i) => { req.input(`v${i}`, sql.Int, id); return `@v${i}` })
  const r = await req.query(`
    SELECT vehiculo_id, operacion_id, ultima_fecha, ultimo_km, visita_id
    FROM vehiculo_operacion_estado WHERE vehiculo_id IN (${params.join(',')})`)
  return r.recordset
}
