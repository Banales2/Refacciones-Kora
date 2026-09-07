// Lo que una unidad lleva hecho de sus programas de mantenimiento: qué programa
// sigue en cada etapa y desde dónde, qué columnas cerró, y cuándo se atendió
// por última vez cada renglón. Ver la migración 013 para por qué son cosas
// separadas, y la 016 para por qué hay una fila por etapa.
//
// La columna cerrada NO es un registro propio: es un `mantenimiento`, con su
// fecha, su odómetro, su costo, su técnico y sus piezas, que declara qué
// columna del programa atendió —igual que ya declara qué incidencias cerró—.
// Ver la migración 017. Hacia el usuario eso se llama "visita al taller", que
// es como se piensa el trabajo, y por eso el tipo de aquí conserva el nombre.
//
// Aquí no se decide en qué etapa va la unidad: eso se calcula contra su garantía
// principal, y vive en el servicio. Este repo solo guarda y lee.
//
// El catálogo del modelo no se copia aquí: se lee con programaRepo y se cruza
// en el servicio.
import * as sql from 'mssql'
import { getPool } from '../shared/db'
import type { TipoPrograma } from './programaRepo'

/** La etapa se llama igual que el tipo de programa que se sigue en ella. */
export type Etapa = TipoPrograma

export interface VinculoPrograma {
  vehiculo_id:  number
  etapa:        Etapa
  programa_id:  number
  /**
   * Odómetro desde el que se cuenta el recorrido. Una unidad usada no arranca
   * en cero. En la etapa de posgarantía puede venir nulo: significa "derívalo"
   * —el km del último servicio que la unidad realmente recibió—, y el servicio
   * lo resuelve.
   */
  km_inicio:    number | null
  fecha_inicio: string | null
  /**
   * Una persona decidió que esta es la etapa activa, sin importar el cálculo
   * contra la garantía. Sirve en los dos sentidos: quedarse en el programa del
   * fabricante con la garantía ya vencida, o saltar antes de tiempo.
   */
  forzada:      boolean
}

/**
 * Una columna del programa ya cerrada, leída como la "visita al taller" que el
 * usuario ve. Por debajo es el mantenimiento con el que se pagó: `id` y
 * `mantenimiento_id` son el mismo número, y el resto —fecha, km, costo— sale de
 * él, no de una copia.
 */
export interface Visita {
  id:               number
  vehiculo_id:      number
  etapa:            Etapa
  fase_id:          number
  /** Posición en el recorrido desde el arranque de su etapa: la columna sola no la identifica. */
  indice:           number
  fecha:            string
  km:               number | null
  /** Siempre presente: la visita ES el mantenimiento. Se conserva por claridad. */
  mantenimiento_id: number
  /** Lo que costó de verdad, no lo cotizado en la fase. */
  costo:            number
  tipo:             string | null
}

/**
 * Lo que una unidad hace distinto del programa de su modelo. Solo diferencias:
 * lo que no está aquí viene del catálogo tal cual (migración 016).
 */
export interface ExcepcionFase {
  fase_id: number
  km:      number | null
  costo:   number | null
  omitida: boolean
}

export interface ExcepcionOperacion {
  operacion_id: number
  activa:       boolean
  limite_meses: number | null
}

export interface Excepciones {
  fases:      ExcepcionFase[]
  operaciones: ExcepcionOperacion[]
}

export interface EstadoOperacion {
  operacion_id: number
  ultima_fecha: string
  ultimo_km:    number | null
  /**
   * El mantenimiento que lo cerró cuando vino con la columna completa. Nulo =
   * se atendió por su cuenta, sin hacer la columna, porque su límite de meses
   * venció antes que el kilometraje.
   */
  mantenimiento_id: number | null
}

export interface VisitaCreate {
  /** El mantenimiento que cerró la columna. No se crea aquí: ya existe. */
  mantenimiento_id: number
  vehiculo_id:      number
  etapa:            Etapa
  fase_id:          number
  indice:           number
  fecha:            string
  km?:              number | null
  /** Los renglones que esa columna manda hacer: se cierran todos con ella. */
  operacion_ids:    number[]
}

// ─── Vínculo ────────────────────────────────────────────────────────────────

const VINCULO_COLS = `vehiculo_id, etapa, programa_id, km_inicio,
  CONVERT(char(10), fecha_inicio, 23) AS fecha_inicio, forzada`

function mapVinculo(row: Record<string, unknown>): VinculoPrograma {
  return { ...(row as unknown as VinculoPrograma), forzada: !!row.forzada }
}

/** Las dos filas de la unidad, una por etapa. El servicio decide cuál manda. */
export async function findVinculos(vehiculoId: number): Promise<VinculoPrograma[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`SELECT ${VINCULO_COLS} FROM vehiculo_programa WHERE vehiculo_id=@vid`)
  return r.recordset.map(mapVinculo)
}

// Alta o cambio del programa que sigue la unidad en una etapa. Cambiar de
// programa no borra el historial: las visitas viejas apuntan a las fases del
// programa anterior y siguen siendo ciertas, solo dejan de contar para el
// recorrido nuevo.
export async function setVinculo(v: VinculoPrograma): Promise<VinculoPrograma[]> {
  const pool = await getPool()
  await pool.request()
    .input('vid',     sql.Int,  v.vehiculo_id)
    .input('etapa',   sql.NVarChar(20), v.etapa)
    .input('pid',     sql.Int,  v.programa_id)
    .input('km',      sql.Int,  v.km_inicio ?? null)
    .input('fecha',   sql.Date, v.fecha_inicio ?? null)
    .input('forzada', sql.Bit,  v.forzada)
    .query(`
      MERGE INTO vehiculo_programa AS tgt
      USING (SELECT @vid AS vehiculo_id, @etapa AS etapa) AS src
        ON tgt.vehiculo_id = src.vehiculo_id AND tgt.etapa = src.etapa
      WHEN MATCHED THEN UPDATE SET
        programa_id = @pid, km_inicio = @km, fecha_inicio = @fecha,
        forzada = @forzada, updated_at = SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (vehiculo_id, etapa, programa_id, km_inicio, fecha_inicio, forzada)
        VALUES (@vid, @etapa, @pid, @km, @fecha, @forzada);
    `)
  return findVinculos(v.vehiculo_id)
}

/**
 * Fija —o suelta— la etapa que una persona decidió para la unidad. `null`
 * devuelve la decisión al cálculo contra la garantía. El índice único deja a lo
 * mucho una forzada por unidad, así que se limpian todas antes de marcar.
 */
export async function setEtapaForzada(vehiculoId: number, etapa: Etapa | null): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('vid', sql.Int, vehiculoId)
      .query('UPDATE vehiculo_programa SET forzada=0, updated_at=SYSDATETIME() WHERE vehiculo_id=@vid')
    if (etapa) {
      await tx.request().input('vid', sql.Int, vehiculoId).input('etapa', sql.NVarChar(20), etapa)
        .query(`UPDATE vehiculo_programa SET forzada=1, updated_at=SYSDATETIME()
                WHERE vehiculo_id=@vid AND etapa=@etapa`)
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// Quita el programa de una etapa de la unidad y con él su avance: las visitas y
// los estados solo tienen sentido contra el recorrido que se está dejando. Los
// estados no distinguen etapa —una operación es de un solo programa—, así que
// se sueltan por las visitas de la etapa y por las operaciones de su programa.
export async function removeVinculo(vehiculoId: number, etapa: Etapa): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    // Los estados apuntan a las visitas con NO ACTION: van primero.
    await tx.request().input('vid', sql.Int, vehiculoId).input('etapa', sql.NVarChar(20), etapa)
      .query(`
        DELETE e FROM vehiculo_operacion_estado e
        JOIN programa_operaciones o ON o.id = e.operacion_id
        JOIN vehiculo_programa vp
          ON vp.programa_id = o.programa_id AND vp.vehiculo_id = e.vehiculo_id
        WHERE e.vehiculo_id=@vid AND vp.etapa=@etapa`)
    // Solo el vínculo con el programa: los mantenimientos se quedan, porque
    // esos servicios sí ocurrieron.
    await tx.request().input('vid', sql.Int, vehiculoId).input('etapa', sql.NVarChar(20), etapa)
      .query('DELETE FROM mantenimiento_programa WHERE vehiculo_id=@vid AND etapa=@etapa')
    const r = await tx.request().input('vid', sql.Int, vehiculoId).input('etapa', sql.NVarChar(20), etapa)
      .query(`DELETE FROM vehiculo_programa OUTPUT DELETED.vehiculo_id
              WHERE vehiculo_id=@vid AND etapa=@etapa`)
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// ─── Excepciones de la unidad sobre el catálogo ─────────────────────────────

export async function findExcepciones(vehiculoId: number): Promise<Excepciones> {
  const pool = await getPool()
  const [fases, ops] = await Promise.all([
    pool.request().input('vid', sql.Int, vehiculoId)
      .query('SELECT fase_id, km, costo, omitida FROM vehiculo_fase_excepcion WHERE vehiculo_id=@vid'),
    pool.request().input('vid', sql.Int, vehiculoId)
      .query('SELECT operacion_id, activa, limite_meses FROM vehiculo_operacion_excepcion WHERE vehiculo_id=@vid'),
  ])
  return {
    fases: fases.recordset.map((f) => ({
      ...f, omitida: !!f.omitida, costo: f.costo == null ? null : Number(f.costo),
    })),
    operaciones: ops.recordset.map((o) => ({ ...o, activa: !!o.activa })),
  }
}

export interface ExcepcionesFleet {
  vehiculo_id: number
  fases:       ExcepcionFase[]
  operaciones: ExcepcionOperacion[]
}

/** Las de varias unidades de un jalón, para el tablero. */
export async function findExcepcionesDeVehiculos(ids: number[]): Promise<Map<number, Excepciones>> {
  const salida = new Map<number, Excepciones>()
  if (!ids.length) return salida
  const pool = await getPool()
  const reqF = pool.request()
  const pF = ids.map((id, i) => { reqF.input(`v${i}`, sql.Int, id); return `@v${i}` })
  const reqO = pool.request()
  const pO = ids.map((id, i) => { reqO.input(`v${i}`, sql.Int, id); return `@v${i}` })
  const [fases, ops] = await Promise.all([
    reqF.query(`SELECT vehiculo_id, fase_id, km, costo, omitida
                FROM vehiculo_fase_excepcion WHERE vehiculo_id IN (${pF.join(',')})`),
    reqO.query(`SELECT vehiculo_id, operacion_id, activa, limite_meses
                FROM vehiculo_operacion_excepcion WHERE vehiculo_id IN (${pO.join(',')})`),
  ])
  const de = (vid: number) => {
    let e = salida.get(vid)
    if (!e) { e = { fases: [], operaciones: [] }; salida.set(vid, e) }
    return e
  }
  for (const f of fases.recordset) {
    de(f.vehiculo_id).fases.push({
      fase_id: f.fase_id, km: f.km, omitida: !!f.omitida,
      costo: f.costo == null ? null : Number(f.costo),
    })
  }
  for (const o of ops.recordset) {
    de(o.vehiculo_id).operaciones.push({
      operacion_id: o.operacion_id, activa: !!o.activa, limite_meses: o.limite_meses,
    })
  }
  return salida
}

/**
 * Reemplazo completo de lo que una unidad hace distinto. Solo se guardan las
 * filas que efectivamente cambian algo: una excepción que repite el catálogo
 * sería ruido que después impide que una corrección al modelo alcance a la
 * unidad. Eso lo decide el servicio; aquí se escribe lo que llegue.
 */
export async function setExcepciones(vehiculoId: number, e: Excepciones): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('vid', sql.Int, vehiculoId)
      .query('DELETE FROM vehiculo_fase_excepcion WHERE vehiculo_id=@vid')
    await tx.request().input('vid', sql.Int, vehiculoId)
      .query('DELETE FROM vehiculo_operacion_excepcion WHERE vehiculo_id=@vid')

    for (const f of e.fases) {
      await tx.request()
        .input('vid',   sql.Int, vehiculoId)
        .input('fid',   sql.Int, f.fase_id)
        .input('km',    sql.Int, f.km ?? null)
        .input('costo', sql.Decimal(18, 2), f.costo ?? null)
        .input('om',    sql.Bit, f.omitida)
        .query(`INSERT INTO vehiculo_fase_excepcion (vehiculo_id, fase_id, km, costo, omitida)
                VALUES (@vid, @fid, @km, @costo, @om)`)
    }
    for (const o of e.operaciones) {
      await tx.request()
        .input('vid',    sql.Int, vehiculoId)
        .input('oid',    sql.Int, o.operacion_id)
        .input('activa', sql.Bit, o.activa)
        .input('lim',    sql.Int, o.limite_meses ?? null)
        .query(`INSERT INTO vehiculo_operacion_excepcion (vehiculo_id, operacion_id, activa, limite_meses)
                VALUES (@vid, @oid, @activa, @lim)`)
    }
    await tx.commit()
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

// El mantenimiento es la visita, así que se lee de ahí: la fecha y el odómetro
// son los del servicio real, no una copia que se pueda desincronizar al
// corregirlos.
const SELECT_VISITA = `
  SELECT mp.mantenimiento_id AS id, mp.vehiculo_id, mp.etapa, mp.fase_id, mp.indice,
         CONVERT(char(10), m.fecha, 23) AS fecha, m.km_actual AS km,
         mp.mantenimiento_id, m.costo, m.tipo
  FROM mantenimiento_programa mp
  JOIN mantenimiento m ON m.id = mp.mantenimiento_id`

function mapVisita(row: Record<string, unknown>): Visita {
  return { ...(row as unknown as Visita), costo: Number(row.costo ?? 0) }
}

export async function findVisitas(vehiculoId: number): Promise<Visita[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`${SELECT_VISITA} WHERE mp.vehiculo_id=@vid ORDER BY mp.etapa, mp.indice`)
  return r.recordset.map(mapVisita)
}

export async function findEstados(vehiculoId: number): Promise<EstadoOperacion[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`
      SELECT operacion_id, ultima_fecha, ultimo_km, mantenimiento_id
      FROM vehiculo_operacion_estado WHERE vehiculo_id=@vid`)
  return r.recordset
}

// Cierra una columna completa: declara que este mantenimiento la atendió y pone
// al día, de un golpe, todos los renglones que la columna manda hacer.
//
// El mantenimiento ya existe cuando se llega aquí. No se crea desde este módulo
// —eso es trabajo de `mantenimientoRepo`, con sus piezas y su stock— y por eso
// esto es un vínculo, no un alta.
export async function crearVisita(data: VisitaCreate): Promise<Visita> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request()
      .input('mid',    sql.Int,  data.mantenimiento_id)
      .input('vid',    sql.Int,  data.vehiculo_id)
      .input('etapa',  sql.NVarChar(20), data.etapa)
      .input('fid',    sql.Int,  data.fase_id)
      .input('indice', sql.Int,  data.indice)
      .query(`
        INSERT INTO mantenimiento_programa
          (mantenimiento_id, vehiculo_id, etapa, fase_id, indice)
        VALUES (@mid, @vid, @etapa, @fid, @indice)`)

    for (const opId of data.operacion_ids) {
      await tx.request()
        .input('vid',   sql.Int,  data.vehiculo_id)
        .input('oid',   sql.Int,  opId)
        .input('fecha', sql.Date, data.fecha)
        .input('km',    sql.Int,  data.km ?? null)
        .input('mid',   sql.Int,  data.mantenimiento_id)
        .query(`
          MERGE INTO vehiculo_operacion_estado AS tgt
          USING (SELECT @vid AS vehiculo_id, @oid AS operacion_id) AS src
            ON tgt.vehiculo_id = src.vehiculo_id AND tgt.operacion_id = src.operacion_id
          WHEN MATCHED THEN UPDATE SET
            ultima_fecha = @fecha, ultimo_km = @km, mantenimiento_id = @mid
          WHEN NOT MATCHED THEN
            INSERT (vehiculo_id, operacion_id, ultima_fecha, ultimo_km, mantenimiento_id)
            VALUES (@vid, @oid, @fecha, @km, @mid);`)
    }

    await tx.commit()
    return (await findVisita(data.mantenimiento_id))!
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// Deshace una visita: suelta el vínculo entre el mantenimiento y la columna.
//
// El mantenimiento NO se borra. Puede haber sido un error decir que cerró esa
// columna, y aun así la unidad entró al taller, se gastó ese dinero y se le
// pusieron esas piezas. Quien quiera borrar el gasto borra el mantenimiento, y
// entonces este vínculo se va con él por la cascada.
//
// Los renglones que esa visita cerró vuelven a quedar sin atención: no se puede
// saber qué decían antes, y dejarles la fecha vieja sería peor que dejarlos
// vencidos —diría que se hicieron cuando no se hicieron—. Los que se atendieron
// por su cuenta (mantenimiento_id nulo) no se tocan.
export async function borrarVisita(mantenimientoId: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('id', sql.Int, mantenimientoId)
      .query('DELETE FROM vehiculo_operacion_estado WHERE mantenimiento_id=@id')
    const r = await tx.request().input('id', sql.Int, mantenimientoId)
      .query(`DELETE FROM mantenimiento_programa
              OUTPUT DELETED.mantenimiento_id WHERE mantenimiento_id=@id`)
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

export async function findVisita(mantenimientoId: number): Promise<Visita | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, mantenimientoId)
    .query(`${SELECT_VISITA} WHERE mp.mantenimiento_id=@id`)
  return r.recordset[0] ? mapVisita(r.recordset[0]) : null
}

/** El mantenimiento tal como lo necesita el programa para cerrarle una columna. */
export interface MantenimientoDelPrograma {
  id:          number
  vehiculo_id: number
  fecha:       string
  km_actual:   number | null
  /** Ya está ligado a una columna: no se puede usar para cerrar otra. */
  ya_ligado:   boolean
}

export async function findMantenimientoParaVisita(
  mantenimientoId: number,
): Promise<MantenimientoDelPrograma | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, mantenimientoId)
    .query(`
      SELECT m.id, m.vehiculo_id, CONVERT(char(10), m.fecha, 23) AS fecha, m.km_actual,
             CASE WHEN EXISTS (
               SELECT 1 FROM mantenimiento_programa mp WHERE mp.mantenimiento_id = m.id
             ) THEN 1 ELSE 0 END AS ya_ligado
      FROM mantenimiento m WHERE m.id=@id`)
  const row = r.recordset[0]
  return row ? { ...row, ya_ligado: !!row.ya_ligado } : null
}

// Atención suelta de un renglón: el "o cada N meses" venció antes que el
// kilometraje de su columna. No cierra ninguna columna —no se hizo— y por eso
// el estado queda con `mantenimiento_id` nulo.
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
        ultima_fecha = @fecha, ultimo_km = @km, mantenimiento_id = NULL
      WHEN NOT MATCHED THEN
        INSERT (vehiculo_id, operacion_id, ultima_fecha, ultimo_km, mantenimiento_id)
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

/** Fases ya cerradas por algún mantenimiento: quitarlas borraría historial. */
export async function fasesConVisitas(faseIds: number[]): Promise<number[]> {
  if (!faseIds.length) return []
  const pool = await getPool()
  const req = pool.request()
  const params = faseIds.map((id, i) => { req.input(`f${i}`, sql.Int, id); return `@f${i}` })
  const r = await req.query(`
    SELECT DISTINCT fase_id FROM mantenimiento_programa
    WHERE fase_id IN (${params.join(',')})`)
  return r.recordset.map((f: { fase_id: number }) => f.fase_id)
}

/**
 * Suelta lo que el programa tenga colgado de un mantenimiento que se va a
 * borrar. La tabla puente cae sola por la cascada; el estado de las operaciones
 * apunta con NO ACTION y hay que soltarlo a mano.
 */
export async function soltarMantenimiento(mantenimientoId: number): Promise<void> {
  const pool = await getPool()
  await pool.request().input('id', sql.Int, mantenimientoId)
    .query('DELETE FROM vehiculo_operacion_estado WHERE mantenimiento_id=@id')
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
    SELECT vp.vehiculo_id, vp.etapa, vp.programa_id, vp.km_inicio,
           CONVERT(char(10), vp.fecha_inicio, 23) AS fecha_inicio, vp.forzada,
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
  return r.recordset.map((row) => ({ ...row, forzada: !!row.forzada }))
}

/** Visitas y estados de varias unidades de un jalón, para no consultar por unidad. */
export async function findVisitasDeVehiculos(ids: number[]): Promise<Visita[]> {
  if (!ids.length) return []
  const pool = await getPool()
  const req = pool.request()
  const params = ids.map((id, i) => { req.input(`v${i}`, sql.Int, id); return `@v${i}` })
  const r = await req.query(
    `${SELECT_VISITA} WHERE mp.vehiculo_id IN (${params.join(',')})
     ORDER BY mp.vehiculo_id, mp.etapa, mp.indice`
  )
  return r.recordset.map(mapVisita)
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
    SELECT vehiculo_id, operacion_id, ultima_fecha, ultimo_km, mantenimiento_id
    FROM vehiculo_operacion_estado WHERE vehiculo_id IN (${params.join(',')})`)
  return r.recordset
}
