import { ClientPrincipal } from './auth'

export interface AuditEntry {
  user: ClientPrincipal
  accion: 'CREAR' | 'EDITAR' | 'ELIMINAR' | 'VER_SENSIBLE' | 'LOGIN' | 'EXPORTAR'
  tabla: string
  registroId?: string | number
  detalles?: Record<string, unknown>
  ipAddress?: string
}

export async function audit(entry: AuditEntry): Promise<void> {
  const msg = `[AUDIT] ${entry.accion} | ${entry.user.userDetails} (${entry.user.userId}) | ${entry.tabla}${entry.registroId !== undefined ? ` #${entry.registroId}` : ''}${entry.detalles ? ` | ${JSON.stringify(entry.detalles)}` : ''}`
  console.log(msg)
}

export function getClientIp(req: { headers: { get(name: string): string | null } }): string | undefined {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
}
