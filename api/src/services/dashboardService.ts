import * as repo from '../repositories/dashboardRepo'
import { RequerimientoFleet } from '../repositories/dashboardRepo'
import * as requerimentosRepo from '../repositories/requerimentosRepo'
import { getPool } from '../shared/db'

// Sincroniza el status de requerimientos únicos (según la fecha del
// mantenimiento vinculado) una vez por día calendario. Se apoya en
// dashboard_requerimientos_historial: si ya existe una fila para hoy, ya se
// corrió; si no, sincroniza y registra el snapshot del día, dejando
// reportes/gráficas del dashboard al corriente. Se llama desde el timer diario
// y desde las lecturas del dashboard/requerimientos, así que corre "una vez al
// día" sin importar si dispara por uso de la app o por el cron.
let sincronizandoHoy: Promise<void> | null = null
export async function ensureDailySync(): Promise<void> {
  const hoy = new Date().toISOString().split('T')[0]
  const manana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const yaHoy = await repo.findHistorial(hoy, manana)
  if (yaHoy.length > 0) return

  // Evita carreras si varias peticiones llegan a la vez el primer momento del día
  if (!sincronizandoHoy) {
    sincronizandoHoy = (async () => {
      const pool = await getPool()
      await requerimentosRepo.syncUnicaStatuses(pool)
      await registrarSnapshotHistorial()
    })().finally(() => { sincronizandoHoy = null })
  }
  await sincronizandoHoy
}

function rangoMesActual(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  return { start: fmt(start), end: fmt(end) }
}

export async function getResumenMes() {
  const { start, end } = rangoMesActual()
  const [mantenimientos, lotes] = await Promise.all([
    repo.findMantenimientosEnRango(start, end),
    repo.findLotesEnRango(start, end),
  ])

  const porVehiculo = new Map<number, { vehiculo_id: number; vehiculo_nombre: string; vehiculo_tipo: string; cantidad: number; costo_total: number }>()
  for (const m of mantenimientos) {
    const entry = porVehiculo.get(m.vehiculo_id) ?? {
      vehiculo_id: m.vehiculo_id, vehiculo_nombre: m.vehiculo_nombre, vehiculo_tipo: m.vehiculo_tipo, cantidad: 0, costo_total: 0,
    }
    entry.cantidad += 1
    entry.costo_total += m.costo + m.piezas_total
    porVehiculo.set(m.vehiculo_id, entry)
  }
  const vehiculos = [...porVehiculo.values()].sort((a, b) => b.costo_total - a.costo_total)

  const mantenimientosCostoTotal = mantenimientos.reduce((s, m) => s + m.costo + m.piezas_total, 0)
  const piezasCostoTotal = lotes.reduce((s, l) => s + l.cantidad_inicial * l.costo_unitario, 0)

  return {
    rango: { start, end },
    mantenimientos: {
      count: mantenimientos.length,
      costo_total: mantenimientosCostoTotal,
      por_vehiculo: vehiculos,
    },
    piezas: {
      count: lotes.length,
      costo_total: piezasCostoTotal,
      lotes,
    },
  }
}

export async function getMantenimientosCalendario() {
  return repo.findAllMantenimientosConVehiculo()
}

function diffMeses(base: Date, ahora: Date): number {
  return (ahora.getFullYear() - base.getFullYear()) * 12 + (ahora.getMonth() - base.getMonth())
}

// mssql devuelve columnas `date`/`datetime` como objetos Date, no como string
function toDateStr(d: string | Date | null | undefined): string | null {
  if (d == null) return null
  if (d instanceof Date) return d.toISOString().split('T')[0]
  return d.split('T')[0]
}

interface Base {
  baseKm:    number
  baseFecha: Date | null
}

function baseDe(
  req:  RequerimientoFleet,
  link: { fecha: string | Date; km_actual: number } | null,
): Base {
  const baseKm = link?.km_actual ?? req.km_inicio ?? 0
  const baseFechaStr =
    toDateStr(link?.fecha) ??
    toDateStr(req.fecha_inicio) ??
    toDateStr(req.fecha_compra)
  return { baseKm, baseFecha: baseFechaStr ? new Date(`${baseFechaStr}T12:00:00`) : null }
}

function isOverdue(req: RequerimientoFleet, base: Base, now: Date): boolean {
  if ((req.trigger_mode === 'km' || req.trigger_mode === 'ambos') && req.intervalo_km != null && req.kilometraje != null) {
    if (req.kilometraje - base.baseKm >= req.intervalo_km) return true
  }
  if ((req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') && req.intervalo_meses != null && base.baseFecha) {
    if (diffMeses(base.baseFecha, now) >= req.intervalo_meses) return true
  }
  return false
}

function isWarning(req: RequerimientoFleet, base: Base, now: Date): boolean {
  if ((req.trigger_mode === 'km' || req.trigger_mode === 'ambos') && req.intervalo_km != null && req.kilometraje != null) {
    if (req.kilometraje - base.baseKm >= req.intervalo_km * 0.75) return true
  }
  if ((req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') && req.intervalo_meses != null && base.baseFecha) {
    if (diffMeses(base.baseFecha, now) >= req.intervalo_meses - 1) return true
  }
  return false
}

// Qué tan cerca está de vencer (o qué tan vencido está), como fracción del
// intervalo ya transcurrido: 1 = justo en el límite, >1 = vencido por esa
// proporción, <1 = todavía falta. Con 'ambos' se toma el más urgente de los dos.
// Sirve para ordenar tanto vencidos como por-vencer de más a menos urgente.
function calcularUrgencia(req: RequerimientoFleet, base: Base, now: Date): number {
  const ratios: number[] = []
  if ((req.trigger_mode === 'km' || req.trigger_mode === 'ambos') && req.intervalo_km != null && req.kilometraje != null) {
    ratios.push((req.kilometraje - base.baseKm) / req.intervalo_km)
  }
  if ((req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') && req.intervalo_meses != null && base.baseFecha) {
    ratios.push(diffMeses(base.baseFecha, now) / req.intervalo_meses)
  }
  return ratios.length ? Math.max(...ratios) : 0
}

interface RequerimientoFleetConUrgencia extends RequerimientoFleet {
  urgencia: number
}

async function clasificarRequerimientosFleet() {
  const requerimientos = await repo.findRequerimientosActivosFleet()
  const links = await repo.findMantenimientoLinks(requerimientos.map(r => r.id))

  const lastLinkByReq = new Map<number, { fecha: string; km_actual: number }>()
  for (const l of links) {
    if (!lastLinkByReq.has(l.requerimiento_id)) lastLinkByReq.set(l.requerimiento_id, l)
  }

  const now = new Date()
  const vencidos: RequerimientoFleetConUrgencia[] = []
  const porVencer: RequerimientoFleetConUrgencia[] = []

  for (const req of requerimientos) {
    const base = baseDe(req, lastLinkByReq.get(req.id) ?? null)
    const urgencia = calcularUrgencia(req, base, now)
    if (isOverdue(req, base, now)) vencidos.push({ ...req, urgencia })
    else if (isWarning(req, base, now)) porVencer.push({ ...req, urgencia })
  }

  vencidos.sort((a, b) => b.urgencia - a.urgencia)
  porVencer.sort((a, b) => b.urgencia - a.urgencia)

  return { vencidos, porVencer }
}

export interface RequerimientoVencido {
  id:              number
  nombre:          string
  categoria:       string | null
  vehiculo_id:     number
  vehiculo_nombre: string
}

export async function getRequerimientosVencidos(): Promise<RequerimientoVencido[]> {
  await ensureDailySync()
  const { vencidos } = await clasificarRequerimientosFleet()
  return vencidos
    .map(r => ({ id: r.id, nombre: r.nombre, categoria: r.categoria, vehiculo_id: r.vehiculo_id, vehiculo_nombre: r.vehiculo_nombre }))
}

export async function getRequerimientosPorVencer(): Promise<RequerimientoVencido[]> {
  await ensureDailySync()
  const { porVencer } = await clasificarRequerimientosFleet()
  return porVencer
    .map(r => ({ id: r.id, nombre: r.nombre, categoria: r.categoria, vehiculo_id: r.vehiculo_id, vehiculo_nombre: r.vehiculo_nombre }))
}

export async function registrarSnapshotHistorial(): Promise<void> {
  const { vencidos, porVencer } = await clasificarRequerimientosFleet()
  const hoy = new Date().toISOString().split('T')[0]
  await repo.upsertSnapshotHistorial(hoy, vencidos.length, porVencer.length)
}

export async function getHistorial(meses = 12): Promise<repo.HistorialDia[]> {
  await ensureDailySync()
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - meses, 1)
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const hoy = fmt(now)

  const dias = await repo.findHistorial(fmt(start), fmt(new Date(now.getFullYear(), now.getMonth() + 1, 1)))

  // Si el snapshot diario aún no corrió hoy, agrega el conteo en vivo para no mostrar el día en blanco.
  if (toDateStr(dias[dias.length - 1]?.fecha) !== hoy) {
    const { vencidos, porVencer } = await clasificarRequerimientosFleet()
    dias.push({ fecha: hoy, vencidos: vencidos.length, por_vencer: porVencer.length })
  }

  return dias
}
