import { HttpRequest } from '@azure/functions'

export interface ClientPrincipal {
  identityProvider: string
  userId: string
  userDetails: string
  userRoles: string[]
}

export class AuthError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'AuthError'
  }
}

export function getClientPrincipal(req: HttpRequest): ClientPrincipal | null {
  const header = req.headers.get('x-ms-client-principal')
  if (!header) return null

  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8')
    return JSON.parse(decoded) as ClientPrincipal
  } catch {
    return null
  }
}

export function requireRole(req: HttpRequest, ...roles: string[]): ClientPrincipal {
  const principal = getClientPrincipal(req)
  if (!principal) {
    throw new AuthError('No autenticado', 401)
  }
  const tieneRol = roles.some((r) => principal.userRoles.includes(r))
  if (!tieneRol) {
    throw new AuthError('Sin permisos suficientes', 403)
  }
  return principal
}