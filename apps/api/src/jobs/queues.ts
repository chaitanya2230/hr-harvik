/**
 * AGENTS.md §3 — BullMQ queues backed by Redis 7.
 *
 * Queue names are declared here so the API, the worker and any future
 * scheduled job agree on a single identifier. Which phase introduces real
 * handlers is noted per queue; P0 wires the infrastructure only.
 *
 * BullMQ builds Redis keys as `bull:<queueName>:...` and therefore REJECTS a
 * queue name containing `:` ("Queue name cannot contain :"). Names are hyphen-
 * separated for that reason; `tests/unit/queues.test.ts` locks this in.
 */
export const QUEUE_NAMES = {
  /** P7 — §8.12 scheduled reminders (joining/leaving/probation/expiry/...). */
  reminders: 'harvik-reminders',
  /** P7 — §8.12 in-app + email notification delivery. */
  notifications: 'harvik-notifications',
  /** P4 — §8.7 PDF document generation. */
  pdfGeneration: 'harvik-pdf-generation',
  /** P7 — §8.11 large report exports. */
  reportExport: 'harvik-report-export',
  /** P5 — §8.5 nightly attendance materialisation (holiday/leave/absent). */
  attendanceNightly: 'harvik-attendance-nightly',
  /** P0 infrastructure heartbeat; also the home of periodic housekeeping. */
  maintenance: 'harvik-maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** §8.12 — default reminder schedule is daily at 08:00 server time. */
export const DAILY_08_00 = '0 8 * * *';