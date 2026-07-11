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

export function useAuth() {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/.auth/me')
      .then((r) => r.json())
      .then((data) => {
        setUser(data.clientPrincipal || null)
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  return { user, loading, isAuthenticated: !!user }
}