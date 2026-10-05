import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectMongo, disconnectMongo } from './db/mongo';
import { closeRedis, getRedis } from './db/redis';
import { logger } from './utils/logger';
import { installProcessGuards, onShutdown } from './utils/shutdown';

async function bootstrap(): Promise<void> {
  await connectMongo();

  // Establish Redis eagerly so /ready is meaningful immediately after boot.
  const redis = getRedis();
  if (redis.status === 'wait') await redis.connect();
  await redis.ping();

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Harvik HR API listening');
  });

  const shutdown = onShutdown([
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    () => closeRedis(),
    () => disconnectMongo(),
  ]);

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM').then(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT').then(() => process.exit(0));
  });
}

installProcessGuards();

bootstrap().catch((error: unknown) => {
  logger.fatal(
    { err: error instanceof Error ? error.message : String(error) },
    'API failed to start',
  );
  process.exit(1);
});