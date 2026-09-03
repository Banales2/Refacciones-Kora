// Programa de mantenimiento de un modelo: la tabla que publica el fabricante.
// Columnas = fases (marcas de odómetro), renglones = operaciones sobre piezas,
// celdas = qué se le hace a esa pieza en esa fase. Ver la migración 012 para
// por qué el kilometraje es grupal y el tiempo individual, y cómo se repite el
// ciclo cuando se acaban las columnas.
//
// Se lee siempre completo: el programa por partes no se usa en ningún lado, y
// la cuadrícula que lo captura necesita las tres cosas a la vez.
import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Accion {
  codigo:      string
  nombre:      string
  descripcion: string | null
  orden:       number
}

export interface Fase {
  id:     number
  orden:  number
  km:     number
  /** Se hace una sola vez, en la primera pasada: el asentamiento. */
  unica:  boolean
  /**
   * Lo que el taller cobra por la columna completa, mano de obra y refacciones
   * juntas, que es como llega la cotización. Nulo = sin cotizar; la proyección
   * lo deja fuera en vez de contarlo como cero.
   */
  costo:  number | null
}

export interface Operacion {
  id:            number
  orden:         number
  nombre:        string
  descripcion:   string | null
  categoria:     string | null
  tipo_pieza_id: number | null
  /** El "o cada N meses" del renglón. Vence solo, sin arrastrar la fase. */
  limite_meses:  number | null
  /** Qué se le hace en cada fase, por id de fase. Lo que no está, no se hace. */
  celdas:        Record<number, string>
}

export interface Programa {
  id:          number
  modelo_id:   number
  nombre:      string
  descripcion: string | null
  activo:      boolean
  created_at:  string
  updated_at:  string
}

export interface ProgramaCompleto extends Programa {
  fases:       Fase[]
  operaciones: Operacion[]
}

export interface ProgramaCreate {
  modelo_id:    number
  nombre:       string
  descripcion?: string | null
  activo?:      boolean
}

export interface ProgramaUpdate {
  nombre?:      string
  descripcion?: string | null
  activo?:      boolean
}

/** Una fase tal como llega de la captura: sin id, identificada por su marca. */
export interface FaseEntrada {
  km:    number
  unica: boolean
  costo?: number | null
}

export interface OperacionCreate {
  nombre:        string
  descripcion?:  string | null
  categoria?:    string | null
  tipo_pieza_id?: number | null
  limite_meses?: number | null
}

export interface OperacionUpdate {
  nombre?:        string
  descripcion?:   string | null
  categoria?:     string | null
  tipo_pieza_id?: number | null
  limite_meses?:  number | null
}

const PROGRAMA_COLS = `id, modelo_id, nombre, descripcion, activo, created_at, updated_at`

// Desplazamiento con el que se aparta el orden viejo antes de reasignarlo.
//
// Reordenar exige liberar los valores primero: el índice único de
// (programa_id, orden) choca en cuanto dos renglones se cruzan a medio camino.
// Lo natural sería negarlos, pero `orden` lleva un CHECK (orden >= 0) desde la
// migración 012, y un valor negativo lo viola. SQL Server reporta esa violación
// con el mismo error 547 que las llaves foráneas, así que salía por la API como
// un 409 de "hay registros que dependen de este" que no tenía ninguna relación
// con lo que se estaba guardando.
//
// Desplazar hacia arriba cumple lo mismo -aparta los valores sin colisionar- y
// respeta el CHECK. El tope real son 60 fases y 500 operaciones por programa,
// así que un millón está muy por encima de cualquier orden que pueda existir.
const OFFSET_ORDEN = 1_000_000

export async function findAcciones(): Promise<Accion[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query('SELECT codigo, nombre, descripcion, orden FROM programa_acciones ORDER BY orden')
  return r.recordset
}

// ─── Lectura del programa completo ──────────────────────────────────────────

async function cargarCompleto(programa: Programa | null): Promise<ProgramaCompleto | null> {
  if (!programa) return null
  const pool = await getPool()

  const [fasesRes, opsRes, celdasRes] = await Promise.all([
    pool.request().input('pid', sql.Int, programa.id).query(`
      SELECT id, orden, km, unica, costo
      FROM programa_fases WHERE programa_id=@pid ORDER BY orden`),
    pool.request().input('pid', sql.Int, programa.id).query(`
      SELECT id, orden, nombre, descripcion, categoria, tipo_pieza_id, limite_meses
      FROM programa_operaciones WHERE programa_id=@pid ORDER BY orden`),
    pool.request().input('pid', sql.Int, programa.id).query(`
      SELECT c.operacion_id, c.fase_id, c.accion
      FROM programa_operacion_fase c
      JOIN programa_operaciones o ON o.id = c.operacion_id
      WHERE o.programa_id=@pid`),
  ])

  const porOperacion = new Map<number, Record<number, string>>()
  for (const c of celdasRes.recordset) {
    const fila = porOperacion.get(c.operacion_id)
    if (fila) fila[c.fase_id] = c.accion
    else porOperacion.set(c.operacion_id, { [c.fase_id]: c.accion })
  }

  return {
    ...programa,
    // mssql devuelve DECIMAL como string cuando no cabe en un number seguro;
    // aquí siempre cabe, pero se normaliza para que el consumidor no tenga que
    // preguntarse de qué tipo le llegó el dinero.
    fases: fasesRes.recordset.map((f) => ({
      ...f, unica: !!f.unica, costo: f.costo == null ? null : Number(f.costo),
    })),
    operaciones: opsRes.recordset.map((o) => ({ ...o, celdas: porOperacion.get(o.id) ?? {} })),
  }
}

export async function findByModelo(modeloId: number): Promise<ProgramaCompleto | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId', sql.Int, modeloId)
    .query(`SELECT ${PROGRAMA_COLS} FROM programas_mantenimiento WHERE modelo_id=@modeloId`)
  return cargarCompleto(r.recordset[0] ?? null)
}

export async function findById(id: number): Promise<ProgramaCompleto | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${PROGRAMA_COLS} FROM programas_mantenimiento WHERE id=@id`)
  return cargarCompleto(r.recordset[0] ?? null)
}

// La cabecera sola, para los endpoints que solo necesitan saber de qué modelo
// es un programa sin arrastrar toda la cuadrícula.
export async function findCabecera(id: number): Promise<Programa | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${PROGRAMA_COLS} FROM programas_mantenimiento WHERE id=@id`)
  return r.recordset[0] ?? null
}

// De qué programa es una operación. Lo usan los endpoints de renglón y de
// celdas, que reciben el id de la operación y necesitan auditar el programa.
export async function findProgramaDeOperacion(operacionId: number): Promise<Programa | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, operacionId)
    .query(`
      SELECT p.id, p.modelo_id, p.nombre, p.descripcion, p.activo, p.created_at, p.updated_at
      FROM programa_operaciones o
      JOIN programas_mantenimiento p ON p.id = o.programa_id
      WHERE o.id=@id`)
  return r.recordset[0] ?? null
}

// ─── Cabecera ───────────────────────────────────────────────────────────────

export async function create(data: ProgramaCreate): Promise<Programa> {
  const pool = await getPool()
  const r = await pool.request()
    .input('modeloId',    sql.Int,               data.modelo_id)
    .input('nombre',      sql.NVarChar(160),     data.nombre)
    .input('descripcion', sql.NVarChar(sql.MAX), data.descripcion ?? null)
    .input('activo',      sql.Bit,               data.activo ?? true)
    .query(`
      INSERT INTO programas_mantenimiento (modelo_id, nombre, descripcion, activo)
      OUTPUT INSERTED.*
      VALUES (@modeloId, @nombre, @descripcion, @activo)
    `)
  return r.recordset[0]
}

export async function update(id: number, data: ProgramaUpdate): Promise<Programa | null> {
  const pool = await getPool()
  const sets: string[] = ['updated_at=SYSDATETIME()']
  const req = pool.request().input('id', sql.Int, id)

  if (data.nombre !== undefined) { req.input('nombre', sql.NVarChar(160), data.nombre); sets.push('nombre=@nombre') }
  if ('descripcion' in data)     { req.input('descripcion', sql.NVarChar(sql.MAX), data.descripcion ?? null); sets.push('descripcion=@descripcion') }
  if (data.activo !== undefined) { req.input('activo', sql.Bit, data.activo); sets.push('activo=@activo') }

  const r = await req.query(`
    UPDATE programas_mantenimiento SET ${sets.join(',')}
    OUTPUT INSERTED.*
    WHERE id=@id`)
  return r.recordset[0] ?? null
}

// Se borra a mano de abajo hacia arriba: las celdas apuntan a las fases con
// NO ACTION (migración 012), así que dejar que la cascada del programa borre
// las fases con celdas vivas abortaría el DELETE.
export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('id', sql.Int, id).query(`
      DELETE c FROM programa_operacion_fase c
      JOIN programa_operaciones o ON o.id = c.operacion_id
      WHERE o.programa_id=@id`)
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM programa_operaciones WHERE programa_id=@id')
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM programa_fases WHERE programa_id=@id')
    const r = await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM programas_mantenimiento OUTPUT DELETED.id WHERE id=@id')
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// ─── Fases (las columnas) ───────────────────────────────────────────────────

// Reemplazo completo de las columnas, en el orden en que llegan.
//
// Las fases se empatan por su marca de kilometraje, no por posición: mover una
// columna de lugar o marcarla como única no debe tirar las celdas que ya tiene.
// Solo pierde sus celdas la columna que efectivamente desaparece, que es lo que
// significa quitarla de la tabla.
export async function setFases(programaId: number, fases: FaseEntrada[]): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const existentes = (await tx.request().input('pid', sql.Int, programaId)
      .query('SELECT id, km FROM programa_fases WHERE programa_id=@pid')).recordset as { id: number; km: number }[]
    const porKm = new Map(existentes.map((f) => [f.km, f.id]))
    const kmNuevos = new Set(fases.map((f) => f.km))

    // Fuera las que ya no están, con sus celdas por delante.
    for (const vieja of existentes) {
      if (kmNuevos.has(vieja.km)) continue
      await tx.request().input('fid', sql.Int, vieja.id)
        .query('DELETE FROM programa_operacion_fase WHERE fase_id=@fid')
      await tx.request().input('fid', sql.Int, vieja.id)
        .query('DELETE FROM programa_fases WHERE id=@fid')
    }

    // El orden se libera antes de reasignarlo (ver OFFSET_ORDEN).
    await tx.request().input('pid', sql.Int, programaId).input('off', sql.Int, OFFSET_ORDEN)
      .query('UPDATE programa_fases SET orden = orden + @off WHERE programa_id=@pid')

    for (const [i, fase] of fases.entries()) {
      const id = porKm.get(fase.km)
      if (id != null) {
        await tx.request()
          .input('id',    sql.Int, id)
          .input('orden', sql.Int, i)
          .input('unica', sql.Bit, fase.unica)
          .input('costo', sql.Decimal(18, 2), fase.costo ?? null)
          .query('UPDATE programa_fases SET orden=@orden, unica=@unica, costo=@costo WHERE id=@id')
      } else {
        await tx.request()
          .input('pid',   sql.Int, programaId)
          .input('orden', sql.Int, i)
          .input('km',    sql.Int, fase.km)
          .input('unica', sql.Bit, fase.unica)
          .input('costo', sql.Decimal(18, 2), fase.costo ?? null)
          .query(`
            INSERT INTO programa_fases (programa_id, orden, km, unica, costo)
            VALUES (@pid, @orden, @km, @unica, @costo)`)
      }
    }

    await tx.request().input('pid', sql.Int, programaId)
      .query('UPDATE programas_mantenimiento SET updated_at=SYSDATETIME() WHERE id=@pid')
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// ─── Operaciones (los renglones) ────────────────────────────────────────────

export async function createOperacion(programaId: number, data: OperacionCreate): Promise<Operacion> {
  const pool = await getPool()
  const r = await pool.request()
    .input('pid',         sql.Int,               programaId)
    .input('nombre',      sql.NVarChar(200),     data.nombre)
    .input('descripcion', sql.NVarChar(sql.MAX), data.descripcion   ?? null)
    .input('categoria',   sql.NVarChar(80),      data.categoria     ?? null)
    .input('tipoPieza',   sql.Int,               data.tipo_pieza_id ?? null)
    .input('limiteMeses', sql.Int,               data.limite_meses  ?? null)
    .query(`
      INSERT INTO programa_operaciones
        (programa_id, orden, nombre, descripcion, categoria, tipo_pieza_id, limite_meses)
      OUTPUT INSERTED.id, INSERTED.orden, INSERTED.nombre, INSERTED.descripcion,
             INSERTED.categoria, INSERTED.tipo_pieza_id, INSERTED.limite_meses
      SELECT @pid,
             COALESCE((SELECT MAX(orden) + 1 FROM programa_operaciones WHERE programa_id=@pid), 0),
             @nombre, @descripcion, @categoria, @tipoPieza, @limiteMeses
    `)
  return { ...r.recordset[0], celdas: {} }
}

export async function findOperacion(id: number): Promise<Operacion | null> {
  const pool = await getPool()
  const [opRes, celdasRes] = await Promise.all([
    pool.request().input('id', sql.Int, id).query(`
      SELECT id, orden, nombre, descripcion, categoria, tipo_pieza_id, limite_meses
      FROM programa_operaciones WHERE id=@id`),
    pool.request().input('id', sql.Int, id).query(`
      SELECT fase_id, accion FROM programa_operacion_fase WHERE operacion_id=@id`),
  ])
  if (!opRes.recordset[0]) return null
  const celdas: Record<number, string> = {}
  for (const c of celdasRes.recordset) celdas[c.fase_id] = c.accion
  return { ...opRes.recordset[0], celdas }
}

export async function updateOperacion(id: number, data: OperacionUpdate): Promise<boolean> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)

  if (data.nombre !== undefined) { req.input('nombre', sql.NVarChar(200), data.nombre); sets.push('nombre=@nombre') }
  if ('descripcion' in data)     { req.input('descripcion', sql.NVarChar(sql.MAX), data.descripcion ?? null); sets.push('descripcion=@descripcion') }
  if ('categoria' in data)       { req.input('categoria', sql.NVarChar(80), data.categoria ?? null); sets.push('categoria=@categoria') }
  if ('tipo_pieza_id' in data)   { req.input('tipoPieza', sql.Int, data.tipo_pieza_id ?? null); sets.push('tipo_pieza_id=@tipoPieza') }
  if ('limite_meses' in data)    { req.input('limiteMeses', sql.Int, data.limite_meses ?? null); sets.push('limite_meses=@limiteMeses') }
  if (!sets.length) return true

  const r = await req.query(
    `UPDATE programa_operaciones SET ${sets.join(',')} OUTPUT INSERTED.id WHERE id=@id`)
  return r.recordset.length > 0
}

export async function removeOperacion(id: number): Promise<boolean> {
  const pool = await getPool()
  // Las celdas se van por la cascada de la operación (migración 012).
  const r = await pool.request().input('id', sql.Int, id)
    .query('DELETE FROM programa_operaciones OUTPUT DELETED.id WHERE id=@id')
  return r.recordset.length > 0
}

// Reordena los renglones al orden en que llegan los ids. Los que no vengan se
// quedan detrás, conservando su orden relativo.
export async function reordenarOperaciones(programaId: number, ids: number[]): Promise<void> {
  if (!ids.length) return
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    // Mismo apartado que en setFases (ver OFFSET_ORDEN).
    await tx.request().input('pid', sql.Int, programaId).input('off', sql.Int, OFFSET_ORDEN)
      .query('UPDATE programa_operaciones SET orden = orden + @off WHERE programa_id=@pid')
    for (const [i, id] of ids.entries()) {
      await tx.request()
        .input('id',    sql.Int, id)
        .input('pid',   sql.Int, programaId)
        .input('orden', sql.Int, i)
        .query('UPDATE programa_operaciones SET orden=@orden WHERE id=@id AND programa_id=@pid')
    }
    // Los que no venían en la lista van después, en el orden que traían: siguen
    // apartados con el desplazamiento, así que se reconocen por él.
    await tx.request()
      .input('pid',  sql.Int, programaId)
      .input('base', sql.Int, ids.length)
      .input('off',  sql.Int, OFFSET_ORDEN)
      .query(`
        WITH restantes AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY orden) - 1 AS pos
          FROM programa_operaciones WHERE programa_id=@pid AND orden >= @off
        )
        UPDATE o SET orden = @base + r.pos
        FROM programa_operaciones o JOIN restantes r ON r.id = o.id`)
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// ─── Celdas ─────────────────────────────────────────────────────────────────

// Reemplaza de golpe lo que se le hace a una pieza a lo largo de todas las
// fases. Llega el renglón completo -las fases que no vienen quedan en blanco-
// porque así es como se edita: se marca y se desmarca sobre la cuadrícula.
export async function setCeldas(
  operacionId: number,
  celdas: { fase_id: number; accion: string }[],
): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request().input('oid', sql.Int, operacionId)
      .query('DELETE FROM programa_operacion_fase WHERE operacion_id=@oid')
    for (const c of celdas) {
      await tx.request()
        .input('oid',    sql.Int,         operacionId)
        .input('fid',    sql.Int,         c.fase_id)
        .input('accion', sql.NVarChar(2), c.accion)
        .query(`
          INSERT INTO programa_operacion_fase (operacion_id, fase_id, accion)
          VALUES (@oid, @fid, @accion)`)
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// Las fases que realmente son de este programa, para no aceptar una celda que
// apunte a la columna de otro modelo.
export async function idsDeFases(programaId: number): Promise<number[]> {
  const pool = await getPool()
  const r = await pool.request().input('pid', sql.Int, programaId)
    .query('SELECT id FROM programa_fases WHERE programa_id=@pid')
  return r.recordset.map((f: { id: number }) => f.id)
}
