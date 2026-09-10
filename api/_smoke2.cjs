const fs = require('fs')
const cfg = JSON.parse(fs.readFileSync('local.settings.json','utf8').replace(/^\uFEFF/,''))
for (const [k,v] of Object.entries(cfg.Values)) process.env[k] = v
const R = (m) => require('./dist/src/repositories/' + m)
async function probar(nombre, fn) {
  try { const r = await fn()
    const n = Array.isArray(r) ? r.length : (r ? 1 : 0)
    console.log('OK  ', nombre.padEnd(44), n, 'fila(s)')
  } catch (e) { console.log('FALLA', nombre.padEnd(44), e.message.slice(0,140)) }
}
;(async () => {
  await probar('refacciones.findLotesByPiezaId', () => R('refaccionesRepo').findLotesByPiezaId(1))
  await probar('actividadDia.findComprasDelDia', () => R('actividadDiaRepo').findComprasDelDia('2026-01-15'))
  await probar('actividadDia.findActividadPorDia',() => R('actividadDiaRepo').findActividadPorDia('2026-01-01','2026-12-31'))
  await probar('costos.findComprasComparadas',   () => R('costosRepo').findComprasComparadas('2026-01-01','2026-12-31'))
  process.exit(0)
})()
