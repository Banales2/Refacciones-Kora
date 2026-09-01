// Los "primeros servicios": el puñado de intervalos con los que arranca un
// preventivo antes de caer en su ciclo normal. Un fabricante puede pedir el
// asentamiento a los 5,000 km, el siguiente 10,000 km después y de ahí cada
// 15,000; eso se guarda como [5000, 10000] con intervalo_km = 15000.
//
// Se leen como distancias ENTRE servicios, igual que `intervalo_km`, no como
// marcas de odómetro: el vencimiento siempre se mide contra el kilometraje del
// servicio anterior, así que un escalón es "cuánto falta desde el último".
//
// En la base viven como texto ("5000,10000") por lo que explica la migración
// 011; estas funciones son el único lugar que conoce ese formato.

// Tope de escalones que se aceptan. Ningún fabricante pide más de dos o tres;
// el límite está para que un pegado accidental no llene la columna.
export const MAX_INTERVALOS_INICIALES = 10

export function parseIntervalosIniciales(csv: string | null | undefined): number[] | null {
  if (csv == null) return null
  const lista = csv
    .split(',')
    .map((p) => parseInt(p.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
  return lista.length ? lista : null
}

export function serializeIntervalosIniciales(lista: number[] | null | undefined): string | null {
  if (lista == null || lista.length === 0) return null
  return lista.join(',')
}

// El intervalo que aplica al PRÓXIMO servicio, sabiendo cuántos ya se hicieron.
// Con [5000, 10000] e intervalo 15000: el primero se pide a los 5,000 km del
// arranque, el segundo 10,000 km después del primero, y del tercero en adelante
// cada 15,000. Sin escalones -o ya agotados- devuelve el intervalo de ciclo.
export function intervaloKmVigente(
  intervaloKm:      number | null,
  iniciales:        number[] | null | undefined,
  serviciosHechos:  number,
): number | null {
  if (iniciales && serviciosHechos < iniciales.length) return iniciales[serviciosHechos]
  return intervaloKm
}
