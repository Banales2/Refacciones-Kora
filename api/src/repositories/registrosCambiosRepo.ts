import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface RegistroCambio {
  id:             number
  fecha_hora:     string
  usuario_email:  string
  usuario_nombre: string | null
  accion:         string
  tabla:          string
  registro_id:    string | null
  descripcion:    string | null
  detalles:       unknown
  ip:             string | null
}

export interface Filtros {
  usuario?: string
  accion?:  string
  tabla?:   string
  /** Límites ya convertidos a UTC por el servicio. */
  desde?:   Date
  hasta?:   Date
  texto?:   string
  pagina:   number
  tamano:   number
}

function condiciones(req: sql.Request, f: Filtros): string {
  const donde: string[] = []

  if (f.usuario) {
    req.input('usuario', sql.NVarChar(255), f.usuario)
    donde.push('usuario_email = @usuario')
  }
  if (f.accion) {
    req.input('accion', sql.NVarChar(20), f.accion)
    donde.push('accion = @accion')
  }
  if (f.tabla) {
    req.input('tabla', sql.NVarChar(80), f.tabla)
    donde.push('tabla = @tabla')
  }
  if (f.desde) {
    req.input('desde', sql.DateTime2, f.desde)
    donde.push('fecha_hora >= @desde')
  }
  if (f.hasta) {
    req.input('hasta', sql.DateTime2, f.hasta)
    donde.push('fecha_hora < @hasta')
  }
  if (f.texto) {
    // Busca en la frase legible y en el id, que es lo que se ve en pantalla.
    // El JSON de detalles queda fuera a propósito: haría el LIKE varias veces
    // más caro para encontrar, casi siempre, lo mismo.
    req.input('texto', sql.NVarChar(200), `%${f.texto}%`)
    donde.push('(descripcion LIKE @texto OR registro_id LIKE @texto OR usuario_nombre LIKE @texto)')
  }

  return donde.length ? `WHERE ${donde.join(' AND ')}` : ''
}

export async function buscar(f: Filtros): Promise<{ data: RegistroCambio[]; total: number }> {
  const pool = await getPool()

  const reqDatos = pool.request()
  const where = condiciones(reqDatos, f)

  const r = await reqDatos
    .input('salto', sql.Int, (f.pagina - 1) * f.tamano)
    .input('tomar', sql.Int, f.tamano)
    .query(`
      SELECT id, fecha_hora, usuario_email, usuario_nombre, accion, tabla,
             registro_id, descripcion, detalles, ip
      FROM registros_cambios
      ${where}
      ORDER BY fecha_hora DESC, id DESC
      OFFSET @salto ROWS FETCH NEXT @tomar ROWS ONLY`)

  // Segunda consulta en lugar de COUNT(*) OVER(): con el mismo WHERE, el COUNT
  // se resuelve por índice y no obliga a materializar todas las filas de la
  // página para arrastrar el total en cada una.
  const reqTotal = pool.request()
  const whereTotal = condiciones(reqTotal, f)
  const t = await reqTotal.query(`SELECT COUNT(*) AS total FROM registros_cambios ${whereTotal}`)

  return {
    data: r.recordset.map((row) => ({
      ...row,
      fecha_hora: (row.fecha_hora as Date).toISOString(),
      detalles: parsear(row.detalles),
    })),
    total: t.recordset[0].total as number,
  }
}

// El JSON lo escribió esta misma aplicación, pero una fila corrupta no debe
// tumbar la pantalla entera: se devuelve null y el resto del registro se ve.
function parsear(valor: unknown): unknown {
  if (typeof valor !== 'string') return null
  try {
    return JSON.parse(valor)
  } catch {
    return null
  }
}

/** Valores presentes en la bitácora, para poblar los desplegables de filtro. */
export async function opciones(): Promise<{
  usuarios: { email: string; nombre: string | null }[]
  tablas: string[]
}> {
  const pool = await getPool()
  const u = await pool.request().query(`
    SELECT usuario_email AS email, MAX(usuario_nombre) AS nombre
    FROM registros_cambios
    GROUP BY usuario_email
    ORDER BY usuario_email`)
  const t = await pool.request().query(`
    SELECT DISTINCT tabla FROM registros_cambios ORDER BY tabla`)
  return {
    usuarios: u.recordset,
    tablas: t.recordset.map((r) => r.tabla as string),
  }
}
