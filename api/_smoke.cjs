const fs = require('fs')
const cfg = JSON.parse(fs.readFileSync('local.settings.json','utf8').replace(/^\uFEFF/,''))
for (const [k,v] of Object.entries(cfg.Values)) process.env[k] = v

const R = (m) => require('./dist/src/repositories/' + m)
async function probar(nombre, fn) {
  try {
    const r = await fn()
    const n = Array.isArray(r) ? r.length : (r && r.data ? r.data.length : (r ? 1 : 0))
    console.log('OK  ', nombre.padEnd(42), n, 'fila(s)')
  } catch (e) {
    console.log('FALLA', nombre.padEnd(42), e.message.slice(0, 120))
  }
}
;(async () => {
  await probar('facturasRepo.findAll',            () => R('facturasRepo').findAll({page:1,pageSize:20}))
  await probar('facturasRepo.findAll (busqueda)', () => R('facturasRepo').findAll({page:1,pageSize:20,search:'A'}))
  await probar('lotesRepo.findByPieza',           () => R('refaccionesRepo').findLotesByPieza(1))
  await probar('lotesRepo.findGastosDeProveedor', () => R('lotesRepo').findGastosDeProveedor(1))
  await probar('inventarioRepo.existencias',      () => R('inventarioRepo').findExistencias(1))
  await probar('detalleMtto.findDisponibles',     () => R('detalleMttoPiezaRepo').findDisponibles())
  await probar('piezasVehiculo.findHistorial',    () => R('piezasVehiculoRepo').findHistorial(1))
  await probar('piezasVehiculo.consumosSinMontar',() => R('piezasVehiculoRepo').findConsumosSinMontar(1,1))
  await probar('descuadresRepo.findAbiertos',     () => R('descuadresRepo').findAbiertos())
  await probar('tiposPiezaRepo.findAll',          () => R('tiposPiezaRepo').findAll())
  process.exit(0)
})()
