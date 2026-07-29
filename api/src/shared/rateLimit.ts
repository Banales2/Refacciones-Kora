// Límite de peticiones por minuto. Un cliente legítimo (la app abierta en una
// pestaña) hace decenas de peticiones por minuto en el peor caso; cientos
// seguidas son un script, no una persona.
//
// El conteo vive en memoria del proceso: es un freno contra abuso automatizado,
// no una cuota exacta. Si el Function App escala a varias instancias, cada una
// lleva su propio conteo y el límite efectivo se multiplica por el número de
// instancias. Para una cuota real haría falta almacenamiento compartido (Redis).
//
// Este módulo no importa nada del proyecto a propósito: errors.ts lo importa
// para responder el 429, y auth.ts para contar; heredar de AppError crearía un
// ciclo de imports que revienta al cargar.

export class RateLimitError extends Error {
  readonly status = 429
  readonly code = 'RATE_LIMIT'
  constructor(public retryAfter: number) {
    super('Demasiadas peticiones. Espera un momento e intenta de nuevo.')
    this.name = 'RateLimitError'
  }
}

const VENTANA_MS = 60_000
// Configurables sin recompilar (local.settings.json / App Settings).
// Lecturas: la app dispara varias en paralelo al abrir cada pantalla.
const LIMITE_LECTURA = Number(process.env.RATE_LIMIT_PER_MIN) || 300
// Escrituras: capturar a mano no pasa de unas decenas por minuto, así que el
// margen es mucho más estrecho. Es lo que de verdad interesa frenar: un script
// que dé de alta, edite o borre en masa.
const LIMITE_ESCRITURA = Number(process.env.RATE_LIMIT_WRITE_PER_MIN) || 60

const METODOS_ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

type Ventana = { conteo: number; expira: number }
const ventanas = new Map<string, Ventana>()

// Se limpian las ventanas vencidas de vez en cuando para que el Map no crezca
// sin control con IPs que ya no vuelven.
let ultimaLimpieza = Date.now()
function limpiar(ahora: number) {
  if (ahora - ultimaLimpieza < VENTANA_MS) return
  ultimaLimpieza = ahora
  for (const [clave, v] of ventanas) {
    if (v.expira <= ahora) ventanas.delete(clave)
  }
}

function contar(clave: string, limite: number, ahora: number): void {
  const actual = ventanas.get(clave)
  if (!actual || actual.expira <= ahora) {
    ventanas.set(clave, { conteo: 1, expira: ahora + VENTANA_MS })
    return
  }
  actual.conteo += 1
  if (actual.conteo > limite) {
    throw new RateLimitError(Math.ceil((actual.expira - ahora) / 1000))
  }
}

// Cuenta una petición para `clave` y lanza RateLimitError si pasó del límite.
// La clave debe identificar a quien llama: el usuario si está autenticado, y la
// IP si no (ver limitarPeticion en auth.ts).
//
// Las escrituras se cuentan dos veces: contra el total de la ventana y contra
// un contador propio, más estricto. Así una ráfaga de altas o borrados se corta
// aunque el total general todavía no llegue a su tope.
export function consumir(clave: string, metodo?: string): void {
  const ahora = Date.now()
  limpiar(ahora)

  contar(clave, LIMITE_LECTURA, ahora)
  if (metodo && METODOS_ESCRITURA.has(metodo.toUpperCase())) {
    contar(`w:${clave}`, LIMITE_ESCRITURA, ahora)
  }
}

// Solo para pruebas: reinicia el conteo.
export function _reset(): void {
  ventanas.clear()
}
