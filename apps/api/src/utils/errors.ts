/**
 * AGENTS.md §11 — error envelope:
 *
 *   { "error": { "code": "...", "message": "...", "details": {} } }
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Operational (expected) error. Anything that is *not* an ApiError is treated
 * as a bug, logged with its stack, and reported to the client as a generic
 * 500 so internals never leak.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly isOperational = true;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const badRequest = (message: string, details?: unknown): ApiError =>
  new ApiError(400, ErrorCode.VALIDATION_ERROR, message, details);

export const unauthorized = (message = 'Authentication required'): ApiError =>
  new ApiError(401, ErrorCode.UNAUTHORIZED, message);

export const forbidden = (message = 'You do not have permission to perform this action'): ApiError =>
  new ApiError(403, ErrorCode.FORBIDDEN, message);

export const notFound = (resource = 'Resource'): ApiError =>
  new ApiError(404, ErrorCode.NOT_FOUND, `${resource} not found`);

export const conflict = (message: string, details?: unknown): ApiError =>
  new ApiError(409, ErrorCode.CONFLICT, message, details);

/** AGENTS.md §10 — business rule violation. */
export const unprocessable = (message: string, details?: unknown): ApiError =>
  new ApiError(422, ErrorCode.BUSINESS_RULE_VIOLATION, message, details);

export const rateLimited = (message = 'Too many requests'): ApiError =>
  new ApiError(429, ErrorCode.RATE_LIMITED, message);

export const internalError = (message = 'Internal server error'): ApiError =>
  new ApiError(500, ErrorCode.INTERNAL_ERROR, message);

export const serviceUnavailable = (message = 'Service unavailable'): ApiError =>
  new ApiError(503, ErrorCode.SERVICE_UNAVAILABLE, message);

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}