import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../config/constants';
import { badRequest } from './errors';

/** Wrap an async handler so rejected promises reach the Express error handler. */
export const asyncHandler =
  (
    handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

/**
 * AGENTS.md §10 — `?page=&limit=&q=&sort=`, maximum limit 100.
 * Out-of-range values are rejected rather than silently clamped, so the UI
 * cannot believe it received a full page when it did not.
 */
export function buildPagination(query: Record<string, unknown>): Pagination {
  const rawPage = query.page;
  const rawLimit = query.limit;

  let page = 1;
  if (rawPage !== undefined && rawPage !== '') {
    page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1) {
      throw badRequest('`page` must be an integer greater than or equal to 1');
    }
  }

  let limit = DEFAULT_PAGE_LIMIT;
  if (rawLimit !== undefined && rawLimit !== '') {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw badRequest('`limit` must be an integer greater than or equal to 1');
    }
    if (limit > MAX_PAGE_LIMIT) {
      throw badRequest(`\`limit\` must not exceed ${MAX_PAGE_LIMIT}`);
    }
  }

  return { page, limit, skip: (page - 1) * limit };
}

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
}

export const listMeta = ({ page, limit }: Pagination, total: number): ListMeta => ({
  page,
  limit,
  total,
});

/**
 * Build a Mongo sort spec from `?sort=field` / `?sort=-field`.
 * Only allow-listed fields are accepted so clients cannot sort by arbitrary
 * or injected keys.
 */
export function buildSort(
  sort: unknown,
  allowedFields: readonly string[],
  fallback: Record<string, 1 | -1>,
): Record<string, 1 | -1> {
  if (sort === undefined || sort === '') return fallback;

  if (typeof sort !== 'string') {
    throw badRequest('`sort` must be a string such as `createdAt` or `-createdAt`');
  }

  const direction: 1 | -1 = sort.startsWith('-') ? -1 : 1;
  const field = sort.startsWith('-') ? sort.slice(1) : sort;

  if (!allowedFields.includes(field)) {
    throw badRequest(`Cannot sort by "${field}". Allowed: ${allowedFields.join(', ')}`);
  }

  return { [field]: direction };
}

/** AGENTS.md §10 — success list envelope. */
export function sendData<T>(res: Response, data: T, meta?: ListMeta): void {
  if (meta) {
    res.status(200).json({ data, meta });
    return;
  }
  res.status(200).json({ data });
}