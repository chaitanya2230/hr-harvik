import { defineConfig } from 'vitest/config';

// Set here rather than in the npm script so the mode works identically on
// Windows and POSIX without a `cross-env` dependency. Vitest propagates
// `process.env` to its worker processes, so `tests/setup/env-vars.ts` observes
// the same value in each worker.
process.env.HR_DOCKER_TESTS = '1';

/**
 * Runs the SAME suites as `vitest.config.ts` against the real services from
 * `docker compose` (MongoDB 7 replica set + Redis 7) instead of
 * `mongodb-memory-server` + `ioredis-mock`.
 *
 * The point is coverage of the production `RedisStore` rate limiter, which the
 * mock cannot run. Nothing is skipped or relaxed — `HR_DOCKER_TESTS=1` forces
 * the real store while leaving every assertion identical.
 *
 *   docker compose up -d mongo rs-init redis
 *   npm run test:docker
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Same setup file as the default config; it branches on HR_DOCKER_TESTS.
    setupFiles: ['tests/setup/setup.ts'],
    globalSetup: ['tests/setup/docker-global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
