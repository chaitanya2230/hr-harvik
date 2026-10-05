import { afterAll, beforeAll } from 'vitest';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';

// MUST be first: sets process.env before `src/config/env.ts` is imported.
import './env-vars';

import { connectMongo, disconnectMongo } from '../../src/db/mongo';
import { setRedisClient } from '../../src/db/redis';

/**
 * Redis test seam.
 *
 * No Redis server can run on this machine (no Windows build, no Docker, no
 * WSL), so the shared client is an in-memory double. It supports every command
 * the application issues (GET/SET/EX/DEL/EXISTS/INCR/TTL/SCAN/FLUSHALL), so
 * refresh-token denylisting and cache behaviour are genuinely exercised.
 *
 * BullMQ and `rate-limit-redis` need a real server (Lua evaluation) and are
 * therefore not exercised by the automated suite — see docs/DECISIONS.md.
 */
const redisMock = new RedisMock();
setRedisClient(redisMock as unknown as Redis);

export const getRedisMock = (): RedisMock => redisMock;

export const flushRedis = async (): Promise<void> => {
  await redisMock.flushall();
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