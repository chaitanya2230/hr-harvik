import rateLimit, {
  MemoryStore,
  type Options,
  type RateLimitRequestHandler,
  type Store,
} from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { RATE_LIMIT_STORE } from '../config/env';
import { getRedis } from '../db/redis';
import { ApiError, ErrorCode } from '../utils/errors';

/** Replies `rate-limit-redis` consumes (INCR / PTTL / DEL / EXPIRE). */
type RedisScalarReply = boolean | number | string | Array<boolean | number | string>;

/**
 * AGENTS.md §11 — rate limiting backed by Redis 7 so counters are shared
 * across API replicas.
 *
 * `RATE_LIMIT_STORE=auto` (default) resolves to `MemoryStore` under
 * NODE_ENV=test and `RedisStore` everywhere else. The automated suite normally
 * runs without a Redis server because `rate-limit-redis` needs Lua evaluation,
 * which `ioredis-mock` cannot do; `npm run test:docker` re-runs the same suites
 * against the real Redis 7 container with `RATE_LIMIT_STORE=redis` so the
 * production path is covered too. Everything under test — the window, the
 * limit, `skipSuccessfulRequests` and the error envelope — is identical for
 * both stores. See docs/DECISIONS.md D-16.
 */
const createStore = (prefix: string): Store => {
  if (RATE_LIMIT_STORE === 'memory') return new MemoryStore();

  return new RedisStore({
    prefix,
    // `ioredis.call` is typed as Promise<unknown>; the store only ever reads
    // scalar replies, so narrow here at the one boundary.
    sendCommand: ((...args: string[]) =>
      getRedis().call(...(args as [string, ...string[]]))) as (
      ...args: string[]
    ) => Promise<RedisScalarReply>,
  });
};

/** Respond with the standard AGENTS.md §10 error envelope. */
const envelopeHandler: Options['handler'] = (_req, res) => {
  const error = new ApiError(
    429,
    ErrorCode.RATE_LIMITED,
    'Too many requests. Please wait a moment and try again.',
  );
  res.status(429).json(error.toBody());
};

/** AGENTS.md §11 — login limit is 5 requests per minute per IP. */
export const loginLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: createStore('ratelimit:login:'),
  handler: envelopeHandler,
  // Skip successful logins so only genuine failures consume the budget.
  skipSuccessfulRequests: true,
});

/** Broad safety net for the rest of the API. */
export const apiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: createStore('ratelimit:api:'),
  handler: envelopeHandler,
  skip: (req) => req.path === '/health' || req.path === '/ready',
});
