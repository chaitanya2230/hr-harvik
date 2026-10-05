import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../../src/db/mongo';
import { setRedisClient } from '../../src/db/redis';
import { getRedisMock } from '../setup/setup';
import { getApp } from '../support/helpers';

/**
 * AGENTS.md §11 — operational endpoints.
 *
 * `/ready` must verify MongoDB *and* Redis, so the failure paths are driven by
 * real infrastructure faults (a disconnected mongoose connection, a Redis
 * client whose PING fails) rather than by stubbing the controller.
 */

describe('health endpoints (AGENTS.md §11)', () => {
  beforeAll(async () => {
    await connectMongo();
  });

  afterEach(async () => {
    // Restore the shared test doubles after any induced outage.
    setRedisClient(getRedisMock() as unknown as Redis);
    await connectMongo();
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  describe('GET /health (liveness)', () => {
    it('reports the service is up', async () => {
      const response = await request(getApp()).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('harvik-hr-api');
      expect(typeof response.body.uptimeSeconds).toBe('number');
      expect(Date.parse(response.body.timestamp)).not.toBeNaN();
    });

    it('stays up while MongoDB is disconnected', async () => {
      // Liveness must not depend on a dependency, or the orchestrator will
      // restart the container instead of waiting for the database.
      await disconnectMongo();

      const response = await request(getApp()).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    it('does not advertise framework internals', async () => {
      const response = await request(getApp()).get('/health');

      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('needs no credentials', async () => {
      await request(getApp()).get('/health').expect(200);
    });
  });

  describe('GET /ready (readiness)', () => {
    it('is 200 when MongoDB and Redis both answer', async () => {
      const response = await request(getApp()).get('/ready');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ready');
      expect(response.body.checks.mongo.ok).toBe(true);
      expect(response.body.checks.redis.ok).toBe(true);
    });

    it('is 503 when Redis fails, while MongoDB still passes', async () => {
      const broken = {
        status: 'ready',
        ping: async () => {
          throw new Error('READONLY You can not write against a read only replica');
        },
      } as unknown as Redis;
      setRedisClient(broken);

      const response = await request(getApp()).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
      expect(response.body.checks.redis.ok).toBe(false);
      expect(response.body.checks.redis.error).toContain('READONLY');
      expect(response.body.checks.mongo.ok).toBe(true);
    });

    it('is 503 when the MongoDB connection is down', async () => {
      await disconnectMongo();

      const response = await request(getApp()).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
      expect(response.body.checks.mongo.ok).toBe(false);
      expect(response.body.checks.mongo.error).toBe('not connected');
    });

    it('is 503 when both dependencies are down', async () => {
      await disconnectMongo();
      setRedisClient({
        status: 'end',
        connect: async () => {
          throw new Error('Connection is closed');
        },
        ping: async () => {
          throw new Error('Connection is closed');
        },
      } as unknown as Redis);

      const response = await request(getApp()).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body.checks.mongo.ok).toBe(false);
      expect(response.body.checks.redis.ok).toBe(false);
    });

    it('does not hang when a dependency accepts the command but never answers', async () => {
      // This is the failure mode that actually occurred in the container stack:
      // after the API container's network was replaced, ioredis still reported
      // `status: 'ready'` while its socket was dead, and `PING` was queued
      // forever because the client sets `enableOfflineQueue: true` and
      // `maxRetriesPerRequest: null`. A probe that never settles turns /ready
      // into a hang, and nginx answers 504 instead of the 503 that tells an
      // orchestrator to take the instance out of rotation.
      setRedisClient({
        status: 'ready',
        ping: () => new Promise<string>(() => undefined),
      } as unknown as Redis);

      const startedAt = Date.now();
      const response = await request(getApp()).get('/ready');
      const elapsedMs = Date.now() - startedAt;

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
      expect(response.body.checks.redis.ok).toBe(false);
      expect(response.body.checks.redis.error).toBe('timeout');
      // MongoDB is fine, so only the hung dependency may be reported bad.
      expect(response.body.checks.mongo.ok).toBe(true);
      // Must fail fast. Without the bounded probe this request never returns
      // and the suite only ends when vitest kills it.
      expect(elapsedMs).toBeLessThan(15_000);
    });

    it('reports a timestamp on every response', async () => {
      const response = await request(getApp()).get('/ready');

      expect(Date.parse(response.body.timestamp)).not.toBeNaN();
    });
  });
});