// Lectura del estado de un registro *antes* de modificarlo o borrarlo, para la
// bitácora de cambios.
//
// Existe porque los `remove()` de los repositorios devuelven un booleano: una
// vez ejecutado el DELETE, la fila ya no se puede consultar y con ella se
// pierde todo salvo el id, que además queda huérfano. Hay que leerla antes.
//
// Es genérico a propósito. Resolverlo repositorio por repositorio significaba
// tocar 23 archivos y depender de que cada uno tuviera un `findById` con la
// forma adecuada; aquí basta con el nombre de la tabla, que el endpoint ya
// pasa a audit().
import * as sql from 'mssql'
import { getPool } from './db'

export type Fila = Record<string, unknown>

// El nombre de la tabla se interpola en el SQL, así que sólo se admiten estos.
// Cualquier otro valor devuelve null en vez de consultar: si algún día se añade
// un módulo y se olvida registrarlo aquí, la bitácora pierde el detalle de esa
// tabla, pero nunca se abre una vía de inyección.
const GENERICAS = [
  'conductores',
  'gasolineras',
  'modelos',
  'permisos_circulacion',
  'proveedores',
  'rutas',
  'seguros',
  'sucursales',
  'tecnicos',
  'tipos_pieza',
] as const

// Tablas donde el registro, por sí solo, no dice nada: guardar `vehiculo_id: 14`
// de un vehículo que acaba de desaparecer no sirve de nada. Estas consultas
// resuelven las llaves foráneas en el momento de la captura, que es la única
// oportunidad de hacerlo.
const CONSULTAS: Record<string, string> = {
  vehiculos: `
    SELECT v.*, m.marca, m.nombre AS modelo
    FROM vehiculos v
    LEFT JOIN modelos m ON m.id = v.modelo_id
    WHERE v.id = @id`,

  piezas: `
    SELECT p.*, tp.nombre AS tipo_pieza
    FROM piezas p
    LEFT JOIN tipos_pieza tp ON tp.id = p.tipo_pieza_id
    WHERE p.id = @id`,

  lotes_pieza: `
    SELECT l.*, p.numero_serie AS pieza_serie, p.descripcion AS pieza,
           pr.nombre AS proveedor
    FROM lotes_pieza l
    LEFT JOIN piezas p       ON p.id = l.pieza_id
    LEFT JOIN proveedores pr ON pr.id = l.proveedor_id
    WHERE l.id = @id`,

  mantenimiento: `
    SELECT mt.*, v.numero_serie AS vehiculo_serie, v.placas AS vehiculo_placas,
           t.nombre AS tecnico_nombre
    FROM mantenimiento mt
    LEFT JOIN vehiculos v ON v.id = mt.vehiculo_id
    LEFT JOIN tecnicos  t ON t.id = mt.tecnico_id
    WHERE mt.id = @id`,

  agendas_mantenimiento: `
    SELECT a.*, v.numero_serie AS vehiculo_serie, v.placas AS vehiculo_placas,
           t.nombre AS tecnico_nombre
    FROM agendas_mantenimiento a
    LEFT JOIN vehiculos v ON v.id = a.vehiculo_id
    LEFT JOIN tecnicos  t ON t.id = a.tecnico_id
    WHERE a.id = @id`,

  detalle_mtto_pieza: `
    SELECT d.*, p.numero_serie AS pieza_serie, p.descripcion AS pieza,
           v.numero_serie AS vehiculo_serie
    FROM detalle_mtto_pieza d
    LEFT JOIN lotes_pieza   l  ON l.id = d.lote_id
    LEFT JOIN piezas        p  ON p.id = l.pieza_id
    LEFT JOIN mantenimiento mt ON mt.id = d.mantenimiento_id
    LEFT JOIN vehiculos     v  ON v.id = mt.vehiculo_id
    WHERE d.id = @id`,

  // Preventivos e incidencias son hijos de `pendientes` y la mitad de sus datos
  // vive en el padre: si se captura solo la tabla hija, la bitácora guarda un
  // registro sin nombre, sin status y sin vehículo. Por eso ambas capturas
  // parten del padre y le pegan el hijo.
  requerimientos_exclusivos: `
    SELECT p.*, r.trigger_mode, r.intervalo_km, r.intervalo_meses,
           r.fecha_inicio, r.km_inicio, r.fecha_reporte, r.plantilla_origen_id,
           v.numero_serie AS vehiculo_serie, v.placas AS vehiculo_placas
    FROM pendientes p
    JOIN requerimientos_exclusivos r ON r.id = p.id
    LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
    WHERE p.id = @id`,

  incidencias: `
    SELECT p.*, i.reportado_por, i.severidad, i.fecha, i.hora, i.ubicacion,
           i.autorizado_por,
           v.numero_serie AS vehiculo_serie, v.placas AS vehiculo_placas
    FROM pendientes p
    JOIN incidencias i ON i.id = p.id
    LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
    WHERE p.id = @id`,

  plantilla_requerimientos_modelo: `
    SELECT pl.*, m.marca, m.nombre AS modelo
    FROM plantilla_requerimientos_modelo pl
    LEFT JOIN modelos m ON m.id = pl.modelo_id
    WHERE pl.id = @id`,

  precios_proveedor: `
    SELECT pp.*, pr.nombre AS proveedor,
           p.numero_serie AS pieza_serie, p.descripcion AS pieza
    FROM precios_proveedor pp
    LEFT JOIN proveedores pr ON pr.id = pp.proveedor_id
    LEFT JOIN piezas      p  ON p.id = pp.pieza_id
    WHERE pp.id = @id`,

  recargas_combustible: `
    SELECT rc.*, v.numero_serie AS vehiculo_serie, v.placas AS vehiculo_placas,
           c.nombre AS conductor, g.nombre AS gasolinera
    FROM recargas_combustible rc
    LEFT JOIN vehiculos    v ON v.id = rc.vehiculo_id
    LEFT JOIN conductores  c ON c.id = rc.conductor_id
    LEFT JOIN gasolineras  g ON g.id = rc.gasolinera_id
    WHERE rc.id = @id`,

  vales_gasolina: `
    SELECT vg.*, v.numero_serie AS vehiculo_serie, v.placas AS vehiculo_placas,
           c.nombre AS conductor
    FROM vales_gasolina vg
    LEFT JOIN vehiculos   v ON v.id = vg.vehiculo_id
    LEFT JOIN conductores c ON c.id = vg.conductor_id
    WHERE vg.id = @id`,

  piezas_vehiculo: `
    SELECT pv.*, v.numero_serie AS vehiculo_serie, v.placas AS vehiculo_placas,
           p.numero_serie AS pieza_serie, p.descripcion AS pieza,
           tp.nombre AS tipo_pieza
    FROM piezas_vehiculo pv
    LEFT JOIN vehiculos   v  ON v.id = pv.vehiculo_id
    LEFT JOIN piezas      p  ON p.id = pv.pieza_id
    LEFT JOIN tipos_pieza tp ON tp.id = pv.tipo_pieza_id
    WHERE pv.id = @id`,

  tipos_pieza_vehiculo: `
    SELECT tpv.*, v.numero_serie AS vehiculo_serie, v.placas AS vehiculo_placas,
           tp.nombre AS tipo_pieza
    FROM tipos_pieza_vehiculo tpv
    LEFT JOIN vehiculos   v  ON v.id = tpv.vehiculo_id
    LEFT JOIN tipos_pieza tp ON tp.id = tpv.tipo_pieza_id
    WHERE tpv.id = @id`,

  tipos_pieza_modelo: `
    SELECT tpm.*, m.marca, m.nombre AS modelo, tp.nombre AS tipo_pieza
    FROM tipos_pieza_modelo tpm
    LEFT JOIN modelos     m  ON m.id = tpm.modelo_id
    LEFT JOIN tipos_pieza tp ON tp.id = tpm.tipo_pieza_id
    WHERE tpm.id = @id`,
}

export function esTablaAuditable(tabla: string): boolean {
  return tabla in CONSULTAS || (GENERICAS as readonly string[]).includes(tabla)
}

// Devuelve null en lugar de lanzar: la bitácora nunca debe tumbar la operación
// que está registrando. Un fallo aquí se traduce en un registro con menos
// detalle, no en un borrado que no se ejecuta.
export async function capturar(tabla: string, id: number | string): Promise<Fila | null> {
  try {
    if (!esTablaAuditable(tabla)) {
      console.warn(`[AUDIT] tabla no registrada en snapshot.ts: ${tabla}`)
      return null
    }
    const consulta = CONSULTAS[tabla] ?? `SELECT * FROM [${tabla}] WHERE id = @id`
    const pool = await getPool()
    const r = await pool.request().input('id', sql.Int, Number(id)).query(consulta)
    return (r.recordset[0] as Fila) ?? null
  } catch (err) {
    console.error(`[AUDIT] no se pudo capturar ${tabla}#${id}:`, err)
    return null
  }
}
