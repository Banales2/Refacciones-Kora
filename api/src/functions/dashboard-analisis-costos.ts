import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/costosService'
import { parseRango } from '../shared/rangoReporte'
import { fechaMexico } from '../shared/fechaMexico'

// Ventanas permitidas. Es una lista cerrada y no un número libre porque el
// análisis recorre todas las recargas y mantenimientos del rango: dejar pasar
// `?dias=100000` sería barrer la base entera desde una URL.
const DIAS_VALIDOS = [30, 90, 180, 365]
const DIAS_DEFAULT = 90

// Ventana móvil de `dias` que termina hoy, como [start, end).
function ventanaMovil(dias: number): { start: string; end: string } {
  const hoy = new Date(`${fechaMexico()}T12:00:00`)
  const corrida = (d: number) => {
    const x = new Date(hoy)
    x.setDate(x.getDate() + d)
    return fechaMexico(x)
  }
  return { start: corrida(-(dias - 1)), end: corrida(1) }
}

// Un rango explícito (?anio o ?desde/?hasta) gana sobre ?dias: lo pide el
// reporte, mientras que ?dias es lo que trae el tablero. `parseRango` ya
// acota la amplitud, así que sigue sin poder barrerse la base entera.
function rangoPedido(req: HttpRequest): { start: string; end: string } {
  const pedido = Number(req.query.get('dias'))
  const dias = DIAS_VALIDOS.includes(pedido) ? pedido : DIAS_DEFAULT
  return parseRango(req.query) ?? ventanaMovil(dias)
}

export async function dashboardAnalisisCostos(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const data = await service.getAnalisisCostos(rangoPedido(req))
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

// Las cargas a revisar completas, sin el tope del tablero, para el PDF por
// sucursal. `?sucursal=` es el id o 'sin' ("Sin base fija"); sin él, todas.
export async function dashboardAnomaliasCostos(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const sucursal = req.query.get('sucursal') || null
    if (sucursal != null && sucursal !== 'sin' && !/^[1-9]\d*$/.test(sucursal)) {
      return { status: 400, jsonBody: { error: 'Sucursal inválida.' } }
    }
    const data = await service.getAnomaliasCostos(rangoPedido(req), sucursal)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-analisis-costos', {
  methods: ['GET'],
  route: 'dashboard/analisis-costos',
  authLevel: 'anonymous',
  handler: dashboardAnalisisCostos,
})

app.http('dashboard-analisis-costos-anomalias', {
  methods: ['GET'],
  route: 'dashboard/analisis-costos/anomalias',
  authLevel: 'anonymous',
  handler: dashboardAnomaliasCostos,
})
