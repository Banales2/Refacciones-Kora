import { HttpResponseInit, InvocationContext } from '@azure/functions'
import { ZodError } from 'zod'
import { AuthError } from './auth'

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

export function handleError(err: unknown, context: InvocationContext): HttpResponseInit {
  if (err instanceof AuthError) return { status: err.status, jsonBody: { error: err.message } }
  if (err instanceof AppError) return { status: err.status, jsonBody: { error: err.message, code: err.code } }
  if (err instanceof ZodError) return { status: 400, jsonBody: { error: 'Datos inválidos', details: err.flatten().fieldErrors } }
  context.error('Error no manejado:', err)
  const detail = err instanceof Error ? err.message : String(err)
  return { status: 500, jsonBody: { error: 'Error interno', detail } }
}
