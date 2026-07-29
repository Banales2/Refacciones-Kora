import { HttpRequest } from '@azure/functions'
import { consumir } from './rateLimit'

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

// Todos los endpoints pasan por requireRole, así que el límite se aplica aquí
// una sola vez en lugar de repetirlo en cada función. Se cuenta por usuario
// cuando hay sesión (para que varias personas en la misma oficina, que salen
// por la misma IP, no compartan cuota) y por IP cuando no la hay.
function limitarPeticion(req: HttpRequest, principal: ClientPrincipal | null): void {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  consumir(principal ? `u:${principal.userId}` : `ip:${ip ?? 'desconocida'}`, req.method)
}

export function requireRole(req: HttpRequest, ...roles: string[]): ClientPrincipal {
  const principal = getClientPrincipal(req)
  limitarPeticion(req, principal)
  if (!principal) {
    throw new AuthError('No autenticado', 401)
  }
  const tieneRol = roles.some((r) => principal.userRoles.includes(r))
  if (!tieneRol) {
    throw new AuthError('Sin permisos suficientes', 403)
  }
  return principal
}