// Lo capturado de un chequeo que todavía no se guarda, en el teléfono.
//
// Existe porque en el patio el chequeo se perdía entero por cosas que no tienen
// que ver con él: tocar la X, que el teléfono se bloqueara y el navegador
// recargara la pestaña, o quedarse sin señal y salir a buscarla. Con esto, al
// volver a abrir la unidad está lo que ya se había contestado.
//
// Uno por unidad y por día: el de ayer ya no sirve —el chequeo de hoy es otro—
// y se descarta solo. Vive en localStorage, que es del navegador de este
// teléfono: no viaja a la API ni lo ve nadie más.
//
// Cada acceso va en try/catch: en una ventana privada, o con el almacenamiento
// lleno o bloqueado, localStorage lanza. Sin borrador el formulario funciona
// igual que antes.

const PREFIJO = 'kora:chequeo-borrador:'

export interface BorradorChequeo {
  /** Cuándo se tocó por última vez, para decirlo al recuperarlo. */
  guardado_en:  string
  paso1:        'sin_novedad' | 'novedad' | 'sin_chofer' | null
  declaracion:  string
  declaradoPor: string
  ubicacion:    string
  lectura:      number | ''
  respuestas:   Record<string, {
    resultado: string | null
    valor:     string | null
    nota:      string
    severidad: string
  }>
  medidas:      Record<string, number | ''>
  notaFinal:    string
}

function hoyLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function llave(vehiculoId: number): string {
  return `${PREFIJO}${vehiculoId}:${hoyLocal()}`
}

// Los de días pasados se van al primer acceso del día: si no, cada unidad
// revisada dejaría uno para siempre.
function limpiarViejos() {
  try {
    const sufijoHoy = `:${hoyLocal()}`
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIJO) && !k.endsWith(sufijoHoy)) localStorage.removeItem(k)
    }
  } catch { /* sin almacenamiento: nada que limpiar */ }
}

export function leerBorrador(vehiculoId: number): BorradorChequeo | null {
  limpiarViejos()
  try {
    const crudo = localStorage.getItem(llave(vehiculoId))
    return crudo ? (JSON.parse(crudo) as BorradorChequeo) : null
  } catch {
    return null
  }
}

export function guardarBorrador(vehiculoId: number, b: Omit<BorradorChequeo, 'guardado_en'>) {
  try {
    localStorage.setItem(llave(vehiculoId), JSON.stringify({ ...b, guardado_en: new Date().toISOString() }))
  } catch { /* lleno o bloqueado: se sigue sin borrador */ }
}

export function borrarBorrador(vehiculoId: number) {
  try {
    localStorage.removeItem(llave(vehiculoId))
  } catch { /* nada que borrar */ }
}
