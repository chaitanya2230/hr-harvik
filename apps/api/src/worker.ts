import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { connectMongo, disconnectMongo } from './db/mongo';
import { closeRedis, getRedis } from './db/redis';
import { logger } from './utils/logger';
import { installProcessGuards, onShutdown } from './utils/shutdown';
import { jobHandlers } from './jobs';
import { DAILY_08_00, QUEUE_NAMES } from './jobs/queues';

/**
 * AGENTS.md §3 / §16 P0 — the BullMQ worker process.
 *
 * Runs as its own container so a slow PDF or export job can never block an HTTP
 * request.
 */
async function bootstrap(): Promise<void> {
  await connectMongo();

  const connection: ConnectionOptions = getRedis();
  if (getRedis().status === 'wait') await connection.connect();

  const workers = Object.entries(jobHandlers).map(
    ([queueName, handler]) =>
      new Worker(queueName, handler, {
        connection,
        concurrency: 1,
      }),
  );

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      logger.error(
        { queue: worker.name, jobId: job?.id, attempts: job?.attemptsMade, err: error.message },
        'Job failed',
      );
    });
    worker.on('error', (error) => {
      logger.error({ queue: worker.name, err: error.message }, 'Worker error');
    });
  }

  // A fixed jobId + repeat pattern makes registration idempotent across
  // restarts (AGENTS.md §11 — idempotent scheduled jobs).
  const maintenanceQueue = new Queue(QUEUE_NAMES.maintenance, { connection });
  await maintenanceQueue.add(
    'daily-heartbeat',
    {},
    {
      repeat: { pattern: DAILY_08_00 },
      jobId: 'maintenance:daily-heartbeat',
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
  await maintenanceQueue.close();

  const attendanceQueue = new Queue(QUEUE_NAMES.attendanceNightly, { connection });
  await attendanceQueue.add(
    'nightly-attendance-sync',
    {},
    {
      repeat: { pattern: '0 0 * * *' },
      jobId: 'attendance:nightly-sync',
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
  await attendanceQueue.close();

  const remindersQueue = new Queue(QUEUE_NAMES.reminders, { connection });
  await remindersQueue.add(
    'daily-reminders-sync',
    {},
    {
      repeat: { pattern: DAILY_08_00 },
      jobId: 'reminders:daily-sync',
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
  await remindersQueue.close();

  logger.info(
    { queues: workers.map((worker) => worker.name) },
    'Harvik HR worker started',
  );

  const shutdown = onShutdown([
    ...workers.map((worker) => () => worker.close()),
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
    'Worker failed to start',
  );
  process.exit(1);
});