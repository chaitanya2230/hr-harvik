import Redis, { type RedisOptions } from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type RedisClient = Redis;

/**
 * AGENTS.md §3 — Redis 7 backs BullMQ, dashboard cache, rate limiting and the
 * refresh-token denylist.
 */
export function createRedisClient(overrides: RedisOptions = {}): RedisClient {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    // BullMQ requires this to be null so blocking commands are never aborted.
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    ...overrides,
  });

  client.on('error', (error: Error) => {
    // Logged, never rethrown — an ioredis 'error' event without a listener
    // would crash the process.
    logger.error({ err: error.message }, 'Redis client error');
  });

  return client;
}

let client: RedisClient | null = null;

export function getRedis(): RedisClient {
  client ??= createRedisClient();
  return client;
}

/**
 * Swap the shared client. Tests inject `ioredis-mock`; production uses real
 * Redis 7 from `REDIS_URL`. This is an infrastructure seam only — business
 * logic always talks to the same interface.
 */
export function setRedisClient(next: RedisClient): void {
  client = next;
}

export function resetRedisClient(): void {
  client = null;
}

export async function closeRedis(): Promise<void> {
  const active = client;
  client = null;
  if (!active) return;
  try {
    await active.quit();
  } catch {
    active.disconnect();
  }
}

/** Used by `/ready` — AGENTS.md §11 requires readiness to verify Redis. */
export async function pingRedis(): Promise<boolean> {
  const active = getRedis();
  if (active.status === 'end' || active.status === 'close') {
    await active.connect();
  }
  return (await active.ping()) === 'PONG';
}