import type { VehiculoReporte } from '../hooks/useDashboard'
import type { TipoVehiculo } from '../hooks/useVehiculos'
import type { Sucursal } from '../hooks/useSucursales'
import { TIPO_LABELS } from './tipoVehiculo'

// Mismo orden que la tabla de la pestaña Vehículos.
const TIPO_ORDEN: TipoVehiculo[] = ['camion', 'tractocamion', 'caja_trailer', 'utilitario', 'montacargas']

function compareVehiculos(a: VehiculoReporte, b: VehiculoReporte): number {
  const porModelo = `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`, 'es-MX')
  if (porModelo !== 0) return porModelo
  return a.serie.localeCompare(b.serie, 'es-MX', { numeric: true })
}

export interface GrupoTipo {
  tipo:  TipoVehiculo
  label: string
  items: VehiculoReporte[]
}

export interface GrupoUbicacion {
  key:   string
  label: string
  tipos: GrupoTipo[]
}

function agruparPorTipo(items: VehiculoReporte[]): GrupoTipo[] {
  const map = new Map<TipoVehiculo, VehiculoReporte[]>()
  for (const v of items) {
    const tipo = v.tipo as TipoVehiculo
    if (!map.has(tipo)) map.set(tipo, [])
    map.get(tipo)!.push(v)
  }
  return TIPO_ORDEN
    .filter(t => map.has(t))
    .map(t => ({ tipo: t, label: TIPO_LABELS[t] ?? t, items: [...map.get(t)!].sort(compareVehiculos) }))
}

// Agrupa igual que la vista "Rutas / Sucursales / Unitarios" de la pestaña
// Vehículos: primero por ubicación (Rutas como grupo único, cada sucursal,
// sin sucursal, y vehículos unitarios), y dentro de cada una por tipo de
// vehículo (ordenados por marca/modelo/serie).
export function agruparVehiculosPorUbicacion(
  vehiculos: VehiculoReporte[], sucursales: Sucursal[]
): GrupoUbicacion[] {
  const rutas       = vehiculos.filter(v => v.tipo === 'tractocamion' || v.tipo === 'caja_trailer')
  const conSucursal = vehiculos.filter(v => v.tipo === 'camion' || v.tipo === 'montacargas')
  const unitarios   = vehiculos.filter(v => v.tipo === 'utilitario')
  const porSucursal = sucursales.map(s => ({ sucursal: s, items: conSucursal.filter(v => v.sucursal_id === s.id) }))
  const sinSucursal = conSucursal.filter(v => !sucursales.some(s => s.id === v.sucursal_id))

  const grupos: GrupoUbicacion[] = []
  if (rutas.length)       grupos.push({ key: 'rutas',        label: 'Rutas',               tipos: agruparPorTipo(rutas) })
  for (const { sucursal, items } of porSucursal) {
    if (items.length)     grupos.push({ key: `suc-${sucursal.id}`, label: sucursal.nombre,  tipos: agruparPorTipo(items) })
  }
  if (sinSucursal.length)  grupos.push({ key: 'sin-sucursal', label: 'Sin sucursal',        tipos: agruparPorTipo(sinSucursal) })
  if (unitarios.length)    grupos.push({ key: 'unitarios',    label: 'Vehículos unitarios', tipos: agruparPorTipo(unitarios) })
  return grupos
}
