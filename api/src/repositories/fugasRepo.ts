// Dónde se está yendo el dinero sin que nadie lo vea.
//
// El análisis de costos (costosService) mide el gasto y lo compara contra sí
// mismo: cuánto se gastó, en qué unidad, contra el mejor precio conocido. Eso
// encuentra lo caro. Aquí se busca otra cosa: lo que se pierde sin aparecer como
// gasto —capital parado, merma, combustible sin destino, garantía no cobrada— y
// lo que se pierde justamente porque parecía barato.
//
// Ninguna de estas consultas inventa datos ni pide capturar nada nuevo: todo
// sale de lo que ya se registra. Lo que cambia es el cruce.
import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { fechaDelLote, joinFactura } from './facturaSql'

// Lo que costó un mantenimiento: la mano de obra del propio renglón más las
// refacciones que consumió.
//
// Va como OUTER APPLY y no como subconsulta dentro del SELECT porque en cuanto
// ese costo entra en un SUM() —al agrupar por vehículo— SQL Server lo rechaza:
// "Cannot perform an aggregate function on an expression containing an aggregate
// or a subquery". Con APPLY el total de refacciones ya es una columna, y la
// misma expresión sirve agrupada y sin agrupar.
//
// Exige que la tabla `mantenimiento` venga aliasada como `m`.
const APPLY_REFACCIONES = `
      OUTER APPLY (
        SELECT SUM(dp.cantidad * dp.costo_unitario) AS total
        FROM detalle_mtto_pieza dp
        WHERE dp.mantenimiento_id = m.id
      ) refs`

const COSTO_MANTENIMIENTO = `(COALESCE(m.costo, 0) + COALESCE(refs.total, 0))`

// ---------------------------------------------------------------------------
// 1. Costo por kilómetro de vida, por marca
// ---------------------------------------------------------------------------

export interface VidaPorMarca {
  tipo_pieza_id:  number
  tipo_pieza:     string
  marca:          string
  /** Montajes cerrados con odómetro en las dos puntas. Es la muestra. */
  montajes:       number
  km_promedio:    number
  costo_promedio: number
  /** Pesos por cada 1 000 km de servicio. Es la cifra que compara de verdad. */
  costo_por_mil:  number
}

/**
 * Lo que cuesta cada 1 000 km de servicio de una refacción, agrupado por marca
 * dentro de su tipo.
 *
 * Es la fuga que no aparece en ninguna factura: una pieza a mitad de precio que
 * dura un tercio es más cara, pero el reporte de compras la registra como
 * ahorro. La única forma de verlo es medir la vida real, y para eso hace falta
 * el montaje cerrado —con odómetro al instalar y al retirar—, que es lo que
 * `instalaciones_pieza` guarda desde la migración 001.
 *
 * Solo entran los tramos completos y coherentes: con las dos lecturas, con
 * retiro posterior a la instalación y con un lote del que salga el costo. Un
 * montaje abierto todavía no ha terminado de dar su vida y contarlo haría ver
 * peor a la pieza que sigue puesta.
 *
 * `minMontajes` filtra las marcas con muestra insuficiente: comparar contra una
 * sola pieza que se rompió por un golpe no dice nada de la marca.
 */
export async function findVidaPorMarca(minMontajes = 2): Promise<VidaPorMarca[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('min', sql.Int, minMontajes)
    .query(`
      SELECT p.tipo_pieza_id,
             t.nombre AS tipo_pieza,
             p.marca,
             COUNT(*) AS montajes,
             AVG(CAST(i.km_retiro - i.km_instalacion AS FLOAT)) AS km_promedio,
             AVG(CAST(l.costo_unitario AS FLOAT))               AS costo_promedio,
             -- El costo por mil km se calcula sobre los promedios y no como
             -- promedio de razones: así una pieza que duró poquísimo no domina
             -- el resultado por sí sola.
             (AVG(CAST(l.costo_unitario AS FLOAT)) * 1000.0)
               / NULLIF(AVG(CAST(i.km_retiro - i.km_instalacion AS FLOAT)), 0) AS costo_por_mil
      FROM instalaciones_pieza i
      JOIN piezas p        ON p.id = i.pieza_id
      JOIN tipos_pieza t   ON t.id = p.tipo_pieza_id
      JOIN lotes_pieza l   ON l.id = i.lote_id
      WHERE i.km_instalacion IS NOT NULL
        AND i.km_retiro      IS NOT NULL
        AND i.km_retiro > i.km_instalacion
        AND l.costo_unitario > 0
      GROUP BY p.tipo_pieza_id, t.nombre, p.marca
      HAVING COUNT(*) >= @min
      ORDER BY t.nombre, costo_por_mil
    `)
  return r.recordset
}

// ---------------------------------------------------------------------------
// 2. Merma valorizada
// ---------------------------------------------------------------------------

export interface MermaMes {
  mes:      string
  sucursal: string
  /**
   * Neto de piezas, con el signo de la migración 022: positivo = el sistema
   * cuenta de más, o sea que en el estante hay menos de lo que dice. Negativo es
   * un sobrante.
   */
  piezas:   number
  /** Lo mismo, en pesos al costo del lote. Es lo comparable entre refacciones. */
  monto:    number
}

/**
 * Los descuadres de inventario convertidos a pesos.
 *
 * Hoy `descuadres_inventario.diferencia` son piezas, así que diez tornillos y
 * diez inyectores pesan lo mismo al revisarlos y la merma cara se esconde detrás
 * de la barata. Multiplicada por el costo del lote se vuelve una cifra
 * comparable contra cualquier otra fuga.
 *
 * El signo se conserva: un sobrante es tan sintomático como un faltante —quiere
 * decir que algo salió sin registrarse— y taparlo con un valor absoluto
 * inventaría merma donde hubo un error de captura que se compensa.
 *
 * Sin lote no hay costo. Esos renglones siguen contando piezas pero aportan
 * cero pesos: es preferible quedarse corto a valuarlos con un costo promedio
 * que nadie pagó.
 */
export async function findMermaValorizada(desde: string): Promise<MermaMes[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('desde', sql.Date, desde)
    .query(`
      SELECT FORMAT(d.created_at, 'yyyy-MM') AS mes,
             s.nombre AS sucursal,
             SUM(d.diferencia) AS piezas,
             SUM(d.diferencia * COALESCE(l.costo_unitario, 0)) AS monto
      FROM descuadres_inventario d
      JOIN sucursales s      ON s.id = d.sucursal_id
      LEFT JOIN lotes_pieza l ON l.id = d.lote_id
      WHERE d.created_at >= @desde
      GROUP BY FORMAT(d.created_at, 'yyyy-MM'), s.nombre
      ORDER BY mes, s.nombre
    `)
  return r.recordset
}

// ---------------------------------------------------------------------------
// 3. Capital parado
// ---------------------------------------------------------------------------

export interface LoteInmovil {
  lote_id:        number
  pieza_id:       number
  numero_serie:   string
  descripcion:    string
  marca:          string
  sucursal:       string | null
  cantidad:       number
  costo_unitario: number
  monto:          number
  fecha_compra:   string | null
  /** Días desde la compra. Sin consumo, es el tiempo que lleva parado. */
  dias_parado:    number | null
  /** El modelo que usaba esta pieza ya no está en la flota: no se va a gastar. */
  descontinuada:  boolean
}

/**
 * Existencias que nadie ha tocado en mucho tiempo, valuadas.
 *
 * Es dinero inmovilizado que además se deteriora: hules que se cristalizan,
 * aceites que caducan, electrónica que se queda sin modelo al que entrar. No
 * duele porque ya se pagó hace meses, que es exactamente lo que lo vuelve
 * invisible.
 *
 * "Sin tocar" es sin consumo registrado —ni en un mantenimiento ni en un
 * traspaso— desde `desde`. Un lote comprado ayer no cuenta aunque no se haya
 * usado: todavía no tuvo oportunidad.
 *
 * `descontinuada` marca el caso agudo: la refacción solo servía para un modelo
 * que ya se descontinuó (migración 032). Eso no es capital lento, es capital
 * perdido, y conviene separarlo al presentarlo.
 */
export async function findLotesInmoviles(desde: string): Promise<LoteInmovil[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('desde', sql.Date, desde)
    .query(`
      SELECT ex.lote_id, p.id AS pieza_id, p.numero_serie, p.descripcion, p.marca,
             s.nombre AS sucursal,
             ex.cantidad, l.costo_unitario,
             ex.cantidad * l.costo_unitario AS monto,
             CONVERT(char(10), ${fechaDelLote()}, 23) AS fecha_compra,
             DATEDIFF(day, ${fechaDelLote()}, CAST(GETDATE() AS DATE)) AS dias_parado,
             CASE WHEN EXISTS (
               SELECT 1
               FROM tipos_pieza_modelo tpm
               JOIN modelos mo ON mo.id = tpm.modelo_id
               WHERE tpm.tipo_pieza_id = p.tipo_pieza_id
                 AND mo.descontinuado_en IS NULL
             ) THEN 0 ELSE 1 END AS descontinuada
      FROM existencias_lote ex
      JOIN lotes_pieza l  ON l.id = ex.lote_id
      JOIN piezas p       ON p.id = l.pieza_id
      JOIN sucursales s   ON s.id = ex.sucursal_id
      ${joinFactura()}
      WHERE ex.cantidad > 0
        AND l.costo_unitario > 0
        -- Comprado hace tiempo: lo recién llegado no es capital parado.
        AND ${fechaDelLote()} < @desde
        -- Y sin haberse consumido en ese lapso, ni por mantenimiento ni por
        -- traspaso: las dos son señales de que la pieza sí se mueve.
        AND NOT EXISTS (
          SELECT 1 FROM detalle_mtto_pieza dp
          JOIN mantenimiento m ON m.id = dp.mantenimiento_id
          WHERE dp.lote_id = ex.lote_id AND m.fecha >= @desde
        )
        AND NOT EXISTS (
          SELECT 1 FROM traspasos_pieza tr
          WHERE tr.lote_id = ex.lote_id AND tr.fecha >= @desde
        )
      ORDER BY descontinuada DESC, monto DESC
    `)
  // SQL Server no tiene booleano: el CASE devuelve 0/1 y se convierte aquí para
  // que el resto del sistema no tenga que acordarse.
  type Fila = Omit<LoteInmovil, 'descontinuada'> & { descontinuada: number }
  return (r.recordset as Fila[]).map((f) => ({ ...f, descontinuada: Boolean(f.descontinuada) }))
}

// ---------------------------------------------------------------------------
// 4. Vales entregados que nunca se usaron
// ---------------------------------------------------------------------------

export interface ValeSinRecarga {
  id:         number
  folio:      string
  fecha:      string
  conductor:  string
  vehiculo:   string
  dias:       number
}

/**
 * Vales de gasolina sin ninguna recarga que los mencione.
 *
 * El análisis de costos ya detecta el caso contrario —una recarga sin vale—,
 * que es combustible que entró sin respaldo. Este es el otro extremo del mismo
 * hueco: un folio que salió del cajón y no terminó en ningún tanque. Puede ser
 * captura pendiente o puede ser combustible que se fue; en los dos casos hay que
 * mirarlo, y hoy no lo mira nadie.
 *
 * `gracia` deja fuera los de los últimos días: un vale entregado esta mañana
 * todavía no tiene por qué haberse usado, y listarlo solo entrena a ignorar la
 * lista.
 */
export async function findValesSinRecarga(desde: string, gracia = 7): Promise<ValeSinRecarga[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('desde',  sql.Date, desde)
    .input('gracia', sql.Int,  gracia)
    .query(`
      SELECT vg.id, vg.folio,
             CONVERT(char(10), vg.fecha, 23) AS fecha,
             c.nombre AS conductor,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             DATEDIFF(day, vg.fecha, CAST(GETDATE() AS DATE)) AS dias
      FROM vales_gasolina vg
      JOIN conductores c ON c.id = vg.conductor_id
      JOIN vehiculos v   ON v.id = vg.vehiculo_id
      JOIN modelos mo    ON mo.id = v.modelo_id
      WHERE vg.fecha >= @desde
        AND vg.fecha <= DATEADD(day, -@gracia, CAST(GETDATE() AS DATE))
        AND NOT EXISTS (
          SELECT 1 FROM recargas_combustible r WHERE r.vale_id = vg.id
        )
      ORDER BY vg.fecha
    `)
  return r.recordset
}

// ---------------------------------------------------------------------------
// 5. Deriva del precio unitario
// ---------------------------------------------------------------------------

export interface DerivaPrecio {
  pieza_id:      number
  numero_serie:  string
  descripcion:   string
  marca:         string
  compras:       number
  primer_precio: number
  primera_fecha: string
  ultimo_precio: number
  ultima_fecha:  string
  /** Variación porcentual entre la primera compra del periodo y la última. */
  variacion_pct: number
}

/**
 * Cómo se movió el precio de cada refacción a lo largo del periodo.
 *
 * La comparación de precios contesta quién está más barato hoy. No contesta que
 * el mismo proveedor subió 30% en ocho meses, porque cada compra por separado
 * parecía razonable y nunca hubo una que saltara. La serie completa sí lo
 * enseña.
 *
 * Hacen falta al menos dos compras para que haya algo que comparar, y se usan la
 * primera y la última del periodo: el promedio escondería justo la tendencia que
 * se busca.
 */
export async function findDerivaPrecios(desde: string, minCompras = 2): Promise<DerivaPrecio[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('desde', sql.Date, desde)
    .input('min',   sql.Int,  minCompras)
    .query(`
      WITH compras AS (
        SELECT l.pieza_id, l.costo_unitario,
               ${fechaDelLote()} AS fecha,
               ROW_NUMBER() OVER (
                 PARTITION BY l.pieza_id ORDER BY ${fechaDelLote()}, l.id
               ) AS rn_asc,
               ROW_NUMBER() OVER (
                 PARTITION BY l.pieza_id ORDER BY ${fechaDelLote()} DESC, l.id DESC
               ) AS rn_desc,
               COUNT(*) OVER (PARTITION BY l.pieza_id) AS total
        FROM lotes_pieza l
        ${joinFactura()}
        WHERE l.costo_unitario > 0
          AND ${fechaDelLote()} >= @desde
      )
      SELECT p.id AS pieza_id, p.numero_serie, p.descripcion, p.marca,
             pri.total AS compras,
             pri.costo_unitario AS primer_precio,
             CONVERT(char(10), pri.fecha, 23) AS primera_fecha,
             ult.costo_unitario AS ultimo_precio,
             CONVERT(char(10), ult.fecha, 23) AS ultima_fecha,
             ((ult.costo_unitario - pri.costo_unitario) * 100.0)
               / NULLIF(pri.costo_unitario, 0) AS variacion_pct
      FROM compras pri
      JOIN compras ult ON ult.pieza_id = pri.pieza_id AND ult.rn_desc = 1
      JOIN piezas p    ON p.id = pri.pieza_id
      WHERE pri.rn_asc = 1 AND pri.total >= @min
      ORDER BY variacion_pct DESC
    `)
  return r.recordset
}

// ---------------------------------------------------------------------------
// 6. Correctivos pagados sobre algo en garantía
// ---------------------------------------------------------------------------

export interface CorrectivoEnGarantia {
  mantenimiento_id: number
  vehiculo_id:      number
  vehiculo:         string
  fecha:            string
  costo:            number
  garantia:         string
  folio:            string | null
  /** Por qué se considera vigente ese día: la regla que la garantía declara. */
  cobertura:        string
}

/**
 * Mantenimientos correctivos pagados mientras el vehículo tenía una garantía
 * vigente que, en principio, debía cubrirlos.
 *
 * Es la fuga de mayor monto unitario: una reparación que el fabricante debía
 * pagar y se pagó de caja porque nadie cruzó la fecha con la póliza.
 *
 * SE PRESENTA COMO "REVISAR", NO COMO PÉRDIDA. La garantía no cubre desgaste
 * normal ni mal uso, y esta consulta no sabe qué se reparó: solo sabe que había
 * cobertura vigente ese día. Decir "perdiste esto" sería afirmar más de lo que
 * el dato aguanta; decir "mira estos casos" es exactamente lo que se puede.
 *
 * Vigencia: por meses desde `fecha_inicio`, por kilómetros desde `km_inicio`, o
 * las dos —y entonces basta con que una siga viva, que es como las redactan los
 * fabricantes—. Las canceladas no cuentan.
 */
export async function findCorrectivosEnGarantia(desde: string): Promise<CorrectivoEnGarantia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('desde', sql.Date, desde)
    .query(`
      SELECT m.id AS mantenimiento_id, v.id AS vehiculo_id,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             CONVERT(char(10), m.fecha, 23) AS fecha,
             ${COSTO_MANTENIMIENTO} AS costo,
             g.nombre AS garantia, g.folio,
             CONCAT(
               CASE WHEN g.duracion_meses IS NOT NULL
                    THEN CONCAT(g.duracion_meses, ' meses desde ',
                                CONVERT(char(10), g.fecha_inicio, 23)) END,
               CASE WHEN g.duracion_meses IS NOT NULL AND g.limite_km IS NOT NULL
                    THEN ' o ' END,
               CASE WHEN g.limite_km IS NOT NULL
                    THEN CONCAT(g.limite_km, ' km desde ', g.km_inicio) END
             ) AS cobertura
      FROM mantenimiento m
      JOIN vehiculos v ON v.id = m.vehiculo_id
      JOIN modelos mo  ON mo.id = v.modelo_id
      JOIN garantias_vehiculo g ON g.vehiculo_id = v.id
      ${APPLY_REFACCIONES}
      WHERE m.tipo = 'Correctivo'
        AND m.fecha >= @desde
        AND g.cancelada_en IS NULL
        -- Vigente ese día por al menos una de las dos reglas. La que no aplica
        -- viene NULL y no descalifica a la otra.
        AND (
          (g.fecha_inicio IS NOT NULL AND g.duracion_meses IS NOT NULL
           AND m.fecha BETWEEN g.fecha_inicio
                           AND DATEADD(month, g.duracion_meses, g.fecha_inicio))
          OR
          (g.km_inicio IS NOT NULL AND g.limite_km IS NOT NULL
           AND m.km_actual IS NOT NULL
           AND m.km_actual BETWEEN g.km_inicio AND g.km_inicio + g.limite_km)
        )
      ORDER BY costo DESC
    `)
  return r.recordset
}

// ---------------------------------------------------------------------------
// 7. Lo que cuesta diferir el preventivo
// ---------------------------------------------------------------------------

export interface CorrectivoPorVehiculo {
  vehiculo_id:  number
  vehiculo:     string
  correctivos:  number
  costo:        number
  km:           number | null
}

/**
 * Gasto correctivo por unidad en el periodo, para contrastarlo contra las
 * unidades que traen requerimientos vencidos.
 *
 * El cruce se arma en el servicio, que es quien sabe qué unidades están
 * atrasadas (eso vive en `programaVehiculoService`). Aquí solo se junta el gasto
 * correctivo, que es la mitad que sí es una consulta.
 *
 * El `km` sirve para normalizar: una unidad que trabaja el doble gasta el doble
 * sin que eso signifique nada. Sale de la diferencia entre la primera y la
 * última lectura de odómetro del periodo, que es lo que hay sin inventar.
 */
export async function findCorrectivosPorVehiculo(desde: string): Promise<CorrectivoPorVehiculo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('desde', sql.Date, desde)
    .query(`
      SELECT v.id AS vehiculo_id,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
             COUNT(DISTINCT m.id) AS correctivos,
             SUM(${COSTO_MANTENIMIENTO}) AS costo,
             NULLIF(MAX(m.km_actual) - MIN(m.km_actual), 0) AS km
      FROM mantenimiento m
      JOIN vehiculos v ON v.id = m.vehiculo_id
      JOIN modelos mo  ON mo.id = v.modelo_id
      ${APPLY_REFACCIONES}
      WHERE m.tipo = 'Correctivo' AND m.fecha >= @desde
      GROUP BY v.id, mo.marca, mo.nombre, v.numero_serie
    `)
  return r.recordset
}
