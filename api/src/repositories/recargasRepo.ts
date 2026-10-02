import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { SQL_KM } from '../shared/km'
import { RecargaCreate, RecargaEmergencia, RecargaUpdate, TicketRecarga } from '../schemas/recargaSchema'
import { Alcance, conAlcance, vehiculoEnAlcance } from '../shared/alcance'

/** Un ticket de la bomba. Los trailers traen uno por tanque (migración 059). */
export interface Ticket {
  id:     number
  litros: number
  costo:  number
}

export interface RecargaConGasolinera {
  id:            number
  vehiculo_id:   number
  // Null solo en las recargas de emergencia (migración 056).
  gasolinera_id: number | null
  conductor_id:  number
  vale_id:       number | null
  emergencia:    boolean
  fecha:         string
  litros:        number
  costo:         number
  kilometraje:   number | null
  gasolinera:    string | null
  ubicacion:     string | null
  conductor:     string
  vale_folio:    string | null
  vale_fecha:    string | null
  // Correo de quien la capturó: decide si el practicante la puede corregir.
  // Null si no se sabe (migración 062).
  capturado_por: string | null
  // `litros` y `costo` de arriba son la suma de estos.
  tickets:       Ticket[]
}

// El vale entra con LEFT JOIN: las recargas registradas antes de que el vale
// fuera obligatorio no tienen ninguno y deben seguir apareciendo en el listado.
// La gasolinera también: las de emergencia no la llevan.
const SELECT_RECARGA = `
  SELECT r.id, r.vehiculo_id, r.gasolinera_id, r.conductor_id, r.vale_id, r.fecha,
         r.litros, r.costo, r.kilometraje, r.emergencia, r.capturado_por,
         g.nombre AS gasolinera, g.ubicacion,
         c.nombre AS conductor,
         vg.folio AS vale_folio,
         CONVERT(char(10), vg.fecha, 23) AS vale_fecha
  FROM recargas_combustible r
  LEFT JOIN gasolineras g  ON g.id = r.gasolinera_id
  JOIN conductores c       ON c.id = r.conductor_id
  LEFT JOIN vales_gasolina vg ON vg.id = r.vale_id
`

// Los tickets van en una segunda consulta y no en un JOIN: con JOIN la recarga
// saldría repetida una vez por ticket y cada listado tendría que volver a
// juntarla.
async function conTickets<T extends { id: number; tickets: Ticket[] }>(
  recargas: Omit<T, 'tickets'>[],
): Promise<T[]> {
  const porRecarga = new Map<number, Ticket[]>(recargas.map((r) => [r.id, []]))
  if (recargas.length) {
    const pool = await getPool()
    const r = await pool.request()
      .input('ids', sql.NVarChar(sql.MAX), recargas.map((x) => x.id).join(','))
      .query(`
        SELECT t.id, t.recarga_id, t.litros, t.costo
        FROM recargas_combustible_tickets t
        WHERE t.recarga_id IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
        ORDER BY t.recarga_id, t.id`)
    for (const t of r.recordset) {
      porRecarga.get(t.recarga_id)?.push({
        id: t.id, litros: Number(t.litros), costo: Number(t.costo),
      })
    }
  }
  return recargas.map((r) => ({ ...r, tickets: porRecarga.get(r.id) ?? [] }) as T)
}

export async function findByVehiculo(vehiculoId: number): Promise<RecargaConGasolinera[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`${SELECT_RECARGA} WHERE r.vehiculo_id = @vid ORDER BY r.fecha DESC, r.id DESC`)
  return conTickets<RecargaConGasolinera>(r.recordset)
}

/** Recarga del listado general: trae además qué vehículo se recargó. */
export interface RecargaConVehiculo extends RecargaConGasolinera {
  marca:  string
  modelo: string
  serie:  string
  placas: string | null
}

// Las recargas de toda la flota, para la pestaña Recargas de Vales de gasolina.
// El alcance se aplica aquí y no con `soloVisibles`: a diferencia de los vales,
// las recargas se acumulan con cada carga y no tiene caso traerlas todas para
// tirar la mayoría en memoria.
export async function findAll(alcance: Alcance): Promise<RecargaConVehiculo[]> {
  const pool = await getPool()
  const r = await conAlcance(pool.request(), alcance)
    .query(`
      SELECT r.id, r.vehiculo_id, r.gasolinera_id, r.conductor_id, r.vale_id,
             CONVERT(char(10), r.fecha, 23) AS fecha,
             r.litros, r.costo, r.kilometraje, r.emergencia, r.capturado_por,
             g.nombre AS gasolinera, g.ubicacion,
             c.nombre AS conductor,
             vg.folio AS vale_folio,
             CONVERT(char(10), vg.fecha, 23) AS vale_fecha,
             m.marca, m.nombre AS modelo, v.numero_serie AS serie, v.placas
      FROM recargas_combustible r
      LEFT JOIN gasolineras g  ON g.id = r.gasolinera_id
      JOIN conductores c       ON c.id = r.conductor_id
      JOIN vehiculos   v       ON v.id = r.vehiculo_id
      JOIN modelos     m       ON m.id = v.modelo_id
      LEFT JOIN vales_gasolina vg ON vg.id = r.vale_id
      WHERE ${vehiculoEnAlcance('r.vehiculo_id')}
      ORDER BY r.fecha DESC, r.id DESC`)
  return conTickets<RecargaConVehiculo>(r.recordset)
}

export async function findById(id: number): Promise<RecargaConGasolinera | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_RECARGA} WHERE r.id = @id`)
  if (!r.recordset[0]) return null
  return (await conTickets<RecargaConGasolinera>(r.recordset))[0]
}

/** Los tickets que ya tiene una recarga. */
export async function ticketsDe(recargaId: number): Promise<Ticket[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, recargaId)
    .query('SELECT id, litros, costo FROM recargas_combustible_tickets WHERE recarga_id = @id ORDER BY id')
  return r.recordset.map((t) => ({ id: t.id, litros: Number(t.litros), costo: Number(t.costo) }))
}

/**
 * Deja los tickets de la recarga exactamente como vienen y vuelve a sumar
 * `litros` y `costo` en la recarga, dentro de la transacción que la escribe:
 * la suma y sus tickets no pueden quedar en desacuerdo ni un momento.
 *
 * El que trae `id` se corrige; el que no, se da de alta; el que ya no viene se
 * borra. Si ese estaba casado con un renglón de una factura abierta (las
 * conciliadas las detiene la función antes), el renglón se suelta y vuelve a
 * quedar sin casar, que es lo cierto: ese ticket ya no existe.
 */
async function escribirTickets(
  tx: sql.Transaction, recargaId: number, tickets: TicketRecarga[],
): Promise<void> {
  const conservar = tickets.map((t) => t.id).filter((id): id is number => id !== undefined)
  const quitar = `
    WHERE recarga_id = @rid
      AND id NOT IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@conservar, ','))`
  await tx.request()
    .input('rid',       sql.Int, recargaId)
    .input('conservar', sql.NVarChar(200), conservar.join(','))
    .query(`
      UPDATE facturas_gasolina_renglones SET ticket_id = NULL, recarga_id = NULL
      WHERE ticket_id IN (SELECT id FROM recargas_combustible_tickets ${quitar});
      DELETE FROM recargas_combustible_tickets ${quitar};`)

  for (const t of tickets) {
    const req = tx.request()
      .input('rid',    sql.Int, recargaId)
      .input('litros', sql.Decimal(10, 3), t.litros)
      .input('costo',  sql.Decimal(18, 2), t.costo)
    if (t.id !== undefined) {
      await req.input('tid', sql.Int, t.id).query(`
        UPDATE recargas_combustible_tickets SET litros = @litros, costo = @costo
        WHERE id = @tid AND recarga_id = @rid`)
    } else {
      await req.query(`
        INSERT INTO recargas_combustible_tickets (recarga_id, litros, costo)
        VALUES (@rid, @litros, @costo)`)
    }
  }

  await tx.request()
    .input('rid', sql.Int, recargaId)
    .query(`
      UPDATE r SET litros = t.litros, costo = t.costo
      FROM recargas_combustible r
      CROSS APPLY (
        SELECT SUM(litros) AS litros, SUM(costo) AS costo
        FROM recargas_combustible_tickets WHERE recarga_id = r.id
      ) t
      WHERE r.id = @rid`)
}

/** Corre `fn` en una transacción: la recarga y sus tickets se escriben juntos. */
async function enTransaccion<T>(fn: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const r = await fn(tx)
    await tx.commit()
    return r
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

// La suma entra ya en el INSERT —la tabla es anterior a las migraciones y no
// se sabe si un CHECK rechaza el cero— y `escribirTickets` la vuelve a calcular
// en SQL, que es la que vale.
function sumar(tickets: { litros: number; costo: number }[]) {
  return {
    litros: tickets.reduce((s, t) => s + t.litros, 0),
    costo:  tickets.reduce((s, t) => s + t.costo, 0),
  }
}

export async function create(
  vehiculoId: number, data: RecargaCreate, capturadoPor: string,
): Promise<RecargaConGasolinera> {
  const suma = sumar(data.tickets)
  const id = await enTransaccion(async (tx) => {
    const r = await tx.request()
      .input('vehiculo_id',   sql.Int, vehiculoId)
      .input('gasolinera_id', sql.Int, data.gasolinera_id)
      .input('conductor_id',  sql.Int, data.conductor_id)
      .input('vale_id',       sql.Int, data.vale_id)
      .input('fecha',         sql.Date, data.fecha)
      .input('litros',        sql.Decimal(10, 3), suma.litros)
      .input('costo',         sql.Decimal(18, 2), suma.costo)
      .input('kilometraje',   SQL_KM, data.kilometraje)
      .input('capturado_por', sql.NVarChar(120), capturadoPor)
      .query(`
        INSERT INTO recargas_combustible (vehiculo_id, gasolinera_id, conductor_id, vale_id, fecha, litros, costo, kilometraje, capturado_por)
        OUTPUT INSERTED.id
        VALUES (@vehiculo_id, @gasolinera_id, @conductor_id, @vale_id, @fecha, @litros, @costo, @kilometraje, @capturado_por)
      `)
    const nueva = r.recordset[0].id as number
    // Sin ids: al registrar todos son nuevos, diga lo que diga el cuerpo.
    await escribirTickets(tx, nueva, data.tickets.map(({ litros, costo }) => ({ litros, costo })))
    return nueva
  })
  return findById(id) as Promise<RecargaConGasolinera>
}

// Sin gasolinera ni vale, que es lo único que el CHECK CK_recargas_emergencia
// acepta en una recarga marcada como emergencia. El kilometraje queda NULL:
// nadie lo leyó.
export async function createEmergencia(
  vehiculoId: number, data: RecargaEmergencia, capturadoPor: string,
): Promise<RecargaConGasolinera> {
  const id = await enTransaccion(async (tx) => {
    const r = await tx.request()
      .input('vehiculo_id',  sql.Int, vehiculoId)
      .input('conductor_id', sql.Int, data.conductor_id)
      .input('fecha',        sql.Date, data.fecha)
      .input('litros',       sql.Decimal(10, 3), data.litros)
      .input('costo',        sql.Decimal(18, 2), data.costo)
      .input('capturado_por', sql.NVarChar(120), capturadoPor)
      .query(`
        INSERT INTO recargas_combustible (vehiculo_id, conductor_id, fecha, litros, costo, emergencia, capturado_por)
        OUTPUT INSERTED.id
        VALUES (@vehiculo_id, @conductor_id, @fecha, @litros, @costo, 1, @capturado_por)
      `)
    const nueva = r.recordset[0].id as number
    await escribirTickets(tx, nueva, [{ litros: data.litros, costo: data.costo }])
    return nueva
  })
  return findById(id) as Promise<RecargaConGasolinera>
}

/**
 * Lo que se puede cambiar de una recarga. Los tickets ya vienen resueltos por
 * el servicio: un `litros`/`costo` suelto ya se volvió el ticket que corrige.
 */
export type CambiosRecarga = Omit<RecargaUpdate, 'litros' | 'costo'>

export async function update(id: number, data: CambiosRecarga): Promise<RecargaConGasolinera | null> {
  await enTransaccion(async (tx) => {
    const sets: string[] = []
    const req = tx.request().input('id', sql.Int, id)

    if (data.gasolinera_id !== undefined) {
      req.input('gasolinera_id', sql.Int, data.gasolinera_id)
      sets.push('gasolinera_id = @gasolinera_id')
    }
    if (data.conductor_id !== undefined) {
      req.input('conductor_id', sql.Int, data.conductor_id)
      sets.push('conductor_id = @conductor_id')
    }
    if (data.vale_id !== undefined) {
      req.input('vale_id', sql.Int, data.vale_id)
      sets.push('vale_id = @vale_id')
    }
    if (data.fecha !== undefined) {
      req.input('fecha', sql.Date, data.fecha)
      sets.push('fecha = @fecha')
    }
    if (data.kilometraje !== undefined) {
      req.input('kilometraje', SQL_KM, data.kilometraje)
      sets.push('kilometraje = @kilometraje')
    }

    if (sets.length) {
      await req.query(`UPDATE recargas_combustible SET ${sets.join(', ')} WHERE id = @id`)
    }
    if (data.tickets) await escribirTickets(tx, id, data.tickets)
  })
  return findById(id)
}

// ¿El vale ya se usó en otra recarga? exceptId excluye la propia al editar.
// Duplica lo que garantiza el índice único UQ_recargas_vale, pero permite
// responder con un mensaje claro en vez de un error del motor.
export async function valeUsado(valeId: number, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vale_id', sql.Int, valeId)
    .input('except',  sql.Int, exceptId ?? null)
    .query(`SELECT TOP 1 id FROM recargas_combustible
            WHERE vale_id = @vale_id AND (@except IS NULL OR id <> @except)`)
  return r.recordset.length > 0
}

/**
 * ¿El vale se dio por perdido? Un vale archivado no se puede gastar: alguien ya
 * decidió que ese papel no iba a aparecer, y aceptarlo ahora dejaría una
 * recarga colgando de un folio que el sistema da por muerto. Si de verdad
 * apareció, se restaura y entonces sí. Ver la migración 055.
 */
export async function valeArchivado(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT TOP 1 1 AS si FROM vales_gasolina WHERE id = @id AND archivado_en IS NOT NULL')
  return r.recordset.length > 0
}

// Vehículo al que pertenece un vale, o null si el vale no existe. Sirve para
// rechazar un vale emitido para otra unidad.
export async function valeVehiculo(id: number): Promise<number | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT vehiculo_id FROM vales_gasolina WHERE id = @id')
  return r.recordset[0]?.vehiculo_id ?? null
}

export async function vehiculoExists(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM vehiculos WHERE id = @id')
  return r.recordset.length > 0
}

/**
 * Todo lo que se ha gastado en una gasolinera.
 *
 * El dinero vive en la recarga y solo ahí: el vale de gasolina no guarda costo
 * ni gasolinera —es el papel que autoriza a cargar, con su folio, su chofer y
 * su unidad—, así que sumar vales daría un gasto que no existe. Lo que sí hace
 * el vale es identificar la carga, y por eso su folio viaja en cada renglón.
 *
 * Se devuelve plano y de lo más reciente a lo más viejo; los totales y el
 * agrupado por año los arma la pantalla.
 */
export interface ConsumoGasolinera {
  id:           number
  fecha:        string
  vehiculo_id:  number
  vehiculo:     string
  conductor:    string
  vale_folio:   string | null
  litros:       number
  costo:        number
  kilometraje:  number | null
  /** La factura de la gasolinera que la cobra. `null` = sin facturar todavía. */
  factura_id:   number | null
  factura_folio: string | null
}

export async function findConsumosDeGasolinera(
  gasolineraId: number,
): Promise<ConsumoGasolinera[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('gid', sql.Int, gasolineraId)
    .query(`
      SELECT r.id, CONVERT(char(10), r.fecha, 23) AS fecha,
             r.vehiculo_id,
             CONCAT(m.marca, ' ', m.nombre, ' — ', v.numero_serie) AS vehiculo,
             c.nombre AS conductor, vg.folio AS vale_folio,
             r.litros, r.costo, r.kilometraje,
             -- Qué factura cobra esta recarga, si alguna ya la reclamó. NULL =
             -- sigue sin facturar, y por eso es candidata de la próxima factura
             -- de esta gasolinera. Ver la migración 041.
             fg.id AS factura_id, fg.folio AS factura_folio
      FROM recargas_combustible r
      JOIN vehiculos   v  ON v.id = r.vehiculo_id
      JOIN modelos     m  ON m.id = v.modelo_id
      JOIN conductores c  ON c.id = r.conductor_id
      LEFT JOIN vales_gasolina vg ON vg.id = r.vale_id
      -- Con varios tickets la recarga puede estar en más de una factura: se
      -- enseñan todos los folios y el enlace lleva a la primera.
      OUTER APPLY (
        SELECT MIN(f.id) AS id,
               STRING_AGG(f.folio, ', ') WITHIN GROUP (ORDER BY f.folio) AS folio
        FROM (
          SELECT DISTINCT f.id, f.folio
          FROM facturas_gasolina_renglones fgr
          JOIN facturas_gasolina f ON f.id = fgr.factura_id
          WHERE fgr.recarga_id = r.id
        ) f
      ) fg
      WHERE r.gasolinera_id = @gid
      ORDER BY r.fecha DESC, r.id DESC`)
  // mssql devuelve DECIMAL como string cuando no cabe en un number seguro.
  return r.recordset.map((row) => ({
    ...row,
    litros: Number(row.litros),
    costo:  Number(row.costo),
  }))
}
