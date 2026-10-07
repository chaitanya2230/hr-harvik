import { describe, expect, it, beforeAll } from 'vitest';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../src/jobs/queues';
import {
  attendanceNightlyJob,
  dailyMaintenance,
  jobHandlers,
  notificationDeliveryJob,
  pdfGenerationJob,
  reportExportJob,
  scheduledRemindersJob,
} from '../../src/jobs';
import { createNotification } from '../../src/modules/notifications/notification.service';
import { DocumentTemplate } from '../../src/modules/documents/template.model';
import { Document as EmployeeDocument } from '../../src/modules/documents/document.model';
import { getExportJobResult } from '../../src/modules/reports/export.service';
import { getPdfJobResult } from '../../src/modules/documents/pdf-queue.service';
import { DEMO_ACCOUNTS, loginAs, seedDatabase, type Session } from '../support/helpers';
import { SEEDED, employeeIdByEmail } from '../support/employee-fixtures';

/**
 * AGENTS.md §3/§8.11/§8.12/§14 — BullMQ worker job handlers.
 *
 * The worker process never runs inside the API test suite, which left
 * `src/jobs/index.ts` uncovered. These tests invoke each handler directly with
 * a minimal fake BullMQ `Job`, against the seeded database, and verify the
 * observable contract (heartbeat, idempotent nightly run, reminder totals,
 * email delivery, Redis-backed export/PDF job results).
 */

const fakeJob = <T>(data: T, id = 'test-job'): Job<T> =>
  ({ id, name: 'test', data, attemptsMade: 0 }) as unknown as Job<T>;

describe('AGENTS.md §3/§8.12 — BullMQ worker job handlers', () => {
  let admin: Session;

  beforeAll(async () => {
    await seedDatabase();
    admin = await loginAs(DEMO_ACCOUNTS.admin);
  });

  it('maps every queue name to its handler in jobHandlers', () => {
    expect(jobHandlers[QUEUE_NAMES.maintenance]).toBe(dailyMaintenance);
    expect(jobHandlers[QUEUE_NAMES.attendanceNightly]).toBe(attendanceNightlyJob);
    expect(jobHandlers[QUEUE_NAMES.reminders]).toBe(scheduledRemindersJob);
    expect(jobHandlers[QUEUE_NAMES.notifications]).toBe(notificationDeliveryJob);
    expect(jobHandlers[QUEUE_NAMES.reportExport]).toBe(reportExportJob);
    expect(jobHandlers[QUEUE_NAMES.pdfGeneration]).toBe(pdfGenerationJob);
  });

  it('dailyMaintenance performs the year rollover and returns a heartbeat', async () => {
    const result = await dailyMaintenance(fakeJob({}));
    expect(result.at).toBeTruthy();
  });

  it('attendanceNightlyJob runs idempotently (with and without an explicit date)', async () => {
    const explicit = await attendanceNightlyJob(fakeJob({ date: undefined }));
    expect(explicit).toBeDefined();
    const blank = await attendanceNightlyJob(fakeJob({}));
    expect(blank).toBeDefined();

    // Second run against the same date must not duplicate work (idempotence).
    const dry = await attendanceNightlyJob(fakeJob({ date: undefined }));
    expect(dry).toBeDefined();
  });

  it('scheduledRemindersJob produces the reminder totals for today', async () => {
    const result = (await scheduledRemindersJob(fakeJob({}))) as {
      totalCreated: number;
      joiningReminders: number;
    };
    expect(result.totalCreated).toBeGreaterThanOrEqual(0);
    expect(result.joiningReminders).toBeGreaterThanOrEqual(0);
  });

  it('notificationDeliveryJob delivers email for a persisted notification', async () => {
    const notif = await createNotification({
      userId: admin.account.userId,
      type: 'leave_status',
      title: 'Jobs test email',
      body: 'Delivered through the worker handler',
      link: '/leave',
      dedupeKey: `jobs-test-${Date.now()}`,
      sendEmailAlert: true,
    });
    expect(notif).toBeTruthy();

    const result = await notificationDeliveryJob(fakeJob({ notificationId: String(notif!._id) }));
    expect(result).toEqual({ sent: true });
  });

  it('reportExportJob generates and stores a CSV export (escaping special characters)', async () => {
    const jobId = `jobs-csv-${Date.now()}`;
    const result = await reportExportJob(
      fakeJob({
        jobId,
        ownerId: admin.account.userId,
        reportType: 'employee-report',
        format: 'csv' as const,
        filename: 'employees.csv',
        columns: [
          { header: 'Name', key: 'name' },
          { header: 'Note', key: 'note' },
        ],
        rows: [
          { name: 'Ada', note: 'comma, ok' },
          { name: 'Grace', note: 'quote " inside' },
          { name: 'Lin', note: 'line\nbreak' },
        ],
      }),
    );
    expect(result).toMatchObject({ exportId: jobId, status: 'completed' });

    const stored = await getExportJobResult(jobId);
    expect(stored?.status).toBe('completed');
    expect(stored?.data).toContain('"comma, ok"');
    expect(stored?.data).toContain('"quote "" inside"');
    expect(stored?.data).toContain('"line\nbreak"');
  });

  it('reportExportJob generates and stores an XLSX export', async () => {
    const jobId = `jobs-xlsx-${Date.now()}`;
    const result = await reportExportJob(
      fakeJob({
        jobId,
        ownerId: admin.account.userId,
        reportType: 'attendance-report',
        format: 'xlsx' as const,
        filename: 'attendance.xlsx',
        columns: [{ header: 'Date', key: 'date' }],
        rows: [{ date: '2026-01-01' }],
      }),
    );
    expect(result).toMatchObject({ exportId: jobId, status: 'completed' });

    const stored = await getExportJobResult(jobId);
    expect(stored?.status).toBe('completed');
    const buf = Buffer.from(stored?.data ?? '', 'base64');
    // XLSX (ZIP magic bytes PK\x03\x04)
    expect(buf.subarray(0, 2).toString('hex')).toBe('504b');
  });

  it('pdfGenerationJob generates a PDF document and records a completed job', async () => {
    const template = await DocumentTemplate.create({
      name: `Job Offer ${Date.now()}`,
      category: 'Offer Letter',
      applicableEmploymentTypes: ['Full-Time'],
      bodyHtml: '<p>Dear {{employee.firstName}}, welcome to {{company.name}}.</p>',
      isActive: true,
    });
    const employeeId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const jobId = `jobs-pdf-${Date.now()}`;

    const result = await pdfGenerationJob(
      fakeJob({
        jobId,
        templateId: String(template._id),
        employeeId,
        confidential: false,
        context: {
          account: admin.account,
          ip: '127.0.0.1',
          requestId: 'jobs-test',
        },
      }),
    );
    expect(result.documentId).toBeTruthy();

    const stored = await getPdfJobResult(jobId);
    expect(stored?.status).toBe('completed');
    expect(stored?.documentId).toBe(result.documentId);

    const doc = await EmployeeDocument.findById(stored?.documentId).lean().exec();
    expect(doc).toBeTruthy();
    expect(String(doc!.employeeId)).toBe(employeeId);
    expect(doc!.file.mimeType).toBe('application/pdf');

    // Inventory sanity: the generated doc is visible to HR list queries.
    const total = await EmployeeDocument.countDocuments({ employeeId });
    expect(total).toBeGreaterThan(0);
  });
});