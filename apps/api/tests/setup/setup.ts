import { afterAll, beforeAll } from 'vitest';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';

// MUST be first: sets process.env before `src/config/env.ts` is imported.
import { DOCKER_TESTS } from './env-vars';

import { connectMongo, disconnectMongo } from '../../src/db/mongo';
import { getRedis, setRedisClient } from '../../src/db/redis';

/**
 * Redis test seam.
 *
 * By default the suite runs without a Redis server (Redis publishes no Windows
 * build), so the shared client is an in-memory double. It supports every command
 * the application issues (GET/SET/EX/DEL/EXISTS/INCR/TTL/SCAN/FLUSHALL), so
 * refresh-token denylisting and cache behaviour are genuinely exercised.
 *
 * `rate-limit-redis` and BullMQ do need a real server (Lua evaluation), so
 * `npm run test:docker` re-runs the same suites with HR_DOCKER_TESTS=1 against
 * the compose stack, where no mock is injected and the production RedisStore is
 * used. See docs/DECISIONS.md D-16.
 */
const redisMock: RedisMock | null = DOCKER_TESTS ? null : new RedisMock();
if (redisMock) setRedisClient(redisMock as unknown as Redis);

/**
 * The client suites should inject. The mock normally; in docker mode the real
 * container client, which `getRedis()` builds lazily from `REDIS_URL`.
 */
export const getRedisMock = (): RedisMock =>
  (DOCKER_TESTS ? getRedis() : redisMock) as unknown as RedisMock;

export const flushRedis = async (): Promise<void> => {
  if (redisMock) await redisMock.flushall();
  else await getRedis().flushall();
};

/**
 * Every suite gets a live MongoDB connection before it runs.
 *
 * Without this, any suite that does not itself call the seed would buffer
 * mongoose operations until the 10s buffer timeout and surface as a spurious
 * 500. `connectMongo` is idempotent (it returns early when already connected),
 * so suites that seed first are unaffected.
 */
beforeAll(async () => {
  await connectMongo();
});

afterAll(async () => {
  await disconnectMongo();
});