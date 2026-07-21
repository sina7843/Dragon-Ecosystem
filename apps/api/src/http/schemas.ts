/**
 * Machine-readable API schemas (section 32.2).
 *
 * These JSON Schemas do double duty: Fastify validates and serialises with them at
 * runtime, and @fastify/swagger derives the OpenAPI document from the same source,
 * so the published contract cannot drift from the enforced one.
 */

export const errorResponseSchema = {
  $id: 'ErrorResponse',
  type: 'object',
  required: ['error'],
  additionalProperties: false,
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'fieldErrors', 'correlationId', 'retryable'],
      additionalProperties: false,
      properties: {
        code: { type: 'string', description: 'Stable machine-readable error code.' },
        message: { type: 'string' },
        fieldErrors: {
          type: 'array',
          items: {
            type: 'object',
            required: ['field', 'code', 'message'],
            additionalProperties: false,
            properties: {
              field: { type: 'string' },
              code: { type: 'string' },
              message: { type: 'string' }
            }
          }
        },
        correlationId: { type: 'string' },
        retryable: { type: 'boolean' }
      }
    }
  }
} as const;

export const moneySchema = {
  $id: 'Money',
  type: 'object',
  description: 'Exact monetary value. Amounts are integers in the asset minor unit; never floating point.',
  required: ['assetCode', 'amountInteger', 'scale'],
  additionalProperties: false,
  properties: {
    assetCode: { type: 'string', enum: ['IRR', 'DRC'] },
    amountInteger: { type: 'integer' },
    scale: { type: 'integer', minimum: 0 }
  }
} as const;

export const healthResponseSchema = {
  $id: 'HealthResponse',
  type: 'object',
  required: ['status', 'service', 'version', 'time'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ok'] },
    service: { type: 'string' },
    version: { type: 'string' },
    time: { type: 'string', format: 'date-time' }
  }
} as const;

export const readinessResponseSchema = {
  $id: 'ReadinessResponse',
  type: 'object',
  required: ['status', 'checks'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ready', 'not_ready'] },
    checks: {
      type: 'object',
      required: ['mongo'],
      additionalProperties: false,
      properties: {
        mongo: { type: 'string', enum: ['ok', 'failed'] }
      }
    }
  }
} as const;

export const metaResponseSchema = {
  $id: 'MetaResponse',
  type: 'object',
  required: ['name', 'version', 'environment', 'locales', 'defaultLocale'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    version: { type: 'string' },
    environment: { type: 'string', enum: ['development', 'test', 'production'] },
    locales: { type: 'array', items: { type: 'string' } },
    defaultLocale: { type: 'string' }
  }
} as const;

export const sharedSchemas = [
  errorResponseSchema,
  moneySchema,
  healthResponseSchema,
  readinessResponseSchema,
  metaResponseSchema
];

/** Standard error responses attached to every documented operation. */
export const commonErrorResponses = {
  400: { $ref: 'ErrorResponse#', description: 'Malformed request.' },
  404: { $ref: 'ErrorResponse#', description: 'Resource not found.' },
  500: { $ref: 'ErrorResponse#', description: 'Unexpected server error.' }
} as const;
