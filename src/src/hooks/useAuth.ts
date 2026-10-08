// Usuario autenticado: consulta /.auth/me (autenticación integrada de Azure
// Static Web Apps con Azure AD) y expone el usuario, sus roles y el estado
// de carga. App.tsx lo usa como guardia de acceso a toda la aplicación.
import { useEffect, useState } from 'react'

export interface UserInfo {
  identityProvider: string
  userId: string
  userDetails: string
  userRoles: string[]
}

// Se pide una sola vez por carga de página y se comparte. Antes cada
// componente tenía su copia y la pedía por su cuenta: App esperaba la suya,
// pero Layout arrancaba con la propia vacía, así que su primer render no
// conocía el rol y abría el Dashboard aunque el rol no pudiera verlo.
// Con la respuesta ya guardada, quien se monte después la tiene desde el
// primer render.
let respuesta: UserInfo | null | undefined
let enCurso: Promise<UserInfo | null> | null = null

/**
 * `/.auth/me` no contestó: sin red, o la plataforma caída. No es lo mismo que
 * "no hay sesión" —esa respuesta sí llega, con `clientPrincipal` en null—, y
 * tratarlas igual mandaba a quien abría la app sin señal a la pantalla de
 * iniciar sesión, que sin señal tampoco funciona.
 */
class SinRespuesta extends Error {}

function pedirUsuario(): Promise<UserInfo | null> {
  enCurso ??= fetch('/.auth/me')
    .catch(() => { throw new SinRespuesta() })
    .then((r) => {
      if (!r.ok) throw new SinRespuesta()
      return r.json()
    })
    .then((data) => (data.clientPrincipal as UserInfo | null) || null)
    .then(
      (user) => { respuesta = user; return user },
      (err) => {
        // Sin guardar nada: el siguiente intento vuelve a preguntar.
        enCurso = null
        throw err instanceof SinRespuesta ? err : new SinRespuesta()
      },
    )
  return enCurso
}

export function useAuth() {
  const [user, setUser] = useState<UserInfo | null>(respuesta ?? null)
  const [loading, setLoading] = useState(respuesta === undefined)
  const [sinRed, setSinRed] = useState(false)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (respuesta !== undefined) {
      setUser(respuesta); setLoading(false); setSinRed(false)
      return
    }
    let vigente = true
    setLoading(true)
    pedirUsuario().then(
      (u) => {
        if (!vigente) return
        setUser(u); setSinRed(false); setLoading(false)
      },
      () => {
        if (!vigente) return
        setSinRed(true); setLoading(false)
      },
    )
    return () => { vigente = false }
  }, [intento])

  // Al volver la señal se reintenta solo: quien abrió la app en el patio no
  // tiene por qué saber que hay que recargar.
  useEffect(() => {
    if (!sinRed) return
    const alVolver = () => setIntento((n) => n + 1)
    window.addEventListener('online', alVolver)
    return () => window.removeEventListener('online', alVolver)
  }, [sinRed])

  return {
    user, loading, isAuthenticated: !!user,
    /** No se pudo preguntar por la sesión (no es que no haya). */
    sinRed,
    reintentar: () => setIntento((n) => n + 1),
  }
}
