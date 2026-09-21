import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { COLS_ARCHIVADO, filtroArchivado, type CamposArchivado } from './archivadoRepo'

export interface Tecnico extends CamposArchivado {
  id:        number
  nombre:    string
  ubicacion: string
  contacto:  string | null
}

const COLS = `id, nombre, ubicacion, contacto, ${COLS_ARCHIVADO}`
const OUT  = 'INSERTED.id, INSERTED.nombre, INSERTED.ubicacion, INSERTED.contacto, ' +
             'INSERTED.archivado_en, INSERTED.archivado_motivo'

// Por defecto solo lo que está en uso; `incluirArchivados` es para la pantalla
// del catálogo, que necesita verlos para poder restaurarlos.
export async function findAll(incluirArchivados = false): Promise<Tecnico[]> {
  const pool = await getPool()
  const filtro = filtroArchivado(incluirArchivados)
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM tecnicos ${filtro ? `WHERE ${filtro}` : ''} ORDER BY nombre`)
  return r.recordset
}

export async function findById(id: number): Promise<Tecnico | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM tecnicos WHERE id = @id`)
  return r.recordset[0] ?? null
}

export async function create(
  nombre: string, ubicacion: string, contacto: string | null
): Promise<Tecnico> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre',    sql.NVarChar(40),  nombre)
    .input('ubicacion', sql.NVarChar(100), ubicacion)
    .input('contacto',  sql.NVarChar(40),  contacto ?? null)
    .query(`
      INSERT INTO tecnicos (nombre, ubicacion, contacto)
      OUTPUT ${OUT}
      VALUES (@nombre, @ubicacion, @contacto)`)
  return r.recordset[0]
}

export async function update(
  id: number, nombre?: string, ubicacion?: string, contacto?: string | null
): Promise<Tecnico | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (nombre    !== undefined) { req.input('nombre',    sql.NVarChar(40),  nombre);            sets.push('nombre=@nombre')       }
  if (ubicacion !== undefined) { req.input('ubicacion', sql.NVarChar(100), ubicacion);         sets.push('ubicacion=@ubicacion') }
  if (contacto  !== undefined) { req.input('contacto',  sql.NVarChar(40),  contacto ?? null);  sets.push('contacto=@contacto')   }
  if (!sets.length) return findById(id)
  const r = await req.query(
    `UPDATE tecnicos SET ${sets.join(',')}
     OUTPUT ${OUT}
     WHERE id=@id`
  )
  return r.recordset[0] ?? null
}

/**
 * El proveedor con el que este taller factura, creándolo la primera vez.
 *
 * QUÉ PROBLEMA RESUELVE. Quien hace el trabajo vive aquí y quien emite facturas
 * vive en `proveedores`; la llave de una factura es (proveedor_id, folio) y no
 * puede dejar de serlo, porque el taller cobra refacciones y mano de obra en el
 * MISMO papel y ese papel es una sola fila de `facturas`. Pedirle al usuario que
 * dé de alta su taller otra vez como proveedor sería cobrarle el precio de una
 * decisión del modelo, así que el puente se resuelve aquí y la pantalla sigue
 * diciendo "taller". Ver `db/migrations/046_facturas_de_mantenimiento.sql`.
 *
 * SE GUARDA, NO SE VUELVE A ADIVINAR. Una vez escrito `proveedor_id`, es el
 * vínculo: si mañana alguien le cambia el nombre al taller o al proveedor, las
 * facturas viejas siguen siendo suyas.
 *
 * LA PRIMERA VEZ SÍ MIRA EL NOMBRE, y conviene decir por qué se admite aquí lo
 * que en el cuadre se rechaza. Es una coincidencia EXACTA, no un parecido, y su
 * resultado queda guardado y a la vista: si el taller ya estaba dado de alta
 * como proveedor —lo normal cuando a ese mismo taller ya se le compraron
 * refacciones—, reusarlo es lo correcto y crear un duplicado sería el error. Lo
 * que no se hace nunca es casar por aproximación: dos nombres escritos distinto
 * son dos empresas hasta que alguien diga lo contrario.
 */
export async function proveedorDeTaller(tecnicoId: number): Promise<number | null> {
  const pool = await getPool()

  const existente = await pool.request()
    .input('id', sql.Int, tecnicoId)
    .query('SELECT id, nombre, proveedor_id, contacto FROM tecnicos WHERE id = @id')
  const taller = existente.recordset[0]
  if (!taller) return null
  if (taller.proveedor_id !== null) return taller.proveedor_id as number

  const tx = pool.transaction()
  await tx.begin()
  try {
    // El de nombre idéntico, si ya existe. Es el mismo taller al que ya se le
    // compraban refacciones, y su factura mixta tiene que caer en una sola fila.
    const mismo = await tx.request()
      .input('nombre', sql.NVarChar(100), taller.nombre)
      .query('SELECT TOP 1 id FROM proveedores WHERE nombre = @nombre ORDER BY id')

    let proveedorId = mismo.recordset[0]?.id as number | undefined

    if (proveedorId === undefined) {
      const creado = await tx.request()
        .input('nombre',   sql.NVarChar(100), taller.nombre)
        .input('contacto', sql.NVarChar(100), taller.contacto ?? null)
        .query(`
          INSERT INTO proveedores (nombre, contacto, telefono)
          OUTPUT INSERTED.id
          VALUES (@nombre, @contacto, NULL)`)
      proveedorId = creado.recordset[0].id as number
    }

    // Solo si sigue sin vínculo: dos facturas capturadas a la vez para el mismo
    // taller entrarían las dos por aquí, y la segunda tiene que quedarse con lo
    // que escribió la primera en vez de pisarlo.
    await tx.request()
      .input('id', sql.Int, tecnicoId)
      .input('pv', sql.Int, proveedorId)
      .query('UPDATE tecnicos SET proveedor_id = @pv WHERE id = @id AND proveedor_id IS NULL')

    await tx.commit()

    const final = await pool.request()
      .input('id', sql.Int, tecnicoId)
      .query('SELECT proveedor_id FROM tecnicos WHERE id = @id')
    return final.recordset[0]?.proveedor_id ?? proveedorId
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * El proveedor con el que este taller factura, o `null` si todavía no ha
 * facturado nada.
 *
 * Es la versión de solo lectura de `proveedorDeTaller`, y existe separada a
 * propósito: aquella CREA el proveedor si hace falta, y consultarlo —enseñar las
 * facturas de un taller, por ejemplo— no puede tener el efecto de dar de alta
 * un proveedor que nadie pidió. Un taller sin facturas no tiene proveedor, y esa
 * es la respuesta correcta.
 */
export async function proveedorVinculado(tecnicoId: number): Promise<number | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, tecnicoId)
    .query('SELECT proveedor_id FROM tecnicos WHERE id = @id')
  return r.recordset[0]?.proveedor_id ?? null
}

/** El taller que factura con ese proveedor, si es el reflejo de alguno. */
export async function tallerDeProveedor(
  proveedorId: number,
): Promise<{ id: number; nombre: string } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('pv', sql.Int, proveedorId)
    .query('SELECT id, nombre FROM tecnicos WHERE proveedor_id = @pv')
  return r.recordset[0] ?? null
}

// ¿Ya existe un técnico con este nombre? exceptId excluye el propio al editar.
export async function existsNombre(nombre: string, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre', sql.NVarChar(40), nombre)
    .input('except', sql.Int,          exceptId ?? null)
    .query('SELECT TOP 1 id FROM tecnicos WHERE nombre = @nombre AND (@except IS NULL OR id <> @except)')
  return r.recordset.length > 0
}

