// Los "primeros servicios": el puñado de intervalos con los que arranca un
// preventivo antes de caer en su ciclo normal. Un fabricante puede pedir el
// asentamiento a los 5,000 km, el siguiente 10,000 km después y de ahí cada
// 15,000; eso se captura como [5000, 10000] con intervalo_km = 15000.
//
// Se leen como distancias ENTRE servicios, igual que `intervalo_km`, no como
// marcas de odómetro: el vencimiento siempre se mide contra el kilometraje del
// servicio anterior. Espeja api/src/shared/intervalos.ts.

// Tope de escalones que acepta la API.
export const MAX_INTERVALOS_INICIALES = 10

const nf = new Intl.NumberFormat('es-MX')

// Las marcas de odómetro a las que caería cada uno de los primeros servicios,
// contadas desde el arranque del requerimiento. Es lo que la gente quiere ver
// al capturar: "5000, 10000" no dice a simple vista que el segundo cae a los
// 15,000 km.
export function marcasOdometro(iniciales: number[]): number[] {
  const marcas: number[] = []
  let acumulado = 0
  for (const km of iniciales) {
    acumulado += km || 0
    marcas.push(acumulado)
  }
  return marcas
}

// Una línea para leer de corrido lo que se capturó:
// "1º a los 5,000 km · 2º a los 15,000 km · después cada 15,000 km".
export function resumenPrimerosServicios(
  iniciales:   number[] | null | undefined,
  intervaloKm: number | null | undefined,
): string | null {
  if (!iniciales || iniciales.length === 0) return null
  const partes = marcasOdometro(iniciales).map((m, i) => `${i + 1}º a los ${nf.format(m)} km`)
  if (intervaloKm) partes.push(`después cada ${nf.format(intervaloKm)} km`)
  return partes.join(' · ')
}

// El intervalo en km que le toca al PRÓXIMO servicio, sabiendo cuántos ya se
// hicieron. Con [5000, 10000] e intervalo 15000: el primero se pide a los 5,000
// km del arranque, el segundo 10,000 km después del primero, y del tercero en
// adelante cada 15,000. Sin escalones -o ya agotados- devuelve el de ciclo.
// Espeja intervaloKmVigente de la API, que es quien manda en el tablero.
export function intervaloKmVigente(
  intervaloKm:     number | null,
  iniciales:       number[] | null | undefined,
  serviciosHechos: number,
): number | null {
  if (iniciales && serviciosHechos < iniciales.length) return iniciales[serviciosHechos]
  return intervaloKm
}
