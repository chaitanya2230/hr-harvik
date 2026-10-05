import type { Request, Response } from 'express';
import { mongoReadyState, pingMongo } from '../../db/mongo';
import { pingRedis } from '../../db/redis';
import { isProduction } from '../../config/env';

type Check = { ok: boolean; error?: string };

const describe = async (
  probe: () => Promise<boolean>,
  readyState?: () => number,
): Promise<Check> => {
  try {
    if (readyState && readyState() !== 1) return { ok: false, error: 'not connected' };
    return { ok: await probe() };
  } catch (error) {
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