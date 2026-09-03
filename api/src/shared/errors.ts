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

// SQL Server usa el 547 para dos cosas distintas: la violación de una llave
// foránea y la de un CHECK. Solo la primera es "algo depende de este registro";
// confundirlas manda al usuario a buscar dependencias que no existen mientras
// el problema real es un valor fuera de rango.
function esConflicto547(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { number?: number }).number === 547
}

function esViolacionDeCheck(err: unknown): boolean {
  const mensaje = (err as { message?: string })?.message ?? ''
  return /CHECK constraint/i.test(mensaje)
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
  if (esConflicto547(err) && !esViolacionDeCheck(err)) {
    return {
      status: 409,
      jsonBody: {
        error: 'No se puede eliminar: hay otros registros que dependen de este.',
        code: 'CONFLICT',
      },
    }
  }
  // Un CHECK violado es un valor que la base rechaza, no una dependencia. Sale
  // como 400 y se registra completo: el detalle nombra la constraint, que es lo
  // que hace falta para arreglarlo.
  if (esConflicto547(err) && esViolacionDeCheck(err)) {
    context.error('Violación de CHECK:', err)
    return {
      status: 400,
      jsonBody: {
        error: 'La base de datos rechazó un valor de este registro.',
        code: 'VALIDATION_ERROR',
      },
    }
  }
  context.error('Error no manejado:', err)
  const detail = err instanceof Error ? err.message : String(err)
  return { status: 500, jsonBody: { error: 'Error interno', detail } }
}
