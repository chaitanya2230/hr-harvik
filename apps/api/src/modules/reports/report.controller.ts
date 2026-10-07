import type { Request, Response, NextFunction } from 'express';
import { generateReportData } from './report.service';
import {
  generateCsvString,
  generateXlsxBuffer,
  queueExportJob,
  getExportJobResult,
  shouldQueueExport,
} from './export.service';
import {
  reportTypeParamSchema,
  reportQuerySchema,
  exportQuerySchema,
} from './report.validation';
import { unauthorized, notFound, forbidden, badRequest } from '../../utils/errors';
import { todayInTimeZone } from '../../utils/dates';

export async function getReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const account = req.user;
    if (!account) throw unauthorized('Authentication required');

    const { type } = reportTypeParamSchema.parse(req.params);
    const query = reportQuerySchema.parse(req.query);

    const result = await generateReportData(type, account, query);

    // Apply pagination if specified in query
    let rows = result.rows;
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 0;

    if (limit > 0) {
      const skip = (page - 1) * limit;
      rows = rows.slice(skip, skip + limit);
    }

    res.json({
      data: rows,
      meta: {
        title: result.title,
        reportType: result.reportType,
        columns: result.columns,
        total: result.total,
        page: limit > 0 ? page : 1,
        limit: limit > 0 ? limit : result.total,
        totalPages: limit > 0 ? Math.ceil(result.total / limit) || 1 : 1,
        ...(result.meta || {}),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function exportReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const account = req.user;
    if (!account) throw unauthorized('Authentication required');

    const { type } = reportTypeParamSchema.parse(req.params);
    const query = exportQuerySchema.parse(req.query);

    const result = await generateReportData(type, account, query);
    const today = todayInTimeZone();
    const filename = `${type}-report-${today}.${query.format}`;

    // Async BullMQ export requested explicitly, or rows exceed the large-export
    // threshold (AGENTS.md §8.11) — either way the event loop never blocks.
    if (query.async || shouldQueueExport(result.rows.length)) {
      const jobId = await queueExportJob({
        reportType: type,
        format: query.format,
        filename,
        ownerId: account.userId,
        columns: result.columns,
        rows: result.rows,
      });

      res.status(202).json({
        data: {
          jobId,
          status: 'queued',
          filename,
          format: query.format,
        },
      });
      return;
    }

    // Direct synchronous export
    if (query.format === 'csv') {
      const csv = generateCsvString(result.columns, result.rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
      return;
    }

    // XLSX export
    const buffer = await generateXlsxBuffer(result.title, result.columns, result.rows);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

export async function getExportJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const account = req.user;
    if (!account) throw unauthorized('Authentication required');

    const { jobId } = req.params;
    if (!jobId) throw badRequest('Export job id is required');
    const job = await getExportJobResult(jobId);

    if (!job) {
      throw notFound('Export job not found');
    }

    // Export results belong to the requester (HR Admin may inspect any job).
    if (job.ownerId !== account.userId && account.role !== 'HR Admin') {
      throw forbidden('You do not have access to this export job');
    }

    if (req.query.download === 'true' && job.status === 'completed' && job.data) {
      if (job.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
        res.send(job.data);
        return;
      }
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
      res.send(Buffer.from(job.data, 'base64'));
      return;
    }

    res.json({
      data: {
        jobId,
        status: job.status,
        format: job.format,
        filename: job.filename,
        error: job.error,
        createdAt: job.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
}
