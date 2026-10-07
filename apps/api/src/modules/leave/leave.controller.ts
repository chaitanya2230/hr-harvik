import type { Request, Response } from 'express';
import * as leaveService from './leave.service';
import * as leaveTypeService from './leave-type.service';
import * as balanceService from './leave-balance.service';
import {
  applyLeaveSchema,
  createLeaveTypeSchema,
  reviewLeaveSchema,
  updateLeaveTypeSchema,
  uploadLeaveDocumentSchema,
} from './leave.validation';
import { badRequest } from '../../utils/errors';

/**
 * POST /api/v1/leave/documents — multipart supporting-document upload for a
 * leave application (AGENTS.md §8.6, §8.7). Stores through the secure
 * document pipeline and returns the `documentId` to pass when applying.
 */
export async function uploadLeaveDocumentHandler(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw badRequest('File is required for upload');
  }

  const body = uploadLeaveDocumentSchema.parse(req.body);
  const doc = await leaveService.uploadLeaveDocument(
    {
      employeeId: body.employeeId,
      title: body.title,
      fileBuffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    },
    req.user!,
    {
      ip: req.ip ?? null,
      requestId: (req.headers['x-request-id'] as string) || null,
    },
  );

  res.status(201).json({
    data: {
      documentId: String(doc._id),
      title: doc.title,
      employeeId: String(doc.employeeId),
      originalName: doc.file.originalName,
      mimeType: doc.file.mimeType,
      size: doc.file.size,
    },
  });
}

export async function listLeaveTypesHandler(_req: Request, res: Response): Promise<void> {
  const result = await leaveTypeService.listLeaveTypes();
  res.json({ data: result });
}

export async function createLeaveTypeHandler(req: Request, res: Response): Promise<void> {
  const input = createLeaveTypeSchema.parse(req.body);
  const result = await leaveTypeService.createLeaveType(input, req.user!);
  res.status(201).json({ data: result });
}

export async function updateLeaveTypeHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const input = updateLeaveTypeSchema.parse(req.body);
  const result = await leaveTypeService.updateLeaveType(id, input, req.user!);
  res.json({ data: result });
}

export async function listBalancesHandler(req: Request, res: Response): Promise<void> {
  const query = {
    employeeId: req.query.employeeId as string | undefined,
    year: req.query.year ? parseInt(req.query.year as string, 10) : undefined,
  };
  const result = await balanceService.listBalances(query, req.user!);
  res.json({ data: result });
}

export async function applyLeaveHandler(req: Request, res: Response): Promise<void> {
  const input = applyLeaveSchema.parse(req.body);
  const result = await leaveService.applyLeave(input, req.user!);
  res.status(201).json({ data: result });
}

export async function reviewLeaveHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const input = reviewLeaveSchema.parse(req.body);
  const result = await leaveService.reviewLeave(id, input, req.user!);
  res.json({ data: result });
}

export async function cancelLeaveHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const result = await leaveService.cancelLeave(id, req.user!);
  res.json({ data: result });
}

export async function listLeaveRequestsHandler(req: Request, res: Response): Promise<void> {
  const query = {
    employeeId: req.query.employeeId as string | undefined,
    status: req.query.status as string | undefined,
    leaveTypeId: req.query.leaveTypeId as string | undefined,
    fromDate: req.query.fromDate as string | undefined,
    toDate: req.query.toDate as string | undefined,
    page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
  };
  const result = await leaveService.listLeaveRequests(query, req.user!);
  res.json({
    data: result.data,
    meta: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  });
}

export async function getTeamCalendarHandler(req: Request, res: Response): Promise<void> {
  const month = req.query.month as string;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw badRequest('month query parameter required in YYYY-MM format');
  }
  const result = await leaveService.getTeamCalendar(month, req.user!);
  res.json({ data: result });
}
