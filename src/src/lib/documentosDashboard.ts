// Cómo se leen los documentos por vencer del tablero.
//
// La API los entrega en cuatro listas separadas (seguros, permisos, licencias,
// tenencias) porque vienen de tablas distintas; para verlos hay que unirlas y
// ordenarlas por urgencia. Eso vivía dentro del componente Dashboard, y cuando
// apareció el reporte de la pestaña hubo que decidir: copiarlo —y arriesgar que
// la hoja impresa dijera algo distinto de la pantalla— o sacarlo aquí. Es esto.
import type { DocumentosPorVencer } from '../hooks/useDashboard'

export interface DocumentoUnificado {
  key:              string
  tipo:             string
  /** Color del badge del tipo de documento. */
  colorTipo:        string
  /** Color del aviso cuando aún no vence (las licencias avisan en amarillo). */
  colorAviso:       string
  etiqueta:         string
  fecha_expiracion: string
  dias_restantes:   number
  /** Cuántas unidades cubre. Null en licencias y tenencias: no aplica. */
  vehiculos:        number | null
}

const TIPO_LICENCIA: Record<string, string> = {
  estatal:    'Licencia estatal',
  federal:    'Licencia federal',
  expediente: 'Expediente federal',
}

/** Las cuatro listas en una sola, de lo más urgente a lo menos. */
export function unificarDocumentos(doc: DocumentosPorVencer | undefined): DocumentoUnificado[] {
  if (!doc) return []

  const seguros = doc.seguros.map((s) => ({
    key: `s-${s.id}`, tipo: 'Seguro', colorTipo: 'blue', colorAviso: 'orange',
    etiqueta: `${s.poliza} — ${s.compania}`,
    fecha_expiracion: s.fecha_expiracion, dias_restantes: s.dias_restantes,
    vehiculos: s.vehiculos as number | null,
  }))
  const permisos = doc.permisos.map((p) => ({
    key: `p-${p.id}`, tipo: 'Permiso', colorTipo: 'grape', colorAviso: 'orange',
    etiqueta: p.zona_circulacion,
    fecha_expiracion: p.fecha_expiracion, dias_restantes: p.dias_restantes,
    vehiculos: p.vehiculos as number | null,
  }))
  // La licencia es de la persona, no de una unidad: `vehiculos` va en null.
  const licencias = doc.licencias.map((l) => ({
    key: `l-${l.conductor_id}-${l.tipo}`,
    tipo: TIPO_LICENCIA[l.tipo] ?? 'Licencia',
    colorTipo: 'teal', colorAviso: 'yellow',
    etiqueta: l.numero ? `${l.conductor} — ${l.numero}` : l.conductor,
    fecha_expiracion: l.fecha_expiracion, dias_restantes: l.dias_restantes,
    vehiculos: null,
  }))
  const tenencias = doc.tenencias.map((t) => ({
    key: `t-${t.vehiculo_id}`, tipo: 'Tenencia', colorTipo: 'indigo', colorAviso: 'orange',
    etiqueta: t.vehiculo,
    fecha_expiracion: t.fecha_expiracion, dias_restantes: t.dias_restantes,
    vehiculos: null,
  }))

  return [...seguros, ...permisos, ...licencias, ...tenencias]
    .sort((a, b) => a.dias_restantes - b.dias_restantes)
}

export interface VehiculoSinDocumentos {
  vehiculo_id: number
  vehiculo:    string
  placas:      string | null
  tipo:        string
  tenencia:    boolean
  seguro:      boolean
}

/**
 * Unidades a las que les falta tenencia o seguro por completo. Van aparte de la
 * lista de arriba porque no tienen fecha, así que no hay "días restantes" con
 * los cuales ordenarlas. Se juntan por vehículo porque a algunas les faltan las
 * dos cosas, y verlas dos veces no ayuda.
 */
export function agruparSinDocumento(doc: DocumentosPorVencer | undefined): VehiculoSinDocumentos[] {
  if (!doc) return []
  const porVehiculo = new Map<number, VehiculoSinDocumentos>()

  const registrar = (
    lista: { vehiculo_id: number; vehiculo: string; placas: string | null; tipo: string }[],
    falta: 'tenencia' | 'seguro',
  ) => {
    for (const v of lista) {
      const prev = porVehiculo.get(v.vehiculo_id) ?? { ...v, tenencia: false, seguro: false }
      prev[falta] = true
      porVehiculo.set(v.vehiculo_id, prev)
    }
  }
  registrar(doc.sin_tenencia, 'tenencia')
  registrar(doc.sin_seguro,   'seguro')

  // Primero a las que les falta todo.
  return [...porVehiculo.values()].sort((a, b) =>
    Number(b.tenencia) + Number(b.seguro) - (Number(a.tenencia) + Number(a.seguro)) ||
    a.vehiculo.localeCompare(b.vehiculo, 'es-MX'))
}

/** Etiqueta y color del estado de vencimiento. Lo ya vencido siempre va en rojo. */
export function estadoVencimiento(dias: number, colorAviso = 'orange'): { label: string; color: string } {
  if (dias < 0)   return { label: `Vencido hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`, color: 'red' }
  if (dias === 0) return { label: 'Vence hoy', color: 'red' }
  return { label: `Vence en ${dias} día${dias !== 1 ? 's' : ''}`, color: colorAviso }
}
