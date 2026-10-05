import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { MulterError } from 'multer';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { ZodError } from 'zod';
import { env, isProduction } from '../config/env';
import { ApiError, ErrorCode, isApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { zodIssues } from './validate';

/** 404 fallback for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  const error = new ApiError(
    404,
    ErrorCode.NOT_FOUND,
    `Route ${req.method} ${req.path} not found`,
  );
  res.status(404).json(error.toBody());
}

/**
 * Single error translation point implementing the AGENTS.md §10 envelope:
 *   { "error": { "code", "message", "details" } }
 *
 * Unknown errors are logged with their stack and reported as a generic 500 so
 * internals never reach the client.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Express 4 requires the 4-arity signature even though `_next` is unused.
  if (res.headersSent) {
    res.end();
    return;
  }

  let apiError: ApiError;

  if (isApiError(error)) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', zodIssues(error));
  } else if (error instanceof TokenExpiredError) {
    apiError = new ApiError(401, ErrorCode.UNAUTHORIZED, 'Session expired');
  } else if (error instanceof JsonWebTokenError) {
    apiError = new ApiError(401, ErrorCode.UNAUTHORIZED, 'Invalid authentication token');
  } else if (isBodyParserError(error)) {
    // body-parser (express.json / urlencoded) signals a malformed or oversized
    // body with a `status` property. §10 requires 400 for validation failures,
    // not a 500.
    apiError = new ApiError(
      400,
      ErrorCode.VALIDATION_ERROR,
      'Request body could not be parsed',
    );
  } else if (error instanceof MulterError) {
    apiError =
      error.code === 'LIMIT_FILE_SIZE'
        ? new ApiError(
            413,
            ErrorCode.PAYLOAD_TOO_LARGE,
            `File exceeds the ${env.MAX_UPLOAD_MB}MB limit`,
          )
        : new ApiError(400, ErrorCode.VALIDATION_ERROR, `Upload rejected: ${error.message}`);
  } else if (error instanceof mongoose.Error.ValidationError) {
    apiError = new ApiError(
      400,
      ErrorCode.VALIDATION_ERROR,
      'Document validation failed',
      Object.entries(error.errors).map(([path, issue]) => ({
        path,
        message: issue.message,
      })),
    );
  } else if (error instanceof mongoose.Error.CastError) {
    apiError = new ApiError(
      400,
      ErrorCode.VALIDATION_ERROR,
      `Invalid value for "${error.path}"`,
    );
  } else if (isDuplicateKeyError(error)) {
    apiError = new ApiError(409, ErrorCode.CONFLICT, duplicateKeyMessage(error));
  } else {
    apiError = new ApiError(500, ErrorCode.INTERNAL_ERROR, 'Internal server error');
  }

  const logPayload = {
    err: error instanceof Error ? error.message : String(error),
    code: apiError.code,
    status: apiError.statusCode,
    method: req.method,
    path: req.path,
    requestId: req.requestId,
  };

  if (apiError.statusCode >= 500) {
    logger.error(
      { ...logPayload, stack: error instanceof Error ? error.stack : undefined },
      'Unhandled request error',
    );
  } else {
    logger.warn(logPayload, 'Request rejected');
  }

  const body = apiError.toBody();
  if (!isProduction && apiError.statusCode >= 500 && error instanceof Error) {
    (body.error as Record<string, unknown>).stack = error.stack;
  }

  res.status(apiError.statusCode).json(body);
}

/**
 * `body-parser` errors (`entity.parse.failed`, `entity.too.large`) are plain
 * `SyntaxError`/`Error` instances carrying an HTTP `status`. Without this they
 * would fall through to the generic 500 branch.
 */
const isBodyParserError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { status?: unknown }).status === 'number' &&
  typeof (error as { type?: unknown }).type === 'string' &&
  (error as { type: string }).type.startsWith('entity.');

interface MongoServerError {
  code?: number;
  keyPattern?: Record<string, unknown>;
  keyValue?: Record<string, unknown>;
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as MongoServerError).code === 11000 &&
  (error as MongoServerError).keyPattern !== undefined;

const duplicateKeyMessage = (error: unknown): string => {
  const { keyValue } = error as MongoServerError;
  const fields = Object.keys(keyValue ?? {});
  if (fields.length === 0) return 'A record with these values already exists';
  return `A record with this ${fields.join(', ')} already exists`;
};