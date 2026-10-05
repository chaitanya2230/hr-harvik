import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { getApp, fromIp } from '../support/helpers';
import { seedDatabase } from '../support/helpers';

/**
 * AGENTS.md §11 / §14 — login is limited to 5 requests per minute per IP.
 *
 * The backing store differs between test and production (see
 * `src/middleware/rateLimit.ts` and docs/DECISIONS.md), but the window, the
 * limit, `skipSuccessfulRequests` and the 429 error envelope are the production
 * configuration, so these assertions hold in both environments.
 */

/** bcrypt cost 12 makes each real login expensive, so a 60s budget per test. */
const SLOW_TEST_TIMEOUT = 60_000;

const attemptLogin = (ip: string, password: string) =>
  request(getApp())
    .post('/api/v1/auth/login')
    .set(...fromIp(ip))
    .send({ email: 'employee@harviktech.com', password });

describe('rate limiting (AGENTS.md §11)', () => {
  beforeAll(async () => {
    await seedDatabase();
  });

  it(
    'allows five failed logins from one IP, then returns 429',
    async () => {
      const ip = '198.51.100.200';
      const wrong = 'WrongPassword1';

      const failures = await Promise.all(
        Array.from({ length: 5 }, () => attemptLogin(ip, wrong)),
      );

      failures.forEach((response, index) => {
        expect(response.status, `attempt ${index + 1}`).toBe(401);
      });

      const blocked = await attemptLogin(ip, wrong);

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(typeof blocked.body.error.message).toBe('string');
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    'publishes the standard RateLimit headers (§11)',
    async () => {
      const response = await attemptLogin('198.51.100.201', 'WrongPassword1');

      expect(response.status).toBe(401);

      // `standardHeaders: 'draft-7'` emits a single combined `RateLimit` plus a
      // `RateLimit-Policy`; the separate draft-6 headers must be absent.
      const rateLimit = String(response.headers['ratelimit'] ?? '');
      expect(rateLimit).toMatch(/limit=5/);
      expect(rateLimit).toMatch(/remaining=[0-4]/);
      expect(rateLimit).toMatch(/reset=\d+/);
      expect(response.headers['ratelimit-policy']).toBe('5;w=60');

      // Legacy X-RateLimit-* headers must stay off.
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      expect(response.headers['x-ratelimit-remaining']).toBeUndefined();
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    'counts each IP separately',
    async () => {
      const exhausted = '198.51.100.202';
      const wrong = 'WrongPassword1';

      // Exhaust one bucket.
      await Promise.all(Array.from({ length: 5 }, () => attemptLogin(exhausted, wrong)));
      expect((await attemptLogin(exhausted, wrong)).status).toBe(429);

      // A different client IP must still be served.
      const other = await attemptLogin('198.51.100.203', wrong);
      expect(other.status).toBe(401);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    'does not spend budget on successful logins (skipSuccessfulRequests)',
    async () => {
      const ip = '198.51.100.204';

      // Six valid logins in a row: none may be throttled.
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        const response = await attemptLogin(ip, 'Passw0rd!');
        expect(response.status, `attempt ${attempt}`).toBe(200);
      }
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    'a successful login does not consume the failure budget',
    async () => {
      const ip = '198.51.100.205';

      expect((await attemptLogin(ip, 'Passw0rd!')).status).toBe(200);

      // The full failure allowance is still available afterwards.
      const failures = await Promise.all(
        Array.from({ length: 5 }, () => attemptLogin(ip, 'WrongPassword1')),
      );
      failures.forEach((response, index) => {
        expect(response.status, `failure ${index + 1}`).toBe(401);
      });

      expect((await attemptLogin(ip, 'WrongPassword1')).status).toBe(429);
    },
    SLOW_TEST_TIMEOUT,
  );
});