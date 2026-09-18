import * as sql from 'mssql'
import { getPool } from '../shared/db'

// La revisión de una factura contra su papel.
//
// Quien captura no es quien verifica. Este repositorio guarda las tres cosas que
// esa segunda pasada produce: el sello de lo ya verificado, lo que hubo que
// corregir, y cuánto dinero valía cada error.
//
// EL SELLO VA EN EL RENGLÓN. `lotes_pieza.revisado_en` es lo que de verdad
// avanza; la factura solo sella su cabecera. Que una factura esté "cerrada" es
// un dato DERIVADO —cabecera sellada y ningún renglón pendiente— y por eso no
// se guarda en ninguna columna: en cuanto alguien agregara un renglón, esa
// columna estaría mintiendo. Ver `db/migrations/040_revision_de_facturas.sql`.

/** Un campo que el verificador corrigió, listo para guardarse. */
export interface Correccion {
  /** NULL = la corrección fue de la cabecera, que no pertenece a ningún renglón. */
  lote_id: number | null
  campo: string
  valor_antes: string | null
  valor_despues: string | null
  /** Quién había capturado el dato mal. Se copia, no se referencia. */
  capturado_por: string | null
  /** Diferencia que provocó en el TOTAL de la factura, ya con descuento e IVA. */
  delta_dinero: number
}

export interface RenglonParaRevision {
  lote_id: number
  factura_id: number | null
  costo_unitario: number
  cantidad_inicial: number
  capturado_por: string | null
  revisado_en: Date | null
  /** Los dos porcentajes de la cabecera: sin ellos no se puede poner precio al error. */
  tasa_iva: number | null
  descuento_pct: number | null
}

/** Lo que hace falta saber de un renglón para revisarlo y costear sus errores. */
export async function leerRenglon(loteId: number): Promise<RenglonParaRevision | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, loteId)
    .query(`
      SELECT l.id AS lote_id, l.factura_id, l.costo_unitario, l.cantidad_inicial,
             l.capturado_por, l.revisado_en,
             f.tasa_iva, f.descuento_pct
      FROM lotes_pieza l
      LEFT JOIN facturas f ON f.id = l.factura_id
      WHERE l.id = @id`)
  return (r.recordset[0] as RenglonParaRevision) ?? null
}

export interface CabeceraParaRevision {
  id: number
  folio: string
  proveedor_id: number
  fecha_compra: string
  tasa_iva: number | null
  descuento_pct: number | null
  autorizado_por: string
  cabecera_revisada_en: Date | null
  /** Suma de costo × cantidad de todos sus renglones, a precio de lista. */
  subtotal: number
}

export async function leerCabecera(facturaId: number): Promise<CabeceraParaRevision | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT f.id, f.folio, f.proveedor_id,
             CONVERT(char(10), f.fecha_compra, 23) AS fecha_compra,
             f.tasa_iva, f.descuento_pct, f.autorizado_por, f.cabecera_revisada_en,
             COALESCE((SELECT SUM(l.costo_unitario * l.cantidad_inicial)
                       FROM lotes_pieza l WHERE l.factura_id = f.id), 0) AS subtotal
      FROM facturas f
      WHERE f.id = @id`)
  return (r.recordset[0] as CabeceraParaRevision) ?? null
}

/** Inserta las correcciones de una revisión. Comparte la transacción de quien sella. */
async function insertarCorrecciones(
  tx: sql.Transaction, facturaId: number, correcciones: Correccion[], quien: string,
): Promise<void> {
  for (const c of correcciones) {
    await tx.request()
      .input('factura', sql.Int,            facturaId)
      .input('lote',    sql.Int,            c.lote_id)
      .input('campo',   sql.NVarChar(40),   c.campo)
      .input('antes',   sql.NVarChar(100),  c.valor_antes)
      .input('despues', sql.NVarChar(100),  c.valor_despues)
      .input('capturo', sql.NVarChar(120),  c.capturado_por)
      .input('delta',   sql.Decimal(18, 2), c.delta_dinero)
      .input('quien',   sql.NVarChar(120),  quien)
      .query(`
        INSERT INTO correcciones_revision
          (factura_id, lote_id, campo, valor_antes, valor_despues,
           capturado_por, delta_dinero, corregida_por)
        VALUES (@factura, @lote, @campo, @antes, @despues, @capturo, @delta, @quien)`)
  }
}

/**
 * Sella el renglón y guarda lo que hubo que corregirle.
 *
 * Las correcciones de VALORES ya se aplicaron antes de llamar aquí, pasando por
 * `lotesService.updateLote`: es quien sabe ajustar la existencia cuando cambia
 * la cantidad y quien impide reducirla por debajo de lo ya consumido. Duplicar
 * esa aritmética aquí para ganar una sola transacción sería volver a tener dos
 * lugares donde vive la misma regla, que es justo lo que no se quiere.
 *
 * Si el proceso se cayera entre aplicar y sellar, el renglón se queda corregido
 * pero sin sello: sigue en la bandeja y el verificador lo vuelve a pasar. Es el
 * lado bueno en el que quedarse.
 *
 * El UPDATE solo sella lo que sigue sin sellar, así que dos revisiones
 * simultáneas del mismo renglón no se pisan: la segunda no afecta ninguna fila
 * y se entera de que llegó tarde.
 */
export async function sellarRenglon(
  loteId: number, facturaId: number, correcciones: Correccion[], quien: string,
): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const sellado = await tx.request()
      .input('id',    sql.Int,          loteId)
      .input('quien', sql.NVarChar(120), quien)
      .query(`
        UPDATE lotes_pieza
        SET revisado_en = SYSUTCDATETIME(), revisado_por = @quien
        WHERE id = @id AND revisado_en IS NULL`)

    if ((sellado.rowsAffected[0] ?? 0) === 0) {
      await tx.rollback()
      return false
    }

    await insertarCorrecciones(tx, facturaId, correcciones, quien)
    await tx.commit()
    return true
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * Sella la cabecera y guarda sus correcciones.
 *
 * Igual que en el renglón, los valores ya se aplicaron antes: el folio pasa por
 * `facturasService.setFolio` —que es quien sabe de fusiones— y el IVA y el
 * descuento por `facturasRepo.setTotales`.
 */
export async function sellarCabecera(
  facturaId: number, correcciones: Correccion[], quien: string, nota: string | null,
): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const sellado = await tx.request()
      .input('id',    sql.Int,           facturaId)
      .input('quien', sql.NVarChar(120),  quien)
      .input('nota',  sql.NVarChar(255),  nota)
      .query(`
        UPDATE facturas
        SET cabecera_revisada_en = SYSUTCDATETIME(),
            cabecera_revisada_por = @quien,
            revision_nota = @nota
        WHERE id = @id AND cabecera_revisada_en IS NULL`)

    if ((sellado.rowsAffected[0] ?? 0) === 0) {
      await tx.rollback()
      return false
    }

    await insertarCorrecciones(tx, facturaId, correcciones, quien)
    await tx.commit()
    return true
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * Quita los sellos de una factura entera para poder corregirla.
 *
 * Existe porque el candado no tiene marcha atrás sin él: una factura sellada no
 * la puede editar nadie, ni un admin, así que un error descubierto después
 * quedaría congelado para siempre.
 *
 * NO borra las correcciones ya registradas. Lo que se corrigió la primera vez
 * pasó, y el reporte de errores de captura no puede perderlo porque alguien
 * volviera a abrir la factura.
 */
export async function reabrir(facturaId: number): Promise<number> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const renglones = await tx.request()
      .input('id', sql.Int, facturaId)
      .query(`
        UPDATE lotes_pieza
        SET revisado_en = NULL, revisado_por = NULL
        WHERE factura_id = @id AND revisado_en IS NOT NULL`)

    await tx.request()
      .input('id', sql.Int, facturaId)
      .query(`
        UPDATE facturas
        SET cabecera_revisada_en = NULL, cabecera_revisada_por = NULL
        WHERE id = @id`)

    await tx.commit()
    return renglones.rowsAffected[0] ?? 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/** Lo que se corrigió en una factura, para mostrarlo junto a ella. */
export interface CorreccionRegistrada {
  id: number
  lote_id: number | null
  numero_serie: string | null
  campo: string
  valor_antes: string | null
  valor_despues: string | null
  capturado_por: string | null
  delta_dinero: number
  corregida_por: string
  corregida_en: string
}

export async function correccionesDeFactura(
  facturaId: number,
): Promise<CorreccionRegistrada[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      SELECT c.id, c.lote_id, p.numero_serie, c.campo,
             c.valor_antes, c.valor_despues, c.capturado_por, c.delta_dinero,
             c.corregida_por, CONVERT(varchar(19), c.corregida_en, 126) AS corregida_en
      FROM correcciones_revision c
      LEFT JOIN lotes_pieza l ON l.id = c.lote_id
      LEFT JOIN piezas      p ON p.id = l.pieza_id
      WHERE c.factura_id = @id
      ORDER BY c.corregida_en, c.id`)
  return r.recordset as CorreccionRegistrada[]
}

/**
 * Cuánto lleva equivocado cada quien.
 *
 * Son dos números y no uno, porque miden cosas distintas y confundirlos da una
 * lectura falsa:
 *
 *   `neto`      la suma con signo. Un error de +500 y otro de -500 se cancelan,
 *               y eso es correcto para saber cuánto se desvió el gasto del año.
 *   `absoluto`  la suma de los valores absolutos. Esos mismos dos errores son
 *               1,000 pesos que pasaron por manos equivocadas, y eso es lo que
 *               mide qué tan bien captura una persona.
 */
export interface ErroresDePersona {
  capturado_por: string | null
  correcciones: number
  renglones: number
  neto: number
  absoluto: number
}

export async function erroresPorPersona(
  desde?: string, hasta?: string,
): Promise<ErroresDePersona[]> {
  const pool = await getPool()
  const req = pool.request()
  const where: string[] = []
  if (desde) { req.input('desde', sql.Date, desde); where.push('c.corregida_en >= @desde') }
  if (hasta) {
    req.input('hasta', sql.Date, hasta)
    // El día "hasta" entra completo: una fecha suelta se compara contra
    // medianoche y dejaría fuera todo lo corregido ese mismo día.
    where.push('c.corregida_en < DATEADD(day, 1, @hasta)')
  }

  const r = await req.query(`
    SELECT c.capturado_por,
           COUNT(*)                         AS correcciones,
           COUNT(DISTINCT c.lote_id)        AS renglones,
           SUM(c.delta_dinero)              AS neto,
           SUM(ABS(c.delta_dinero))         AS absoluto
    FROM correcciones_revision c
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY c.capturado_por
    ORDER BY SUM(ABS(c.delta_dinero)) DESC`)
  return r.recordset as ErroresDePersona[]
}

/**
 * Por qué NO se puede quitar este renglón, o una lista vacía si sí se puede.
 *
 * Un renglón sobrante —el que se capturó de más y no está en el papel— se borra,
 * porque nunca existió. Pero "nunca existió" hay que comprobarlo: si sus piezas
 * ya se montaron en un camión, se consumieron en un mantenimiento o se
 * traspasaron a otra sucursal, entonces sí entraron al almacén y lo que sobra no
 * es el renglón, es la explicación de dónde salieron esas piezas.
 *
 * El caso mucho más común no es este: es que el renglón SÍ se compró pero
 * pertenece a otra factura. Eso no se borra, se mueve con `PUT /lotes/{id}`
 * poniéndole el folio correcto, y el mensaje de error lo recuerda.
 */
export async function motivosParaNoQuitar(loteId: number): Promise<string[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, loteId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM piezas_vehiculo     WHERE lote_id = @id) AS montadas,
        (SELECT COUNT(*) FROM instalaciones_pieza WHERE lote_id = @id) AS instalaciones,
        (SELECT COUNT(*) FROM detalle_mtto_pieza  WHERE lote_id = @id) AS consumos,
        (SELECT COUNT(*) FROM unidades_pieza      WHERE lote_id = @id) AS unidades,
        (SELECT COUNT(*) FROM traspasos_pieza     WHERE lote_id = @id) AS traspasos,
        (SELECT COUNT(*) FROM descuadres          WHERE lote_id = @id) AS descuadres,
        (SELECT COUNT(*) FROM correcciones_revision WHERE lote_id = @id) AS correcciones,
        (SELECT COALESCE(SUM(cantidad), 0) FROM existencias_lote WHERE lote_id = @id) AS existencia,
        (SELECT cantidad_inicial FROM lotes_pieza WHERE id = @id) AS cantidad_inicial`)

  const x = r.recordset[0]
  if (!x) return ['El renglón ya no existe']

  const motivos: string[] = []
  if (x.montadas > 0)      motivos.push(`${x.montadas} de sus piezas están montadas en un vehículo`)
  if (x.instalaciones > 0) motivos.push(`tiene ${x.instalaciones} instalación${x.instalaciones === 1 ? '' : 'es'} registrada${x.instalaciones === 1 ? '' : 's'}`)
  if (x.consumos > 0)      motivos.push(`se consumió en ${x.consumos} mantenimiento${x.consumos === 1 ? '' : 's'}`)
  if (x.unidades > 0)      motivos.push(`tiene ${x.unidades} unidad${x.unidades === 1 ? '' : 'es'} dada${x.unidades === 1 ? '' : 's'} de alta`)
  if (x.traspasos > 0)     motivos.push(`se traspasó ${x.traspasos} vez${x.traspasos === 1 ? '' : 'ces'} entre sucursales`)
  if (x.descuadres > 0)    motivos.push(`aparece en ${x.descuadres} descuadre${x.descuadres === 1 ? '' : 's'} de inventario`)
  if (x.correcciones > 0)  motivos.push('ya tiene correcciones de revisión registradas')

  // La existencia tiene que estar intacta: si falta alguna, salió del estante
  // por algún camino y borrar el lote dejaría ese movimiento sin origen.
  if (x.existencia !== x.cantidad_inicial) {
    motivos.push(
      `su existencia (${x.existencia}) ya no coincide con lo capturado (${x.cantidad_inicial}): ` +
      'salieron piezas de este lote'
    )
  }

  return motivos
}

/**
 * Borra el renglón que nunca se compró.
 *
 * Solo se llama después de `motivosParaNoQuitar`, así que a estas alturas el
 * lote está intacto: nada lo referencia y su existencia sigue completa. Las
 * filas de `existencias_lote` se van con él —su FK es la única con cascada—,
 * pero se borran explícitamente para no depender de eso.
 *
 * Es un borrado de verdad, y está bien que lo sea: no es historia, es un
 * renglón que no debió existir. Ver `docs/sin-delete.md`, que distingue las
 * entidades (se archivan) de lo capturado por error.
 */
export async function quitarRenglon(loteId: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    await tx.request()
      .input('id', sql.Int, loteId)
      .query('DELETE FROM existencias_lote WHERE lote_id = @id')

    const borrado = await tx.request()
      .input('id', sql.Int, loteId)
      .query('DELETE FROM lotes_pieza WHERE id = @id')

    await tx.commit()
    return (borrado.rowsAffected[0] ?? 0) > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

/**
 * Borra la factura que se quedó sin renglones.
 *
 * Quitar el último renglón sobrante deja una cabecera vacía, y una factura sin
 * renglones no es nada: ni gasto, ni papel, ni trabajo pendiente. Es lo mismo
 * que ya hace `facturasRepo.moverLoteAFolio` al vaciar la de origen.
 */
export async function borrarFacturaSiQuedoVacia(facturaId: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, facturaId)
    .query(`
      DELETE FROM facturas
      WHERE id = @id
        AND NOT EXISTS (SELECT 1 FROM lotes_pieza l WHERE l.factura_id = @id)
        AND NOT EXISTS (SELECT 1 FROM correcciones_revision c WHERE c.factura_id = @id)`)
  return (r.rowsAffected[0] ?? 0) > 0
}
