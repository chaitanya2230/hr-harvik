import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { badRequest } from '../utils/errors';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** AGENTS.md §11 — Zod validation on every route. */
export function zodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

const toApiError = (error: ZodError) =>
  badRequest('Request validation failed', zodIssues(error));

/** Replace a value on the request even when Express makes it a getter. */
const assign = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) assign(req, 'params', schemas.params.parse(req.params));
      if (schemas.query) assign(req, 'query', schemas.query.parse(req.query));
      if (schemas.body) assign(req, 'body', schemas.body.parse(req.body ?? {}));
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(toApiError(error));
        return;
      }
      next(error);
    }
  };
}

export type { z };