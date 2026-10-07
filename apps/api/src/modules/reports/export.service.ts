import ExcelJS from 'exceljs';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../jobs/queues';
import { getRedis } from '../../db/redis';
import { logger } from '../../utils/logger';

export interface ColumnDefinition {
  header: string;
  key: string;
  width?: number;
}

/**
 * RFC 4180 compliant CSV string generator with UTF-8 BOM.
 */
export function generateCsvString(
  columns: ColumnDefinition[],
  rows: Array<Record<string, unknown>>,
): string {
  const escapeCell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = columns.map((c) => escapeCell(c.header)).join(',');
  const rowLines = rows.map((row) =>
    columns.map((c) => escapeCell(row[c.key])).join(','),
  );

  // Prepend UTF-8 BOM for Microsoft Excel compatibility
  return '\uFEFF' + [headerLine, ...rowLines].join('\r\n');
}

/**
 * Generate an Excel XLSX buffer with formatting using ExcelJS.
 */
export async function generateXlsxBuffer(
  sheetTitle: string,
  columns: ColumnDefinition[],
  rows: Array<Record<string, unknown>>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Harvik Technologies HR';
  workbook.created = new Date();

  const sanitizedSheetTitle = sheetTitle.slice(0, 31).replace(/[*?:/\\[\]]/g, '_');
  const worksheet = workbook.addWorksheet(sanitizedSheetTitle);

  worksheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width || Math.max(col.header.length + 5, 15),
  }));

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FF1E293B' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' },
  };
  headerRow.height = 24;

  for (const row of rows) {
    const dataRow = worksheet.addRow(row);
    dataRow.height = 20;
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// Redis-backed store for async export job results.
//
// AGENTS.md §8.11 — large exports run on BullMQ, which means the *worker*
// process produces the result while the *API* process serves the poll and
// download endpoints. A process-local Map would leave every async export
// stuck at `pending` in production, so results live in Redis with a TTL
// (survives restarts of either process, evicts itself when abandoned).
const exportJobKey = (jobId: string): string => `report-export:${jobId}`;
const EXPORT_JOB_TTL_SECONDS = 3600;

export interface StoredExportJob {
  status: 'pending' | 'completed' | 'failed';
  format: 'csv' | 'xlsx';
  filename: string;
  ownerId: string;
  /** UTF-8 text for csv, base64 for xlsx. */
  data?: string;
  error?: string;
  createdAt: string;
}

interface SetExportJobInput {
  status: 'pending' | 'completed' | 'failed';
  format: 'csv' | 'xlsx';
  filename: string;
  ownerId: string;
  /** Buffer or string; stored base64-encoded when binary. */
  data?: Buffer | string;
  error?: string;
}

export async function getExportJobResult(jobId: string): Promise<StoredExportJob | null> {
  const raw = await getRedis().get(exportJobKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredExportJob;
  } catch {
    return null;
  }
}

export async function setExportJobResult(
  jobId: string,
  result: SetExportJobInput,
): Promise<void> {
  const stored: StoredExportJob = {
    status: result.status,
    format: result.format,
    filename: result.filename,
    ownerId: result.ownerId,
    error: result.error,
    createdAt: new Date().toISOString(),
  };
  if (result.data !== undefined) {
    stored.data = Buffer.isBuffer(result.data)
      ? result.data.toString('base64')
      : result.data;
  }
  await getRedis().set(exportJobKey(jobId), JSON.stringify(stored), 'EX', EXPORT_JOB_TTL_SECONDS);
}

/**
 * AGENTS.md §8.11 — "Large exports should use BullMQ." Exports beyond this
 * many rows are queued even without an explicit `async=true`, so a big
 * download can never block the API event loop.
 */
export const LARGE_EXPORT_ROW_THRESHOLD = 1000;

export function shouldQueueExport(rowCount: number): boolean {
  return rowCount > LARGE_EXPORT_ROW_THRESHOLD;
}

export async function queueExportJob(data: {
  reportType: string;
  format: 'csv' | 'xlsx';
  filename: string;
  ownerId: string;
  columns: ColumnDefinition[];
  rows: Array<Record<string, unknown>>;
}): Promise<string> {
  const jobId = `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await setExportJobResult(jobId, {
    status: 'pending',
    format: data.format,
    filename: data.filename,
    ownerId: data.ownerId,
  });

  const payload = { jobId, ...data };

  try {
    const redis = getRedis();
    if (redis && redis.status === 'ready') {
      const queue = new Queue(QUEUE_NAMES.reportExport, { connection: redis });
      await queue.add('export-report', payload, { jobId });
      await queue.close();
    } else {
      // Immediate asynchronous generation fallback if Redis queue is not active in current test run
      setTimeout(async () => {
        try {
          if (data.format === 'csv') {
            const csv = generateCsvString(data.columns, data.rows);
            await setExportJobResult(jobId, {
              status: 'completed',
              format: 'csv',
              filename: data.filename,
              ownerId: data.ownerId,
              data: csv,
            });
          } else {
            const buf = await generateXlsxBuffer(data.reportType, data.columns, data.rows);
            await setExportJobResult(jobId, {
              status: 'completed',
              format: 'xlsx',
              filename: data.filename,
              ownerId: data.ownerId,
              data: buf,
            });
          }
        } catch (err: unknown) {
          logger.error({ err, jobId }, 'Failed async report export generation');
          await setExportJobResult(jobId, {
            status: 'failed',
            format: data.format,
            filename: data.filename,
            ownerId: data.ownerId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }, 10);
    }
  } catch (error) {
    logger.error({ error }, 'Failed to queue report export to BullMQ');
    // Fallback immediate completion
    if (data.format === 'csv') {
      const csv = generateCsvString(data.columns, data.rows);
      await setExportJobResult(jobId, {
        status: 'completed',
        format: 'csv',
        filename: data.filename,
        ownerId: data.ownerId,
        data: csv,
      });
    } else {
      const buf = await generateXlsxBuffer(data.reportType, data.columns, data.rows);
      await setExportJobResult(jobId, {
        status: 'completed',
        format: 'xlsx',
        filename: data.filename,
        ownerId: data.ownerId,
        data: buf,
      });
    }
  }

  return jobId;
}
