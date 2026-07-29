import { HttpResponseInit, InvocationContext } from '@azure/functions'
import { ZodError } from 'zod'
import { AuthError } from './auth'
import { RateLimitError } from './rateLimit'

export class AppError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string = 'ERROR'
  ) {
    super(message)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR')
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} no encontrado`, 404, 'NOT_FOUND')
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT')
  }
}

function esViolacionDeLlaveForanea(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { number?: number }).number === 547
}

export function handleError(err: unknown, context: InvocationContext): HttpResponseInit {
  if (err instanceof AuthError) return { status: err.status, jsonBody: { error: err.message } }
  // 429 lleva Retry-After para que el cliente sepa cuánto esperar.
  if (err instanceof RateLimitError) {
    return {
      status: err.status,
      headers: { 'Retry-After': String(err.retryAfter) },
      jsonBody: { error: err.message, code: err.code },
    }
  }
  if (err instanceof AppError) return { status: err.status, jsonBody: { error: err.message, code: err.code } }
  if (err instanceof ZodError) return { status: 400, jsonBody: { error: 'Datos inválidos', details: err.flatten().fieldErrors } }
  // 547 = violación de llave foránea. Casi siempre es un borrado de algo que
  // todavía está en uso: es un conflicto del usuario, no una falla del sistema,
  // y no debe contestarse con un 500 que además filtra nombres de tablas.
  if (esViolacionDeLlaveForanea(err)) {
    return {
      status: 409,
      jsonBody: {
        error: 'No se puede eliminar: hay otros registros que dependen de este.',
        code: 'CONFLICT',
      },
    }
  }
  context.error('Error no manejado:', err)
  const detail = err instanceof Error ? err.message : String(err)
  return { status: 500, jsonBody: { error: 'Error interno', detail } }
}
