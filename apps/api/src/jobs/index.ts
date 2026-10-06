import type { Job } from 'bullmq';
import { logger } from '../utils/logger';
import { QUEUE_NAMES } from './queues';
import { runNightlyAttendanceJob } from '../modules/attendance/attendance.service';

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

export const attendanceNightlyJob = async (job: Job<{ date?: string }>): Promise<unknown> => {
  logger.info({ jobId: job.id, date: job.data?.date }, 'Running nightly attendance job');
  const result = await runNightlyAttendanceJob(job.data?.date);
  logger.info({ result }, 'Completed nightly attendance job');
  return result;
};

/** Job name -> handler map, consumed by `worker.ts`. */
export const jobHandlers: Record<string, (job: Job) => Promise<unknown>> = {
  [QUEUE_NAMES.maintenance]: dailyMaintenance,
  [QUEUE_NAMES.attendanceNightly]: attendanceNightlyJob,
};