import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * AGENTS.md §11 — observability: every request carries an id that appears in
 * the logs and in the error response, so a user-reported failure can be traced.
 *
 * An inbound `x-request-id` is honoured (so a reverse proxy/UI can correlate)
 * but sanitised to a bounded, safe character set.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get(REQUEST_ID_HEADER);
  const sanitized =
    inbound && /^[A-Za-z0-9._-]{1,128}$/.test(inbound) ? inbound : randomUUID();

  req.requestId = sanitized;
  res.setHeader(REQUEST_ID_HEADER, sanitized);
  next();
}