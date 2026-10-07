import type { Job } from 'bullmq';
import { logger } from '../utils/logger';
import { QUEUE_NAMES } from './queues';
import { runNightlyAttendanceJob } from '../modules/attendance/attendance.service';
import { runScheduledReminders } from '../modules/notifications/reminder.service';
import { runScheduledYearRollover } from '../modules/leave/leave-balance.service';
import { deliverNotificationEmail } from '../modules/notifications/notification.service';
import {
  generateCsvString,
  generateXlsxBuffer,
  setExportJobResult,
  type ColumnDefinition,
} from '../modules/reports/export.service';
import {
  runPdfGenerationJob,
  type PdfGenerationPayload,
} from '../modules/documents/pdf-queue.service';

/**
 * AGENTS.md §8.11, §8.12, §11 — BullMQ handlers.
 * Every job must be idempotent so a retry after a crash cannot double-apply its effects.
 */
export const dailyMaintenance = async (_job: Job): Promise<{ at: string; rollover: unknown }> => {
  logger.info('Scheduled maintenance heartbeat');
  // AGENTS.md §8.12/§14 — leave balances must roll over into the new year.
  // Idempotent; a failure is logged and retried on the next heartbeat rather
  // than failing the whole maintenance run.
  let rollover: unknown = null;
  try {
    rollover = await runScheduledYearRollover();
  } catch (error: unknown) {
    logger.error({ error }, 'Leave year rollover failed; will retry on next heartbeat');
  }
  return { at: new Date().toISOString(), rollover };
};

export const attendanceNightlyJob = async (job: Job<{ date?: string }>): Promise<unknown> => {
  logger.info({ jobId: job.id, date: job.data?.date }, 'Running nightly attendance job');
  const result = await runNightlyAttendanceJob(job.data?.date);
  logger.info({ result }, 'Completed nightly attendance job');
  return result;
};

export const scheduledRemindersJob = async (job: Job<{ date?: string }>): Promise<unknown> => {
  logger.info({ jobId: job.id, date: job.data?.date }, 'Running scheduled reminders job');
  const result = await runScheduledReminders(job.data?.date);
  logger.info({ result }, 'Completed scheduled reminders job');
  return result;
};

export const notificationDeliveryJob = async (
  job: Job<{ notificationId: string }>,
): Promise<unknown> => {
  logger.info({ jobId: job.id, notificationId: job.data?.notificationId }, 'Processing notification delivery job');
  const result = await deliverNotificationEmail(job.data.notificationId);
  return result;
};

export const reportExportJob = async (
  job: Job<{
    jobId: string;
    ownerId: string;
    reportType: string;
    format: 'csv' | 'xlsx';
    filename: string;
    columns: ColumnDefinition[];
    rows: Array<Record<string, unknown>>;
  }>,
): Promise<unknown> => {
  logger.info({ jobId: job.id, exportId: job.data?.jobId, format: job.data?.format }, 'Processing report export job');
  const { jobId: exportId, ownerId, reportType, format, filename, columns, rows } = job.data;
  const complete = (data?: Buffer | string): Promise<void> =>
    setExportJobResult(exportId, {
      status: 'completed',
      format,
      filename,
      ownerId,
      ...(data !== undefined ? { data } : {}),
    });
  try {
    if (format === 'csv') {
      await complete(generateCsvString(columns, rows));
    } else {
      await complete(await generateXlsxBuffer(reportType, columns, rows));
    }
    return { exportId, status: 'completed' };
  } catch (error: unknown) {
    logger.error({ error, exportId }, 'Failed to process report export job');
    await setExportJobResult(exportId, {
      status: 'failed',
      format,
      filename,
      ownerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * §3 / §8.7 — queued PDF document generation. The state transition
 * (pending → completed/failed) is recorded by `runPdfGenerationJob`; a throw
 * here lets BullMQ apply its retry/backoff policy.
 */
export const pdfGenerationJob = async (job: Job<PdfGenerationPayload>): Promise<unknown> => {
  logger.info(
    { jobId: job.id, pdfJobId: job.data?.jobId, templateId: job.data?.templateId },
    'Processing PDF generation job',
  );
  return runPdfGenerationJob(job.data);
};

/** Job name -> handler map, consumed by `worker.ts`. */
export const jobHandlers: Record<string, (job: Job) => Promise<unknown>> = {
  [QUEUE_NAMES.maintenance]: dailyMaintenance,
  [QUEUE_NAMES.attendanceNightly]: attendanceNightlyJob,
  [QUEUE_NAMES.reminders]: scheduledRemindersJob,
  [QUEUE_NAMES.notifications]: notificationDeliveryJob,
  [QUEUE_NAMES.reportExport]: reportExportJob,
  [QUEUE_NAMES.pdfGeneration]: pdfGenerationJob,
};
