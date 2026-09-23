import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { Alcance, SIN_ACOTAR, conAlcance } from '../shared/alcance'
import { Pieza, PiezaConCantidad, LoteConProveedor } from '../types/domain'
import { RefaccionCreate, RefaccionUpdate, SearchBy, MARCA_FALTANTE } from '../schemas/refaccionSchema'
import { disponibleDelLote } from './inventarioSql'
import { COLS_ARCHIVADO, filtroArchivado } from './archivadoRepo'
import { colsCabecera, fechaDelLote, joinFactura, joinProveedorDelLote } from './facturaSql'

export async function findAll(params: {
  offset: number
  pageSize: number
  search?: string
  searchBy?: SearchBy
  /** La pantalla del catálogo los pide para poder restaurarlos. */
  incluirArchivados?: boolean
}, alcance: Alcance = SIN_ACOTAR): Promise<{ data: PiezaConCantidad[]; total: number }> {
  const pool = await getPool()
  const req = conAlcance(pool.request(), alcance)
    .input('offset', params.offset)
    .input('pageSize', params.pageSize)

  // Las dos consultas —la página y el total— filtran por lo mismo, así que
  // comparten condiciones y alias. El tipo obliga a que el conteo también
  // traiga el join del catálogo: `tipo_pieza` no es una columna de `piezas`,
  // vive en `tipos_pieza` y solo existe a través de él.
  const conds: string[] = []
  const archivado = filtroArchivado(params.incluirArchivados ?? false)
  if (archivado) conds.push(`p.${archivado}`)

  if (params.search) {
    req.input('search', `%${params.search}%`)
    if (params.searchBy === 'numero_serie') {
      conds.push('p.numero_serie LIKE @search')
    } else if (params.searchBy === 'descripcion') {
      conds.push('p.descripcion LIKE @search')
    } else if (params.searchBy === 'tipo_pieza') {
      conds.push('t.nombre LIKE @search')
    } else if (params.searchBy === 'marca') {
      conds.push('p.marca LIKE @search')
    } else {
      conds.push(
        '(p.numero_serie LIKE @search OR p.descripcion LIKE @search' +
        ' OR t.nombre LIKE @search OR p.marca LIKE @search)'
      )
    }
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const result = await req.query(`
    SELECT
      p.id, p.numero_serie, p.descripcion, p.marca,
      p.tipo_pieza_id, t.nombre AS tipo_pieza,
      CONVERT(char(10), p.archivado_en, 23) AS archivado_en, p.archivado_motivo,
      COALESCE(SUM(ex.cantidad), 0) AS cantidad_total
    FROM piezas p
    LEFT JOIN tipos_pieza t ON t.id = p.tipo_pieza_id
    LEFT JOIN lotes_pieza l ON l.pieza_id = p.id
    -- El stock sale de las existencias por sucursal, no de la columna del lote
    -- (migración 002). Un lote sin existencias no suma nada. Quien está
    -- acotado a una sucursal ve sólo lo que hay en la suya (shared/alcance.ts).
    LEFT JOIN existencias_lote ex ON ex.lote_id = l.id
                                 AND (@alcance IS NULL OR ex.sucursal_id = @alcance)
    ${where}
    GROUP BY p.id, p.numero_serie, p.descripcion, p.marca, p.tipo_pieza_id,
             t.nombre, p.archivado_en, p.archivado_motivo
    -- Las piezas sin tipo al final: el CASE evita que los NULL se ordenen
    -- primero, como hace SQL Server por defecto.
    ORDER BY CASE WHEN t.nombre IS NULL THEN 1 ELSE 0 END, t.nombre, p.numero_serie
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(*) AS total
    FROM piezas p
    LEFT JOIN tipos_pieza t ON t.id = p.tipo_pieza_id
    ${where};
  `)
  return { data: result.recordsets[0], total: result.recordsets[1][0].total }
}

// Las marcas ya capturadas, para ofrecerlas en el formulario. No hay catálogo
// de marcas: el nombre es texto libre y las repeticiones salen de lo ya
// capturado, igual que los reportadores de incidencias.
//
// El centinela no se ofrece: sugerir 'Marca Faltante' sería invitar a dejar la
// refacción nueva sin marca con un clic, que es justo lo que hay que dejar de
// hacer. Quien no la sepa lo escribe.
export async function findMarcas(): Promise<string[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('faltante', sql.NVarChar(80), MARCA_FALTANTE)
    .query(`
      SELECT DISTINCT marca FROM piezas
      WHERE LTRIM(RTRIM(marca)) <> '' AND marca <> @faltante
      ORDER BY marca
    `)
  return r.recordset.map((row: { marca: string }) => row.marca)
}

// tipo_pieza viene del catálogo, no de la tabla: se lee siempre con el join.
const SELECT_PIEZA = `
  SELECT p.id, p.numero_serie, p.descripcion, p.marca,
         p.tipo_pieza_id, t.nombre AS tipo_pieza,
         CONVERT(char(10), p.archivado_en, 23) AS archivado_en, p.archivado_motivo
  FROM piezas p
  LEFT JOIN tipos_pieza t ON t.id = p.tipo_pieza_id`

export async function findById(id: number): Promise<Pieza | null> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`${SELECT_PIEZA} WHERE p.id = @id`)
  return result.recordset[0] ?? null
}

export async function findByNumeroSerie(numeroSerie: string): Promise<Pieza | null> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('ns', sql.NVarChar(80), numeroSerie)
    .query(`${SELECT_PIEZA} WHERE p.numero_serie = @ns`)
  return result.recordset[0] ?? null
}

export async function findLotesByPiezaId(piezaId: number): Promise<LoteConProveedor[]> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('piezaId', sql.Int, piezaId)
    .query(`
      SELECT
        l.id, l.pieza_id, l.costo_unitario, l.factura_id,
        l.cantidad_inicial, ${disponibleDelLote('l')} AS cantidad_disponible,
        l.sucursal_id,
        ${colsCabecera()},
        pr.nombre AS proveedor, s.nombre AS sucursal
      FROM lotes_pieza l
      ${joinFactura()}
      -- LEFT: el lote de recuperación va sin factura ni proveedor (024 y 026).
      ${joinProveedorDelLote()}
      LEFT JOIN sucursales s ON s.id = l.sucursal_id
      WHERE l.pieza_id = @piezaId
      ORDER BY ${fechaDelLote()} DESC
    `)
  return result.recordset
}

export async function create(data: RefaccionCreate): Promise<Pieza> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('ns', sql.NVarChar(80), data.numero_serie)
    .input('desc', sql.NVarChar(300), data.descripcion)
    .input('marca', sql.NVarChar(80), data.marca)
    .input('tipoPiezaId', sql.Int, data.tipo_pieza_id)
    .query(`
      INSERT INTO piezas (numero_serie, descripcion, marca, tipo_pieza_id)
      OUTPUT INSERTED.id
      VALUES (@ns, @desc, @marca, @tipoPiezaId)
    `)
  // Relee para resolver el nombre del tipo, que OUTPUT no puede traer del join.
  return (await findById(result.recordset[0].id))!
}

export async function update(id: number, data: RefaccionUpdate): Promise<Pieza | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)

  if (data.numero_serie !== undefined) { req.input('ns', sql.NVarChar(80), data.numero_serie); sets.push('numero_serie = @ns') }
  if (data.descripcion !== undefined) { req.input('desc', sql.NVarChar(300), data.descripcion); sets.push('descripcion = @desc') }
  if (data.marca !== undefined) { req.input('marca', sql.NVarChar(80), data.marca); sets.push('marca = @marca') }
  if (data.tipo_pieza_id !== undefined) { req.input('tipoPiezaId', sql.Int, data.tipo_pieza_id); sets.push('tipo_pieza_id = @tipoPiezaId') }

  if (sets.length === 0) return findById(id)

  const result = await req.query(`
    UPDATE piezas SET ${sets.join(', ')}
    OUTPUT INSERTED.id
    WHERE id = @id
  `)
  if (result.recordset.length === 0) return null
  return findById(id)
}

// Lotes de esta pieza que ya se consumieron en algún mantenimiento. Son los
// que impiden borrarla: el detalle del mantenimiento los referencia y borrarlos
// falsearía un gasto ya registrado.
// Renglones de la bitácora que apuntan a esta pieza, incluidos los ya cerrados.
// Impiden borrarla: el historial dice qué se montó en cada vehículo y cuánto
// duró, y sin la pieza esos renglones no se pueden leer. El FK lo bloquearía de
// todas formas; contarlo aquí permite responder con un mensaje en lugar de con
// un error de SQL.
// Arrastra los lotes de compra: son parte de la pieza, no registros propios, y
// dejarlos sueltos no tendría sentido. Los que ya se usaron en un mantenimiento
// se descartan antes, en el service.
