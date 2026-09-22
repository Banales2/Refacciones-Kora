// Incidencia: algo que alguien reportó de un vehículo y hay que atender una vez
// (a diferencia del preventivo, que se repite cada ciclo). Es el segundo hijo de
// `pendientes` (ver pendientesRepo) y comparte su id con el padre.
//
// Se cierra con un mantenimiento —uno solo, la base lo impone con un índice
// único filtrado sobre mantenimiento_pendientes— o se cancela, en cuyo caso
// queda el registro pero deja de alertar.
import * as sql from 'mssql'
import { getPool } from '../shared/db'
import * as pendientes from './pendientesRepo'
import { PENDIENTE_COLS, type StatusPendiente } from './pendientesRepo'

export type Severidad     = 'superficial' | 'moderada' | 'grave'
export type StatusIncidencia = StatusPendiente

export interface Incidencia {
  id:            number
  vehiculo_id:   number
  origen:        'incidencia'
  nombre:        string
  descripcion:   string | null
  categoria:     string | null
  status:        StatusIncidencia
  created_at:    string
  updated_at:    string
  // Obligatorios en la base (NOT NULL); la hora sigue siendo opcional porque
  // quien reporta no siempre la sabe.
  reportado_por: string
  severidad:     Severidad
  fecha:         string
  hora:          string | null
  ubicacion:     string
  // Quien detectó el problema (`reportado_por`) rara vez es quien lo da de alta.
  // Registrar la incidencia es autorizarla, así que el autorizador es la cuenta
  // de la sesión: no llega del cliente y no se edita después.
  autorizado_por: string
  // El mantenimiento que la atendió, para poder abrir su detalle desde la
  // incidencia ya cerrada. NULL mientras nadie la haya atendido.
  mantenimiento_id: number | null
  /**
   * De qué pregunta del chequeo diario es esta incidencia, si es de alguna.
   *
   * Es lo que permite que el chequeo de mañana se enganche a esto en vez de
   * abrir una segunda por lo mismo, tanto si la abrió un chequeo como si la
   * capturó alguien a mano. NULL = no corresponde a ningún punto del checklist
   * (un golpe en el taller, una refacción que se pidió), que es el caso normal.
   */
  clave_chequeo: string | null
}

export interface IncidenciaConVehiculo extends Incidencia {
  vehiculo_nombre: string
  vehiculo_tipo:   string
}

export interface IncidenciaCreate {
  vehiculo_id:    number
  nombre:         string
  descripcion?:   string | null
  categoria?:     string | null
  status?:        StatusIncidencia
  reportado_por:  string
  severidad:      Severidad
  fecha:          string
  hora?:          string | null
  ubicacion:      string
  clave_chequeo?: string | null
}

export interface IncidenciaUpdate {
  nombre?:        string
  descripcion?:   string | null
  categoria?:     string | null
  status?:        StatusIncidencia
  reportado_por?: string
  severidad?:     Severidad
  fecha?:         string
  hora?:          string | null
  ubicacion?:     string
  clave_chequeo?: string | null
}

// `hora` se convierte a texto "HH:MM" aquí: el driver devuelve las columnas TIME
// como Date, que al serializarse a JSON sale como "1970-01-01T14:30:00.000Z" y
// obliga al front a desenredar una fecha que no existe.
const HORA_TXT = `CONVERT(varchar(5), i.hora, 108) AS hora`

// Con qué mantenimiento se cerró. La base admite uno solo, pero se ordena de
// todos modos: una columna que depende de qué renglón devuelva el motor primero
// sería distinta en cada consulta.
const MTTO_ATENDIO = `
  (SELECT TOP 1 mp.mantenimiento_id
     FROM mantenimiento_pendientes mp
    WHERE mp.pendiente_id = p.id
    ORDER BY mp.fecha DESC, mp.mantenimiento_id DESC) AS mantenimiento_id`

const SELECT_INC = `
  SELECT ${PENDIENTE_COLS},
         i.reportado_por, i.severidad, i.fecha, ${HORA_TXT}, i.ubicacion,
         i.autorizado_por, i.clave_chequeo, ${MTTO_ATENDIO}
  FROM pendientes p
  JOIN incidencias i ON i.id = p.id`

export async function findByVehiculo(vehiculoId: number): Promise<Incidencia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`${SELECT_INC} WHERE p.vehiculo_id=@vid ORDER BY i.fecha DESC, i.hora DESC`)
  return r.recordset
}

// Para la pantalla de Incidencias, que las lista de toda la flota.
export async function findAllConVehiculo(): Promise<IncidenciaConVehiculo[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT ${PENDIENTE_COLS},
           i.reportado_por, i.severidad, i.fecha, ${HORA_TXT}, i.ubicacion,
           i.autorizado_por, i.clave_chequeo, ${MTTO_ATENDIO},
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
           v.tipo AS vehiculo_tipo
    FROM pendientes p
    JOIN incidencias i ON i.id = p.id
    JOIN vehiculos v   ON v.id = p.vehiculo_id
    JOIN modelos mo    ON mo.id = v.modelo_id
    ORDER BY i.fecha DESC, i.hora DESC
  `)
  return r.recordset
}

// Quiénes han reportado algo alguna vez, para ofrecerlos en el formulario. No
// hay catálogo de empleados: el nombre es texto libre y las repeticiones salen
// de lo ya capturado, igual que las categorías.
export async function findReportadores(): Promise<string[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT DISTINCT reportado_por FROM incidencias
    WHERE LTRIM(RTRIM(reportado_por)) <> ''
    ORDER BY reportado_por
  `)
  return r.recordset.map((row: { reportado_por: string }) => row.reportado_por)
}

export async function findById(id: number): Promise<Incidencia | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_INC} WHERE p.id=@id`)
  return r.recordset[0] ?? null
}

// El alta dentro de una transacción ajena, que devuelve solo el id.
//
// Existe para el chequeo diario: un chequeo con tres fallas abre tres
// incidencias, y las cuatro cosas tienen que guardarse o no guardarse juntas.
// Si `create` abriera su propia transacción, un fallo a la mitad dejaría
// incidencias sin chequeo, o renglones marcados como falla sin la incidencia
// que dicen haber abierto.
//
// Devuelve el id y no la fila porque la fila no se puede leer todavía: dentro
// de una transacción sin confirmar, `findById` —que va por el pool— no la ve.
// Quien la necesite la lee después del commit.
export async function insertEnTx(
  tx: sql.Transaction, data: IncidenciaCreate, autorizadoPor: string
): Promise<number> {
  const id = await pendientes.insert(tx, {
    vehiculo_id: data.vehiculo_id,
    origen:      'incidencia',
    nombre:      data.nombre,
    descripcion: data.descripcion,
    categoria:   data.categoria,
    status:      data.status,
  })
  await tx.request()
    .input('id',        sql.Int,           id)
    .input('reportado', sql.NVarChar(120), data.reportado_por)
    .input('severidad', sql.NVarChar(20),  data.severidad)
    .input('fecha',     sql.Date,          data.fecha)
    .input('hora',      sql.VarChar(8),    data.hora ?? null)
    .input('ubicacion', sql.NVarChar(160), data.ubicacion)
    .input('autoriza',  sql.NVarChar(120), autorizadoPor)
    .input('clave',     sql.VarChar(30),   data.clave_chequeo ?? null)
    .query(`
      INSERT INTO incidencias (id, reportado_por, severidad, fecha, hora, ubicacion, autorizado_por, clave_chequeo)
      VALUES (@id, @reportado, @severidad, @fecha, @hora, @ubicacion, @autoriza, @clave)
    `)
  return id
}

export async function create(data: IncidenciaCreate, autorizadoPor: string): Promise<Incidencia> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  let id: number
  try {
    id = await insertEnTx(tx, data, autorizadoPor)
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return (await findById(id))!
}

// `autorizado_por` no se edita: deja constancia de quién dio de alta —y con eso
// autorizó— la incidencia, no de quién la tocó por última vez.
export async function update(id: number, data: IncidenciaUpdate): Promise<Incidencia | null> {
  const existe = await findById(id)
  if (!existe) return null

  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await pendientes.applyUpdate(tx, id, {
      ...('nombre'      in data ? { nombre:      data.nombre }      : {}),
      ...('descripcion' in data ? { descripcion: data.descripcion } : {}),
      ...('categoria'   in data ? { categoria:   data.categoria }   : {}),
      ...('status'      in data ? { status:      data.status }      : {}),
    })

    const sets: string[] = []
    const req = tx.request().input('id', sql.Int, id)
    // reportado_por y ubicacion son NOT NULL: solo se tocan si vienen con valor,
    // nunca se pueden vaciar desde un update parcial.
    if (data.reportado_por !== undefined) { req.input('reportado', sql.NVarChar(120), data.reportado_por); sets.push('reportado_por=@reportado') }
    if (data.ubicacion     !== undefined) { req.input('ubicacion', sql.NVarChar(160), data.ubicacion);     sets.push('ubicacion=@ubicacion')     }
    if (data.severidad     !== undefined) { req.input('severidad', sql.NVarChar(20),  data.severidad);     sets.push('severidad=@severidad')     }
    if (data.fecha         !== undefined) { req.input('fecha',     sql.Date,          data.fecha);         sets.push('fecha=@fecha')             }
    if ('hora' in data)                   { req.input('hora',      sql.VarChar(8),    data.hora ?? null);  sets.push('hora=@hora')               }
    if ('clave_chequeo' in data)          { req.input('clavech',   sql.VarChar(30),   data.clave_chequeo ?? null); sets.push('clave_chequeo=@clavech') }
    if (sets.length) {
      await req.query(`UPDATE incidencias SET ${sets.join(',')} WHERE id=@id`)
    }

    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return findById(id)
}
