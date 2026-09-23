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

function pedirUsuario(): Promise<UserInfo | null> {
  enCurso ??= fetch('/.auth/me')
    .then((r) => r.json())
    .then((data) => (data.clientPrincipal as UserInfo | null) || null)
    .catch(() => null)
    .then((user) => { respuesta = user; return user })
  return enCurso
}

export function useAuth() {
  const [user, setUser] = useState<UserInfo | null>(respuesta ?? null)
  const [loading, setLoading] = useState(respuesta === undefined)

  useEffect(() => {
    if (respuesta !== undefined) return
    let vigente = true
    pedirUsuario().then((u) => {
      if (!vigente) return
      setUser(u)
      setLoading(false)
    })
    return () => { vigente = false }
  }, [])

  return { user, loading, isAuthenticated: !!user }
}
