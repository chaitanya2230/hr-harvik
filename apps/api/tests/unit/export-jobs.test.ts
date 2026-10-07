import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getExportJobResult,
  setExportJobResult,
  shouldQueueExport,
  LARGE_EXPORT_ROW_THRESHOLD,
  queueExportJob,
} from '../../src/modules/reports/export.service';

// Mock the queue module so we can force failures to exercise fallback branches.
vi.mock('bullmq', async () => {
  const actual = await vi.importActual<typeof import('bullmq')>('bullmq');
  return {
    ...actual,
    Queue: vi.fn().mockImplementation(() => ({
      add: vi.fn().mockRejectedValue(new Error('queue-fail')),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('report export job store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips a csv result through the shared store', async () => {
    const jobId = `test-csv-${Date.now()}`;
    await setExportJobResult(jobId, {
      status: 'completed',
      format: 'csv',
      filename: 'employees-report.csv',
      ownerId: 'owner-1',
      data: 'a,b\n1,2\n',
    });

    const stored = await getExportJobResult(jobId);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe('completed');
    expect(stored?.ownerId).toBe('owner-1');
    expect(stored?.data).toBe('a,b\n1,2\n');
  });

  it('round-trips binary xlsx data losslessly via base64', async () => {
    const jobId = `test-xlsx-${Date.now()}`;
    const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef]);

    await setExportJobResult(jobId, {
      status: 'completed',
      format: 'xlsx',
      filename: 'report.xlsx',
      ownerId: 'owner-2',
      data: binary,
    });

    const stored = await getExportJobResult(jobId);
    expect(stored).toBeDefined();
    expect(Buffer.from(stored?.data ?? '', 'base64').equals(binary)).toBe(true);
  });

  it('returns null for unknown job ids', async () => {
    expect(await getExportJobResult('export_does_not_exist_123')).toBeNull();
  });

  it('queues only exports beyond the large-export threshold', () => {
    expect(LARGE_EXPORT_ROW_THRESHOLD).toBe(1000);
    expect(shouldQueueExport(0)).toBe(false);
    expect(shouldQueueExport(1000)).toBe(false);
    expect(shouldQueueExport(1001)).toBe(true);
  });

  it('queues a csv export and completes via fallback when queue.add fails', async () => {
    const jobId = await queueExportJob({
      reportType: 'employees',
      format: 'csv',
      filename: 'employees.csv',
      ownerId: 'u1',
      columns: [{ header: 'Name', key: 'name' }],
      rows: [{ name: 'A' }],
    });
    expect(jobId).toMatch(/^export_/);

    // Fallback should complete after setTimeout(10) completes.
    await new Promise((r) => setTimeout(r, 250));
    const stored = await getExportJobResult(jobId);
    expect(stored?.status).toBe('completed');
    expect(stored?.data).toContain('A');
  });

  it('queues an xlsx export and completes via fallback when queue.add fails', async () => {
    const jobId = await queueExportJob({
      reportType: 'attendance-report',
      format: 'xlsx',
      filename: 'att.xlsx',
      ownerId: 'u2',
      columns: [{ header: 'D', key: 'd' }],
      rows: [{ d: '2026-01-01' }],
    });
    expect(jobId).toMatch(/^export_/);

    await new Promise((r) => setTimeout(r, 250));
    const stored = await getExportJobResult(jobId);
    expect(stored?.status).toBe('completed');
    const buf = Buffer.from(stored?.data ?? '', 'base64');
    expect(buf.subarray(0, 2).toString('hex')).toBe('504b');
  });
});
