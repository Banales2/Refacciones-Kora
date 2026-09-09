// Envoltorio de fetch para la API interna (/api, Azure Functions): agrega los
// headers JSON, convierte respuestas de error en ApiError y redirige al login
// de Azure AD cuando la sesión expiró (401).
//
// Está hecho para aguantar internet malo, no para ser rápido: una conexión
// lenta tiene todo el tiempo del mundo (ver TIMEOUT_MS), y lo que falla se
// reintenta desde React Query en vez de dejar el formulario vacío. Ver
// `esReintentable`, que es lo que decide qué se reintenta.
class ApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Tope de espera de una llamada. Holgado a propósito: con la API dormida
 * (Azure la apaga si nadie la usa) y una conexión mala, una consulta tarda de
 * verdad, y cortarla a los 10 segundos convierte "lento" en "roto".
 *
 * Existe porque sin él una conexión que se cae sin avisar deja el fetch colgado
 * para siempre: nunca falla, así que nunca se reintenta y el formulario se
 * queda vacío hasta que el usuario cierra la pantalla. Con el tope falla, se
 * reintenta solo, y casi siempre la segunda entra.
 *
 * El número sale de medir el caso peor —una conexión que acepta y no contesta—
 * contra los reintentos de React Query (ver main.tsx): con 60 s el campo se
 * quedaba 5 min y medio diciendo "Cargando…" antes de rendirse. Con 30 s son
 * unos 165 s, que sigue dando margen de sobra a una consulta lenta de verdad.
 */
const TIMEOUT_MS = 30_000

/** El status que se le da a lo que nunca llegó a la API. */
export const SIN_RESPUESTA = 0

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  // AbortSignal.timeout no sirve aquí: hay navegadores en uso que no lo traen.
  const ctrl = new AbortController()
  const corte = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...options,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  } catch (err) {
    // Ni siquiera hubo respuesta: wifi caído, DNS, o el tope de arriba. Se
    // marca con status 0 para que el reintento lo distinga de un 4xx —que sí
    // llegó y no tiene caso repetir—.
    throw new ApiError(
      SIN_RESPUESTA,
      (err as Error)?.name === 'AbortError'
        ? 'La conexión tardó demasiado. Se volverá a intentar.'
        : 'No se pudo conectar. Revisa tu internet; se volverá a intentar.',
      'SIN_RESPUESTA',
    )
  } finally {
    clearTimeout(corte)
  }

  if (res.status === 401) {
    // Sesión expirada → redirige a login
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=' + window.location.pathname
    throw new ApiError(401, 'No autenticado')
  }

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    // Un 502/504 del proxy no trae JSON: sin este texto el usuario ve "Error" a
    // secas y no sabe que basta con esperar.
    const generico = res.status >= 500
      ? 'El servidor no respondió a tiempo. Se volverá a intentar.'
      : 'Error'
    throw new ApiError(res.status, data.error ?? generico, data.code)
  }

  return data as T
}

/**
 * ¿Vale la pena repetir esta llamada? Solo lo que se arregla esperando: lo que
 * no llegó a la API, lo que el servidor no alcanzó a atender (5xx), el 408 y el
 * 429. Un 400 o un 404 van a fallar igual las tres veces.
 */
export function esReintentable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  return err.status === SIN_RESPUESTA || err.status >= 500 || err.status === 408 || err.status === 429
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export { ApiError }
