import { getRedis } from '../db/redis';
import { logger } from './logger';

/**
 * Thin typed wrapper over Redis for caching.
 *
 * AGENTS.md §3 — the dashboard summary is cached with a 60s TTL and the cache
 * is invalidated after relevant employee / leave / asset / license / exit /
 * onboarding writes.
 */
export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const raw = await getRedis().get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    // A corrupt entry must never take down the request.
    logger.warn({ err: (error as Error).message, key }, 'Discarding malformed cache entry');
    await getRedis().del(key);
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await getRedis().del(...keys);
}

/**
 * Delete every key matching a glob. Uses SCAN rather than KEYS so a large key
 * space cannot block Redis.
 */
export async function cacheDeletePattern(pattern: string): Promise<number> {
  const redis = getRedis();
  let cursor = '0';
  let removed = 0;

  do {
    const [next, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    if (found.length > 0) {
      await redis.del(...found);
      removed += found.length;
    }
  } while (cursor !== '0');

  return removed;
}