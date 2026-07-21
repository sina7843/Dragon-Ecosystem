/**
 * Thin API client for the same-origin `/api/v1` surface.
 *
 * Server responses use one error envelope (Requirements section 15.2). Field
 * errors carry stable machine-readable codes, which the UI maps to localized
 * messages so the API never has to be localized (section 13.1).
 */

export interface ApiFieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly fieldErrors: readonly ApiFieldError[];
  readonly correlationId: string;
  readonly retryable: boolean;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }

  fieldError(field: string): ApiFieldError | undefined {
    return this.body.fieldErrors.find((error) => error.field === field);
  }
}

const UNKNOWN_ERROR: ApiErrorBody = {
  code: 'NETWORK_ERROR',
  message: 'The request could not be completed.',
  fieldErrors: [],
  correlationId: '',
  retryable: true
};

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      // Session cookies are same-origin; this keeps intent explicit.
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers
      }
    });
  } catch {
    throw new ApiRequestError(0, UNKNOWN_ERROR);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = (payload as { error?: ApiErrorBody } | null)?.error;
    throw new ApiRequestError(response.status, body ?? UNKNOWN_ERROR);
  }
  return payload as T;
}
