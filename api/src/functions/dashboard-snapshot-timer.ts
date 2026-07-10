import { app, InvocationContext, Timer } from '@azure/functions'
import * as service from '../services/dashboardService'

export async function dashboardSnapshotTimer(_myTimer: Timer, ctx: InvocationContext): Promise<void> {
  try {
    await service.ensureDailySync()
  } catch (err) {
    ctx.error('Error al registrar snapshot de requerimientos:', err)
    throw err
  }
}

app.timer('dashboard-snapshot-timer', {
  schedule: '0 5 0 * * *', // todos los días a las 00:05
  handler: dashboardSnapshotTimer,
})
