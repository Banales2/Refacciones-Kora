// Fragmentos de SQL sobre la flota que usan varios repositorios. Viven aquí y
// no en vehiculosRepo porque los repositorios no se importan entre sí: el
// tablero necesita las mismas definiciones de "sin seguro" o "dado de baja" que
// la búsqueda de vehículos, y cuando cada uno tenía la suya se desincronizaban
// (las cajas de trailer salían reclamando una póliza que no llevan).
//
// Un vehículo es una fila en `vehiculos` más una fila en la tabla hija de su
// tipo, y ahí es donde viven la tenencia, el seguro y el permiso: los llevan
// nada más los tipos a los que les aplican.
import {
  TIPOS_CON_PERMISO, TIPOS_CON_SEGURO, TIPOS_CON_TENENCIA, TipoVehiculo,
} from '../schemas/vehiculoSchema'

// Tabla hija de cada tipo. El vehículo siempre tiene exactamente una fila ahí.
export const TABLA_POR_TIPO: Record<TipoVehiculo, string> = {
  camion:       'camiones',
  tractocamion: 'tractocamiones',
  caja_trailer: 'cajas_trailer',
  utilitario:   'vehiculos_utilitarios',
  montacargas:  'montacargas',
}

export const TABLAS_CON_SEGURO  = TIPOS_CON_SEGURO.map((t) => TABLA_POR_TIPO[t])
export const TABLAS_CON_PERMISO = TIPOS_CON_PERMISO.map((t) => TABLA_POR_TIPO[t])

// El documento asignado, reunido desde las hijas. Cuenta con los alias de los
// JOINS de vehiculosRepo (c/t/u/mc); como cada vehículo solo tiene una fila
// hija, el COALESCE no puede tapar dos valores distintos.
export const SEGURO_ID_SQL  = 'COALESCE(c.seguro_id, t.seguro_id, u.seguro_id, mc.seguro_id)'
export const PERMISO_ID_SQL = 'COALESCE(c.permiso_id, u.permiso_id)'

// Las cinco tablas hijas, que es lo que define los alias c/t/ct/u/mc de los que
// dependen todos los fragmentos de abajo. Cualquier consulta que los use tiene
// que incluir esto (y `vehiculos v`) en su FROM.
export const JOINS_HIJAS = `
  LEFT JOIN camiones              c  ON c.vehiculo_id  = v.id
  LEFT JOIN tractocamiones        t  ON t.vehiculo_id  = v.id
  LEFT JOIN cajas_trailer         ct ON ct.vehiculo_id = v.id
  LEFT JOIN vehiculos_utilitarios u  ON u.vehiculo_id  = v.id
  LEFT JOIN montacargas           mc ON mc.vehiculo_id = v.id
`

// Las unidades dadas de baja quedan fuera de todos los avisos: ya no se les va a
// capturar ni renovar nada. Solo aplica a los avisos; buscar por texto sí las
// sigue encontrando. El status vive en la tabla hija, de ahí el COALESCE.
export const NO_DADO_DE_BAJA = `
  COALESCE(c.status, t.status, u.status, ct.status, mc.status, '') <> 'Baja'
`

// Sin tenencia = de los tipos que la pagan y sin fecha de vencimiento capturada.
// Los tractocamiones quedaron fuera: no la pagan, y reclamársela era ruido.
export const SIN_TENENCIA = `
  v.tipo IN (${TIPOS_CON_TENENCIA.map((t) => `'${t}'`).join(',')})
  AND COALESCE(c.tenencia_expiracion, u.tenencia_expiracion) IS NULL
`

// Sin seguro = de los tipos que se aseguran y sin póliza asignada. Las cajas de
// trailer no entran: no se aseguran, así que reclamarles la póliza era ruido.
export const SIN_SEGURO = `
  v.tipo IN (${TIPOS_CON_SEGURO.map((t) => `'${t}'`).join(',')})
  AND ${SEGURO_ID_SQL} IS NULL
`

// Vehículos que tienen asignado cierto documento, como subconsulta de una sola
// columna. Sirve tanto para contarlos como para filtrar por ellos.
export function vehiculosConDocumento(campo: 'seguro_id' | 'permiso_id', valor: string): string {
  const tablas = campo === 'seguro_id' ? TABLAS_CON_SEGURO : TABLAS_CON_PERMISO
  return tablas
    .map((tabla) => `SELECT vehiculo_id FROM ${tabla} WHERE ${campo} = ${valor}`)
    .join(' UNION ALL ')
}
