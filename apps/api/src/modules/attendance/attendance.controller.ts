import type { Request, Response } from 'express';
import * as attendanceService from './attendance.service';
import * as holidayService from './holiday.service';
import {
  holidaySchemaInput,
  markAttendanceSchema,
  requestCorrectionSchema,
  reviewCorrectionSchema,
} from './attendance.validation';
import { badRequest } from '../../utils/errors';

export async function markAttendanceHandler(req: Request, res: Response): Promise<void> {
  const input = markAttendanceSchema.parse(req.body);
  const result = await attendanceService.markAttendance(input, req.user!);
  res.status(201).json({ data: result });
}

export async function listAttendanceHandler(req: Request, res: Response): Promise<void> {
  const rawMonth = req.query.month as string | undefined;
  // The service interpolates `month` into an anchored $regex: enforce
  // YYYY-MM here so crafted input cannot become a hostile pattern.
  if (rawMonth !== undefined && !/^\d{4}-\d{2}$/.test(rawMonth)) {
    throw badRequest('month query parameter must be in YYYY-MM format');
  }
  const query = {
    employeeId: req.query.employeeId as string | undefined,
    date: req.query.date as string | undefined,
    month: rawMonth,
    status: req.query.status as string | undefined,
    departmentId: req.query.departmentId as string | undefined,
    page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
  };
  const result = await attendanceService.listAttendance(query, req.user!);
  res.json({
    data: result.data,
    meta: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  });
}

export async function getMonthlyGridHandler(req: Request, res: Response): Promise<void> {
  const month = req.query.month as string;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw badRequest('month query parameter required in YYYY-MM format');
  }
  const result = await attendanceService.getMonthlyGrid(
    month,
    {
      departmentId: req.query.departmentId as string | undefined,
      employeeId: req.query.employeeId as string | undefined,
    },
    req.user!,
  );
  res.json({ data: result });
}

export async function requestCorrectionHandler(req: Request, res: Response): Promise<void> {
  const input = requestCorrectionSchema.parse(req.body);
  const result = await attendanceService.requestAttendanceCorrection(input, req.user!);
  res.status(201).json({ data: result });
}

export async function listCorrectionsHandler(req: Request, res: Response): Promise<void> {
  const query = {
    status: req.query.status as string | undefined,
    employeeId: req.query.employeeId as string | undefined,
  };
  const result = await attendanceService.listAttendanceCorrections(query, req.user!);
  res.json({ data: result });
}

export async function reviewCorrectionHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const input = reviewCorrectionSchema.parse(req.body);
  const result = await attendanceService.reviewAttendanceCorrection(id, input, req.user!);
  res.json({ data: result });
}

export async function listHolidaysHandler(req: Request, res: Response): Promise<void> {
  const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
  const result = await holidayService.listHolidays(year);
  res.json({ data: result });
}

export async function createHolidayHandler(req: Request, res: Response): Promise<void> {
  const input = holidaySchemaInput.parse(req.body);
  const result = await holidayService.createHoliday(input, req.user!);
  res.status(201).json({ data: result });
}

export async function deleteHolidayHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const result = await holidayService.deleteHoliday(id, req.user!);
  res.json({ data: result });
}

export async function runNightlyJobHandler(req: Request, res: Response): Promise<void> {
  const date = req.body?.date as string | undefined;
  const result = await attendanceService.runNightlyAttendanceJob(date);
  res.json({ data: result });
}
