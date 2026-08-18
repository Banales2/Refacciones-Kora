// Regla del odómetro: al registrar un mantenimiento o una recarga se captura la
// lectura del odómetro, y el vehículo adopta esa lectura solo si es mayor a la
// que ya tenía. Un registro capturado tarde, con un km menor, no lo hace
// retroceder.
//
// Espeja `avanzarKilometraje` del backend, que es quien de verdad aplica el
// cambio; aquí sirve para avisar antes de guardar (ver ConfirmarAvanceKm).
// `kmVehiculo` es el odómetro actual, o null si la unidad todavía no tiene uno.
export function avanzaOdometro(kmCapturado: number, kmVehiculo: number | null): boolean {
  if (!(kmCapturado > 0)) return false
  return kmVehiculo == null || kmCapturado > kmVehiculo
}
