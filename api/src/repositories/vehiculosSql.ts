// Seguro y permiso de circulación viven en las tablas hijas de los tipos que
// realmente los llevan, igual que la tenencia: una caja de trailer no se
// asegura y ni tractos, ni cajas, ni montacargas tramitan permiso de
// circulación. Aquí están los fragmentos de SQL y las listas de tipos que
// necesitan los repos para no repetir (ni desincronizar) esa regla.
import { TIPOS_CON_PERMISO, TIPOS_CON_SEGURO, TipoVehiculo } from '../schemas/vehiculoSchema'

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

// Vehículos que tienen asignado cierto documento, como subconsulta de una sola
// columna. Sirve tanto para contarlos como para filtrar por ellos.
export function vehiculosConDocumento(campo: 'seguro_id' | 'permiso_id', valor: string): string {
  const tablas = campo === 'seguro_id' ? TABLAS_CON_SEGURO : TABLAS_CON_PERMISO
  return tablas
    .map((tabla) => `SELECT vehiculo_id FROM ${tabla} WHERE ${campo} = ${valor}`)
    .join(' UNION ALL ')
}
