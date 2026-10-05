import type { Request, Response } from 'express';
import { mongoReadyState, pingMongo } from '../../db/mongo';
import { pingRedis } from '../../db/redis';
import { isProduction } from '../../config/env';

type Check = { ok: boolean; error?: string };

/**
 * A readiness probe must fail fast.
 *
 * AGENTS.md §11 requires `/ready` to verify MongoDB and Redis. Both drivers can
 * otherwise block indefinitely on a half-open socket, which turns this endpoint
 * into a hang instead of a verdict — an orchestrator or nginx then sees only a
 * gateway timeout:
 *
 * - mongoose leaves `socketTimeoutMS` unset (0 = no timeout) and
 *   `serverSelectionTimeoutMS` governs *initial* server selection only, so a
 *   `ping` issued over a connection the peer has dropped never returns.
 * - ioredis is created with `enableOfflineQueue: true` and
 *   `maxRetriesPerRequest: null`, so a command on a dead connection is queued
 *   rather than rejected.
 *
 * The `readyState` pre-check catches the common case quickly but is not
 * sufficient alone: a driver only notices a dropped socket the next time it is
 * used, and reports itself connected until then.
 */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * Rejection sentinel rather than a custom Error subclass: `instanceof` is
 * unreliable when the TypeScript target downlevels `class extends Error`.
 */
const PROBE_TIMEOUT = Symbol('probe-timeout');

const withTimeout = async (probe: () => Promise<boolean>): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(PROBE_TIMEOUT), PROBE_TIMEOUT_MS);
    // Never hold the event loop open on account of a probe timer.
    timer.unref?.();
  });

  try {
    return await Promise.race([probe(), expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const describe = async (
  probe: () => Promise<boolean>,
  readyState?: () => number,
): Promise<Check> => {
  try {
    if (readyState && readyState() !== 1) return { ok: false, error: 'not connected' };
    return { ok: await withTimeout(probe) };
  } catch (error) {
    if (error === PROBE_TIMEOUT) return { ok: false, error: 'timeout' };
    return {
      ok: false,
      // Never leak internal details in production.
      error: isProduction ? 'unavailable' : (error as Error).message,
    };
  }
};

/** Liveness — the process is up. Deliberately does not touch dependencies. */
export async function health(_req: Request, res: Response): Promise<void> {
  res.status(200).json({
    status: 'ok',
    service: 'harvik-hr-api',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}

/**
 * AGENTS.md §11 — `/ready` must verify both MongoDB and Redis.
 * Returns 503 while either dependency is unavailable so the container is
 * pulled out of rotation by the orchestrator.
 */
export async function ready(_req: Request, res: Response): Promise<void> {
  const [mongo, redis] = await Promise.all([
    describe(pingMongo, mongoReadyState),
    describe(pingRedis),
  ]);

  const isReady = mongo.ok && redis.ok;

  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'not_ready',
    checks: { mongo, redis },
    timestamp: new Date().toISOString(),
  });
}