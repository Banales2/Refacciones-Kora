// El chequeo diario de una unidad: la declaración del chofer más el checklist
// de lo que se ve. Uno por unidad por día, y la base lo impone
// (UQ_chequeos_vehiculo_fecha). Ver la migración 038 y `docs/chequeo-diario.md`.
//
// Cabecera (`chequeos`) y renglones (`chequeo_items`) siempre se leen juntos:
// no hay una sola pantalla que quiera una sin los otros, así que el repo nunca
// devuelve la cabecera pelada.
import * as sql from 'mssql'
import { getPool } from '../shared/db'
import * as incidenciasRepo from './incidenciasRepo'
import type { Severidad } from '../shared/chequeoItems'
import { JOINS_HIJAS, NO_DADO_DE_BAJA } from './vehiculosSql'

export type Resultado = 'ok' | 'falla' | 'na'

export interface ChequeoItem {
  clave:        string
  resultado:    Resultado
  /** Solo lo llenan las preguntas que no son de sí o no. Hoy: "3/8" de tanque. */
  valor:        string | null
  nota:         string | null
  /** La incidencia que abrió esta falla, si abrió alguna. */
  pendiente_id: number | null
}

export interface Chequeo {
  id:            number
  vehiculo_id:   number
  fecha:         string
  hora:          string | null
  ubicacion:     string
  conductor_id:  number | null
  conductor:     string | null
  /** El chofer de la unidad. `null` cuando no había ninguno (ver `sin_chofer`). */
  declarado_por: string | null
  /** Quien recorrió el patio y capturó. Lo pone la API con la cuenta de la sesión. */
  revisado_por:  string
  hay_novedad:   boolean
  /**
   * No había chofer a quien preguntarle. Distinto de `hay_novedad = 0`, que es
   * "se le preguntó y no reportó nada". Ver la migración 039.
   */
  sin_chofer:    boolean
  declaracion:   string | null
  lectura:          number | null
  /** El odómetro que traía la unidad al momento del chequeo. Ver la migración. */
  lectura_anterior: number | null
  nota:          string | null
  revisada_en:   string | null
  revisada_por:  string | null
  revision_nota: string | null
  declaracion_pendiente_id: number | null
  created_at:    string
  updated_at:    string
  items:         ChequeoItem[]
}

export interface ChequeoConVehiculo extends Chequeo {
  vehiculo_nombre: string
  vehiculo_tipo:   string
}

export interface ChequeoCabecera {
  vehiculo_id:   number
  fecha:         string
  hora:          string | null
  ubicacion:     string
  conductor_id:  number | null
  declarado_por: string | null
  hay_novedad:   boolean
  sin_chofer:    boolean
  declaracion:   string | null
  lectura:          number | null
  lectura_anterior: number | null
  nota:          string | null
}

/** Un renglón listo para guardarse, ya resuelto qué incidencia abre. */
export interface ItemAGuardar {
  clave:      string
  resultado:  Resultado
  valor:      string | null
  nota:       string | null
  /** Qué incidencia abrir por este renglón. `null` = ninguna. */
  incidencia: {
    nombre:      string
    descripcion: string | null
    categoria:   string | null
    severidad:   Severidad
  } | null
}

// `hora` se convierte a texto "HH:MM" aquí por lo mismo que en incidencias: el
// driver devuelve las columnas TIME como Date, que en JSON sale como una fecha
// de 1970 que el front tendría que desenredar.
const HORA_TXT = `CONVERT(varchar(5), ch.hora, 108) AS hora`

const SELECT_CH = `
  SELECT ch.id, ch.vehiculo_id, ch.fecha, ${HORA_TXT}, ch.ubicacion,
         ch.conductor_id, co.nombre AS conductor,
         ch.declarado_por, ch.revisado_por,
         ch.hay_novedad, ch.sin_chofer, ch.declaracion,
         ch.lectura, ch.lectura_anterior, ch.nota,
         ch.revisada_en, ch.revisada_por, ch.revision_nota,
         ch.declaracion_pendiente_id,
         ch.created_at, ch.updated_at
  FROM chequeos ch
  LEFT JOIN conductores co ON co.id = ch.conductor_id`

// Los renglones de un conjunto de chequeos, en una sola consulta. Traerlos
// chequeo por chequeo convertía la pantalla de flota en treinta consultas.
async function itemsDe(
  exec: sql.ConnectionPool | sql.Transaction, ids: number[]
): Promise<Map<number, ChequeoItem[]>> {
  const porChequeo = new Map<number, ChequeoItem[]>()
  if (ids.length === 0) return porChequeo

  const req = exec.request()
  const params = ids.map((id, i) => { req.input(`c${i}`, sql.Int, id); return `@c${i}` }).join(',')
  const r = await req.query(`
    SELECT chequeo_id, clave, resultado, valor, nota, pendiente_id
    FROM chequeo_items
    WHERE chequeo_id IN (${params})
    ORDER BY chequeo_id, clave
  `)
  for (const row of r.recordset) {
    const lista = porChequeo.get(row.chequeo_id) ?? []
    lista.push({
      clave: row.clave, resultado: row.resultado, valor: row.valor,
      nota: row.nota, pendiente_id: row.pendiente_id,
    })
    porChequeo.set(row.chequeo_id, lista)
  }
  return porChequeo
}

async function conItems<T extends { id: number }>(
  filas: T[]
): Promise<(T & { items: ChequeoItem[] })[]> {
  const pool = await getPool()
  const mapa = await itemsDe(pool, filas.map((f) => f.id))
  return filas.map((f) => ({ ...f, items: mapa.get(f.id) ?? [] }))
}

export async function findById(id: number): Promise<Chequeo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_CH} WHERE ch.id=@id`)
  if (!r.recordset[0]) return null
  return (await conItems(r.recordset))[0]
}

export async function findByVehiculo(vehiculoId: number, limite = 90): Promise<Chequeo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .input('lim', sql.Int, limite)
    .query(`${SELECT_CH} WHERE ch.vehiculo_id=@vid ORDER BY ch.fecha DESC OFFSET 0 ROWS FETCH NEXT @lim ROWS ONLY`)
  return conItems(r.recordset)
}

export async function findDelDia(vehiculoId: number, fecha: string): Promise<Chequeo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid',   sql.Int,  vehiculoId)
    .input('fecha', sql.Date, fecha)
    .query(`${SELECT_CH} WHERE ch.vehiculo_id=@vid AND ch.fecha=@fecha`)
  if (!r.recordset[0]) return null
  return (await conItems(r.recordset))[0]
}

export async function findRango(params: {
  desde: string
  hasta: string
  vehiculoId?: number
  soloPorRevisar?: boolean
}): Promise<ChequeoConVehiculo[]> {
  const pool = await getPool()
  const req = pool.request()
    .input('desde', sql.Date, params.desde)
    .input('hasta', sql.Date, params.hasta)

  let filtro = 'ch.fecha BETWEEN @desde AND @hasta'
  if (params.vehiculoId != null) {
    req.input('vid', sql.Int, params.vehiculoId)
    filtro += ' AND ch.vehiculo_id=@vid'
  }
  if (params.soloPorRevisar) {
    filtro += ' AND ch.hay_novedad=1 AND ch.revisada_en IS NULL'
  }

  const r = await req.query(`
    SELECT ch.id, ch.vehiculo_id, ch.fecha, ${HORA_TXT}, ch.ubicacion,
           ch.conductor_id, co.nombre AS conductor,
           ch.declarado_por, ch.revisado_por,
           ch.hay_novedad, ch.sin_chofer, ch.declaracion,
           ch.lectura, ch.lectura_anterior, ch.nota,
           ch.revisada_en, ch.revisada_por, ch.revision_nota,
           ch.declaracion_pendiente_id,
           ch.created_at, ch.updated_at,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
           v.tipo AS vehiculo_tipo
    FROM chequeos ch
    LEFT JOIN conductores co ON co.id = ch.conductor_id
    JOIN vehiculos v  ON v.id = ch.vehiculo_id
    JOIN modelos   mo ON mo.id = v.modelo_id
    WHERE ${filtro}
    ORDER BY ch.fecha DESC, ch.id DESC
  `)
  return conItems(r.recordset)
}

/**
 * Todos los reportes del chofer que nadie ha leído, sin importar de qué día
 * son. Sin fecha a propósito: la bandeja tiene que vaciarse, no rotar. Un
 * reporte del viernes que nadie revisó desaparecería el sábado si esto
 * preguntara solo por hoy, y entonces el registro de que alguien avisó y nadie
 * hizo nada quedaría enterrado en vez de a la vista.
 *
 * Lo sostiene IX_chequeos_por_revisar, que es un índice filtrado justamente
 * sobre esta condición.
 */
export async function findPorRevisar(): Promise<ChequeoConVehiculo[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT ch.id, ch.vehiculo_id, ch.fecha, ${HORA_TXT}, ch.ubicacion,
           ch.conductor_id, co.nombre AS conductor,
           ch.declarado_por, ch.revisado_por,
           ch.hay_novedad, ch.sin_chofer, ch.declaracion,
           ch.lectura, ch.lectura_anterior, ch.nota,
           ch.revisada_en, ch.revisada_por, ch.revision_nota,
           ch.declaracion_pendiente_id,
           ch.created_at, ch.updated_at,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
           v.tipo AS vehiculo_tipo
    FROM chequeos ch
    LEFT JOIN conductores co ON co.id = ch.conductor_id
    JOIN vehiculos v  ON v.id = ch.vehiculo_id
    JOIN modelos   mo ON mo.id = v.modelo_id
    WHERE ch.hay_novedad = 1 AND ch.revisada_en IS NULL
    ORDER BY ch.fecha ASC, ch.id ASC
  `)
  return conItems(r.recordset)
}

export interface UnidadSinChequeo {
  vehiculo_id: number
  nombre:      string
  tipo:        string
  placas:      string | null
}

export interface UnidadPatio extends UnidadSinChequeo {
  /** El chequeo de hoy de esta unidad, si ya se hizo. */
  chequeo_id: number | null
  /** Para saber si todavía hay algo que atender sin abrir el chequeo. */
  fallas: number
  hay_novedad: boolean
}

/**
 * Las unidades con base en una sucursal, con su chequeo del día si lo tienen.
 *
 * SOLO LAS DE BASE FIJA, y eso es del negocio, no una limitación: el reparto y
 * los montacargas viven en un patio y `sucursal_id` lo dice. Un tractocamión o
 * una caja andan hoy en una sucursal y mañana en otra, así que no hay columna
 * que pueda predecir dónde amanecieron —guardarla sería inventar un dato que
 * cambia solo—. Esas se agregan desde la pantalla, buscándolas: quien recorre
 * el patio las ve porque están enfrente, y su chequeo deja en `ubicacion` dónde
 * se revisó, que es la constancia que sí es cierta.
 *
 * Devuelve también las ya revisadas, no solo las pendientes: quien va a la
 * mitad del recorrido necesita ver qué lleva hecho, y una lista que borra lo
 * revisado deja de decir cuánto falta.
 */
export async function findPatio(sucursalId: number, fecha: string): Promise<UnidadPatio[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('suc',   sql.Int,  sucursalId)
    .input('fecha', sql.Date, fecha)
    .query(`
      SELECT v.id AS vehiculo_id,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS nombre,
             v.tipo, v.placas,
             ch.id AS chequeo_id,
             CAST(ISNULL(ch.hay_novedad, 0) AS bit) AS hay_novedad,
             ISNULL((SELECT COUNT(*) FROM chequeo_items ci
                      WHERE ci.chequeo_id = ch.id AND ci.resultado = 'falla'), 0) AS fallas
      FROM vehiculos v
      JOIN modelos mo ON mo.id = v.modelo_id
      ${JOINS_HIJAS}
      LEFT JOIN chequeos ch ON ch.vehiculo_id = v.id AND ch.fecha = @fecha
      WHERE ${NO_DADO_DE_BAJA}
        AND COALESCE(c.sucursal_id, mc.sucursal_id) = @suc
      ORDER BY CASE WHEN ch.id IS NULL THEN 0 ELSE 1 END, nombre
    `)
  return r.recordset
}

/**
 * Las unidades que hoy se revisaron en esta sucursal sin tener base aquí: las
 * itinerantes y las prestadas de otro patio. Salen del chequeo y no del padrón,
 * porque la única forma de saber que una caja amaneció aquí es que alguien la
 * haya revisado aquí.
 *
 * El cruce es por `ubicacion` exacta, que es texto libre y en general no sería
 * de fiar. Aquí sí lo es porque la pantalla de patio escribe el nombre de la
 * sucursal tal cual, sin dejar teclearlo: es la condición de la que depende
 * esta consulta, y por eso el campo va bloqueado en ese modo.
 */
export async function findVisitantes(
  sucursalId: number, sucursalNombre: string, fecha: string
): Promise<UnidadPatio[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('suc',   sql.Int, sucursalId)
    .input('ubic',  sql.NVarChar(160), sucursalNombre)
    .input('fecha', sql.Date, fecha)
    .query(`
      SELECT v.id AS vehiculo_id,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS nombre,
             v.tipo, v.placas,
             ch.id AS chequeo_id,
             CAST(ch.hay_novedad AS bit) AS hay_novedad,
             (SELECT COUNT(*) FROM chequeo_items ci
               WHERE ci.chequeo_id = ch.id AND ci.resultado = 'falla') AS fallas
      FROM chequeos ch
      JOIN vehiculos v  ON v.id = ch.vehiculo_id
      JOIN modelos   mo ON mo.id = v.modelo_id
      ${JOINS_HIJAS}
      WHERE ch.fecha = @fecha
        AND ch.ubicacion = @ubic
        -- Las de base aquí ya salen en la otra lista; esta es para lo demás,
        -- traiga o no sucursal propia.
        AND ISNULL(COALESCE(c.sucursal_id, mc.sucursal_id), -1) <> @suc
      ORDER BY nombre
    `)
  return r.recordset
}

/**
 * Las unidades activas que no tienen chequeo de esa fecha. Es la cifra del
 * tablero, y la razón de ser del índice único: sin él, "faltan" no se podría
 * contestar sin decidir antes cuál de los dos chequeos del día vale.
 *
 * Las dadas de baja quedan fuera, como en todos los avisos (NO_DADO_DE_BAJA).
 */
export async function findSinChequeo(fecha: string): Promise<UnidadSinChequeo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('fecha', sql.Date, fecha)
    .query(`
      SELECT v.id AS vehiculo_id,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS nombre,
             v.tipo, v.placas
      FROM vehiculos v
      JOIN modelos mo ON mo.id = v.modelo_id
      ${JOINS_HIJAS}
      WHERE ${NO_DADO_DE_BAJA}
        AND NOT EXISTS (
          SELECT 1 FROM chequeos ch
          WHERE ch.vehiculo_id = v.id AND ch.fecha = @fecha
        )
      ORDER BY nombre
    `)
  return r.recordset
}

/** Cuántas unidades activas hay, para el denominador de la cobertura. */
export async function contarActivas(): Promise<number> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT COUNT(*) AS total
    FROM vehiculos v
    ${JOINS_HIJAS}
    WHERE ${NO_DADO_DE_BAJA}
  `)
  return r.recordset[0]?.total ?? 0
}

/** Los nombres con los que ya se ha declarado, para sugerirlos en el formulario. */
export async function findDeclarantes(): Promise<string[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT DISTINCT declarado_por FROM chequeos ORDER BY declarado_por
  `)
  return r.recordset.map((row: { declarado_por: string }) => row.declarado_por)
}

async function insertarItems(
  tx: sql.Transaction, chequeoId: number, vehiculoId: number,
  items: ItemAGuardar[], cabecera: ChequeoCabecera, revisadoPor: string,
): Promise<void> {
  for (const item of items) {
    // La incidencia primero: su id es lo que amarra el renglón con lo que hay
    // que atender. Va en la misma transacción, así que un fallo aquí deshace el
    // chequeo entero en vez de dejar una falla que dice haber abierto algo que
    // no existe.
    let pendienteId: number | null = null
    if (item.incidencia) {
      pendienteId = await incidenciasRepo.insertEnTx(tx, {
        vehiculo_id:   vehiculoId,
        nombre:        item.incidencia.nombre,
        descripcion:   item.incidencia.descripcion,
        categoria:     item.incidencia.categoria,
        // Quien reporta una falla del checklist es QUIEN RECORRE, no el chofer:
        // el checklist es lo que se ve, y el que lo ve es el que está dando la
        // vuelta a la unidad. Atribuírselo al chofer pondría su nombre en un
        // hallazgo que él no hizo —y dejaría la falla sin reportante en las
        // unidades que se revisan sin chofer presente, donde `declarado_por` es
        // NULL e `incidencias.reportado_por` es NOT NULL.
        reportado_por: revisadoPor,
        severidad:     item.incidencia.severidad,
        fecha:         cabecera.fecha,
        hora:          cabecera.hora,
        ubicacion:     cabecera.ubicacion,
      }, revisadoPor)
    }

    await tx.request()
      .input('ch',        sql.Int,           chequeoId)
      .input('clave',     sql.VarChar(30),   item.clave)
      .input('resultado', sql.VarChar(10),   item.resultado)
      .input('valor',     sql.VarChar(10),   item.valor)
      .input('nota',      sql.NVarChar(200), item.nota)
      .input('pend',      sql.Int,           pendienteId)
      .query(`
        INSERT INTO chequeo_items (chequeo_id, clave, resultado, valor, nota, pendiente_id)
        VALUES (@ch, @clave, @resultado, @valor, @nota, @pend)
      `)
  }
}

export async function create(
  cabecera: ChequeoCabecera, items: ItemAGuardar[], revisadoPor: string
): Promise<Chequeo> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  let id: number
  try {
    const r = await tx.request()
      .input('vid',       sql.Int,           cabecera.vehiculo_id)
      .input('fecha',     sql.Date,          cabecera.fecha)
      .input('hora',      sql.VarChar(8),    cabecera.hora)
      .input('ubicacion', sql.NVarChar(160), cabecera.ubicacion)
      .input('cond',      sql.Int,           cabecera.conductor_id)
      .input('declara',   sql.NVarChar(120), cabecera.declarado_por)
      .input('revisa',    sql.NVarChar(120), revisadoPor)
      .input('novedad',   sql.Bit,           cabecera.hay_novedad)
      .input('sinchofer', sql.Bit,           cabecera.sin_chofer)
      .input('declarac',  sql.NVarChar(500), cabecera.declaracion)
      .input('lectura',   sql.Int,           cabecera.lectura)
      .input('anterior',  sql.Int,           cabecera.lectura_anterior)
      .input('nota',      sql.NVarChar(255), cabecera.nota)
      .query(`
        INSERT INTO chequeos (
          vehiculo_id, fecha, hora, ubicacion, conductor_id,
          declarado_por, revisado_por, hay_novedad, sin_chofer, declaracion,
          lectura, lectura_anterior, nota
        )
        OUTPUT INSERTED.id
        VALUES (
          @vid, @fecha, @hora, @ubicacion, @cond,
          @declara, @revisa, @novedad, @sinchofer, @declarac,
          @lectura, @anterior, @nota
        )
      `)
    id = r.recordset[0].id
    await insertarItems(tx, id, cabecera.vehiculo_id, items, cabecera, revisadoPor)
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return (await findById(id))!
}

/**
 * Corrige el chequeo del día. Los renglones se reemplazan completos cuando
 * vienen: mandarlos por diferencia obligaría a adivinar si una pregunta ausente
 * es "sin cambio" o "quítala".
 *
 * Las incidencias que ya se abrieron NO se tocan al corregir. Si el renglón
 * dejó de ser falla, la incidencia queda viva y se cancela desde Incidencias:
 * borrarla aquí desharía el trabajo de quien ya la hubiera atendido, y el
 * sistema no borra entidades (ver `docs/sin-delete.md`). Las que aparezcan por
 * fallas nuevas sí se abren.
 */
export async function update(
  id: number,
  cabecera: Partial<ChequeoCabecera>,
  items: ItemAGuardar[] | undefined,
  revisadoPor: string,
): Promise<Chequeo | null> {
  const actual = await findById(id)
  if (!actual) return null

  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    // Mismo trato que `pendientesRepo.applyUpdate`: solo se tocan los campos
    // presentes, y `updated_at` se refresca siempre.
    const sets: string[] = ['updated_at=SYSDATETIME()']
    const req = tx.request().input('id', sql.Int, id)

    if (cabecera.hora          !== undefined) { req.input('hora',     sql.VarChar(8),    cabecera.hora);          sets.push('hora=@hora')                   }
    if (cabecera.ubicacion     !== undefined) { req.input('ubic',     sql.NVarChar(160), cabecera.ubicacion);     sets.push('ubicacion=@ubic')              }
    if (cabecera.conductor_id  !== undefined) { req.input('cond',     sql.Int,           cabecera.conductor_id);  sets.push('conductor_id=@cond')           }
    if (cabecera.declarado_por !== undefined) { req.input('declara',  sql.NVarChar(120), cabecera.declarado_por); sets.push('declarado_por=@declara')       }
    if (cabecera.hay_novedad   !== undefined) { req.input('novedad',  sql.Bit,           cabecera.hay_novedad);   sets.push('hay_novedad=@novedad')         }
    if (cabecera.sin_chofer    !== undefined) { req.input('sinchof',  sql.Bit,           cabecera.sin_chofer);    sets.push('sin_chofer=@sinchof')          }
    if (cabecera.declaracion   !== undefined) { req.input('declarac', sql.NVarChar(500), cabecera.declaracion);   sets.push('declaracion=@declarac')        }
    if (cabecera.lectura       !== undefined) { req.input('lectura',  sql.Int,           cabecera.lectura);       sets.push('lectura=@lectura')             }
    if (cabecera.nota          !== undefined) { req.input('nota',     sql.NVarChar(255), cabecera.nota);          sets.push('nota=@nota')                   }

    await req.query(`UPDATE chequeos SET ${sets.join(',')} WHERE id=@id`)

    if (items) {
      // Los renglones que ya abrieron incidencia se conservan tal cual: su
      // `pendiente_id` es la única liga con lo que hay que atender, y volver a
      // insertarlos abriría una incidencia duplicada por cada corrección.
      const conIncidencia = new Set(
        actual.items.filter((i) => i.pendiente_id != null).map((i) => i.clave)
      )
      const claves = items.map((i) => i.clave).filter((c) => !conIncidencia.has(c))

      const del = tx.request().input('id', sql.Int, id)
      const noBorrar = [...conIncidencia]
      const params = noBorrar.map((c, i) => { del.input(`k${i}`, sql.VarChar(30), c); return `@k${i}` })
      await del.query(`
        DELETE FROM chequeo_items
        WHERE chequeo_id=@id ${params.length ? `AND clave NOT IN (${params.join(',')})` : ''}
      `)

      const nuevos = items.filter((i) => claves.includes(i.clave))
      // Los campos ausentes se quitan antes de mezclar: un `hora: undefined` o
      // un `declarado_por: undefined` del payload pisarían el valor guardado al
      // hacer el spread, y `declarado_por` acaba siendo el `reportado_por` de
      // una incidencia, que es NOT NULL.
      const presentes = Object.fromEntries(
        Object.entries(cabecera).filter(([, v]) => v !== undefined)
      )
      await insertarItems(
        tx, id, actual.vehiculo_id, nuevos,
        { ...actual, ...presentes } as ChequeoCabecera, revisadoPor
      )
    }

    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return findById(id)
}

/**
 * Deja constancia de que alguien leyó la declaración, y abre la incidencia si
 * quien revisó decidió abrirla. Las dos salidas cuentan como revisada: lo que
 * no puede quedar es una declaración que nadie leyó.
 *
 * Va en una transacción por la misma razón que el alta: si la incidencia se
 * creara aparte y el marcado fallara, quedaría una incidencia huérfana y la
 * declaración seguiría apareciendo en la bandeja, así que alguien la revisaría
 * otra vez y abriría la segunda.
 */
export async function revisar(
  chequeo: Chequeo,
  revisadaPor: string,
  nota: string | null,
  incidencia: { severidad: Severidad; categoria: string | null } | null,
): Promise<void> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    let pendienteId: number | null = null
    if (incidencia) {
      pendienteId = await incidenciasRepo.insertEnTx(tx, {
        vehiculo_id: chequeo.vehiculo_id,
        // El nombre de la incidencia cabe en 40 caracteres y la declaración en
        // 500: el texto completo va en la descripción, que es donde se lee.
        nombre:        'Reporte del chofer',
        descripcion:   chequeo.declaracion,
        categoria:     incidencia.categoria,
        // Aquí `declarado_por` nunca es null, y no por suerte: solo se llega
        // con `hay_novedad = 1`, y CK_chequeos_declaracion_v2 obliga a que eso
        // implique `sin_chofer = 0`, que a su vez obliga a que haya nombre.
        // (`strict` está apagado en este proyecto, así que el compilador no lo
        // verificaría por su cuenta.)
        reportado_por: chequeo.declarado_por!,
        severidad:     incidencia.severidad,
        fecha:         chequeo.fecha,
        hora:          chequeo.hora,
        ubicacion:     chequeo.ubicacion,
      }, revisadaPor)
    }

    await tx.request()
      .input('id',    sql.Int,           chequeo.id)
      .input('quien', sql.NVarChar(120), revisadaPor)
      .input('nota',  sql.NVarChar(255), nota)
      .input('pend',  sql.Int,           pendienteId)
      .query(`
        UPDATE chequeos
        SET revisada_en = SYSDATETIME(), revisada_por = @quien, revision_nota = @nota,
            declaracion_pendiente_id = COALESCE(@pend, declaracion_pendiente_id),
            updated_at = SYSDATETIME()
        WHERE id = @id
      `)
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
