import type { RequestHandler } from 'express';
import { unauthorized } from '../utils/errors';
import { asyncHandler } from '../utils/http';
import { loadActiveAccount, verifyAccessToken } from '../modules/auth/auth.service';

const BEARER_PREFIX = 'bearer ';

/**
 * AGENTS.md §6 — every protected route requires a valid `Authorization:
 * Bearer <access token>` header.
 *
 * The account is re-read from MongoDB on each request so that deactivating a
 * login (for example when an employee is Relieved, §8.10) invalidates access
 * immediately instead of waiting for the 15m token to expire.
 */
export const requireAuth: RequestHandler = asyncHandler(
  async (req, _res, next): Promise<void> => {
    const header = req.get('authorization');
    if (!header || !header.toLowerCase().startsWith(BEARER_PREFIX)) {
      throw unauthorized('Authentication required');
    }

    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) throw unauthorized('Authentication required');

    const claims = verifyAccessToken(token);
    const account = await loadActiveAccount(claims.sub);

    // Token was validly signed but the account is gone or disabled.
    if (!account) throw unauthorized('Your session is no longer valid. Please sign in again.');

    req.user = account;
    next();
  },
);