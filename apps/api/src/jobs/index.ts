import type { Job } from 'bullmq';
import { logger } from '../utils/logger';
import { QUEUE_NAMES } from './queues';

/**
 * P0 provides the BullMQ scaffold only. Real handlers are added by the phase
 * that owns each queue (see `QUEUE_NAMES`).
 *
 * Every job must be idempotent (AGENTS.md §11) so a retry after a crash cannot
 * double-apply its effects.
 */
export const dailyMaintenance = async (_job: Job): Promise<{ at: string }> => {
  logger.info('Scheduled maintenance heartbeat');
  return { at: new Date().toISOString() };
};

/** Job name -> handler map, consumed by `worker.ts`. */
export const jobHandlers: Record<string, (job: Job) => Promise<unknown>> = {
  [QUEUE_NAMES.maintenance]: dailyMaintenance,
};