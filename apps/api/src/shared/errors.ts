/**
 * Shared error contract (Requirements sections 15.2 and 29).
 *
 * Every failure that reaches a client is expressed as an AppError so the response
 * envelope, HTTP status, and retry semantics stay consistent across modules.
 * SEC-018: internal detail is never exposed for server-side failures.
 */

export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly fieldErrors: readonly FieldError[];
    readonly correlationId: string;
    readonly retryable: boolean;
  };
}

interface AppErrorOptions {
  readonly fieldErrors?: readonly FieldError[];
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly fieldErrors: readonly FieldError[];
  readonly retryable: boolean;
  /** Client-safe messages are surfaced verbatim; everything else is replaced. */
  readonly expose: boolean;

  constructor(code: string, message: string, statusCode: number, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.fieldErrors = options.fieldErrors ?? [];
    this.retryable = options.retryable ?? (statusCode >= 500 || statusCode === 429);
    this.expose = statusCode < 500;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request failed validation.', fieldErrors: readonly FieldError[] = []) {
    super('VALIDATION_FAILED', message, 422, { fieldErrors });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super('UNAUTHENTICATED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'This action is not permitted.') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super('RESOURCE_NOT_FOUND', message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(code = 'RESOURCE_CONFLICT', message = 'The resource changed since it was read.') {
    super(code, message, 409);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests.') {
    super('RATE_LIMITED', message, 429);
  }
}

export class ProviderUnavailableError extends AppError {
  constructor(message = 'A required provider is unavailable.') {
    super('PROVIDER_UNAVAILABLE', message, 503, { retryable: true });
  }
}

interface HttpLikeError {
  statusCode?: number;
  code?: string;
  message?: string;
  validation?: unknown;
}

/**
 * Normalises any thrown value into the single response envelope.
 * Unknown failures become an opaque 500 so no internal detail leaks.
 */
export function toErrorBody(error: unknown, correlationId: string): { status: number; body: ErrorBody } {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          fieldErrors: error.fieldErrors,
          correlationId,
          retryable: error.retryable
        }
      }
    };
  }

  // Fastify schema validation and other framework errors carry a status code.
  const candidate = error as HttpLikeError;
  const status = typeof candidate?.statusCode === 'number' ? candidate.statusCode : 500;
  const clientSafe = status < 500;

  return {
    status,
    body: {
      error: {
        code: clientSafe ? (candidate?.code ?? 'REQUEST_ERROR') : 'INTERNAL_ERROR',
        message: clientSafe ? (candidate?.message ?? 'The request could not be processed.') : 'An unexpected error occurred.',
        fieldErrors: [],
        correlationId,
        retryable: status >= 500 || status === 429
      }
    }
  };
}
