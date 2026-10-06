import { Types } from 'mongoose';
import { Attendance } from './attendance.model';
import type { AttendanceDoc } from './attendance.schema';
import { AttendanceCorrection } from './correction.model';
import type { AttendanceCorrectionDoc } from './correction.schema';
import { Holiday } from './holiday.model';
import { Employee } from '../employees/employee.model';
import { LeaveRequest } from '../leave/leave-request.model';
import { collectTeamIds } from '../employees/employee.scope';
import { recordAudit } from '../audit/audit.service';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../utils/errors';
import { isWeekend, todayInTimeZone } from '../../utils/dates';
import { trustedFilter } from '../../utils/mongo';
import type { AuthAccount } from '../auth/auth.service';
import type {
  MarkAttendanceInput,
  RequestCorrectionInput,
  ReviewCorrectionInput,
} from './attendance.validation';

export async function markAttendance(
  input: MarkAttendanceInput,
  actor: AuthAccount,
): Promise<AttendanceDoc> {
  const targetEmployeeId = input.employeeId ?? actor.employeeId;
  if (!targetEmployeeId) {
    throw badRequest('Employee ID is required');
  }

  // Employee self-service check or HR check
  const isSelf = actor.employeeId && actor.employeeId === targetEmployeeId;
  const isHr = actor.role === 'HR Admin' || actor.role === 'HR Manager';

  if (!isSelf && !isHr) {
    throw forbidden('Only HR can record attendance for other employees');
  }

  const employee = await Employee.findOne({ _id: targetEmployeeId, isDeleted: false });
  if (!employee) {
    throw notFound('Employee not found');
  }

  const today = todayInTimeZone();
  if (input.date > today) {
    throw unprocessable('Future attendance forbidden');
  }

  // AGENTS.md §8.5 — Relieved employee cannot receive attendance after LWD
  if (employee.status === 'Relieved' && employee.lastWorkingDay && input.date > employee.lastWorkingDay) {
    throw unprocessable('Relieved employee cannot receive attendance after last working day');
  }

  // AGENTS.md §8.5 — WFH/Office only applies to Present/Half Day
  if (input.workMode && input.status !== 'Present' && input.status !== 'Half Day') {
    throw unprocessable('WFH/Office only applies to Present or Half Day');
  }

  const existing = await Attendance.findOne({
    employeeId: targetEmployeeId,
    date: input.date,
    isDeleted: false,
  });
  if (existing) {
    throw conflict(`Attendance record already exists for ${input.date}`);
  }

  const attendance = await Attendance.create({
    employeeId: new Types.ObjectId(targetEmployeeId),
    date: input.date,
    status: input.status,
    workMode: input.workMode ?? null,
    checkIn: input.checkIn ?? null,
    checkOut: input.checkOut ?? null,
    source: isSelf ? 'Self' : 'Manual',
    note: input.note ?? null,
    createdBy: actor.userId ? new Types.ObjectId(actor.userId) : null,
  });

  await recordAudit({
    actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
    action: 'CREATE',
    entityType: 'Attendance',
    entityId: attendance._id,
    after: attendance.toObject(),
  });

  await invalidateDashboardCache();
  return attendance;
}

export async function listAttendance(
  query: {
    employeeId?: string;
    date?: string;
    month?: string;
    status?: string;
    departmentId?: string;
    page?: number;
    limit?: number;
  },
  actor: AuthAccount,
): Promise<{ data: AttendanceDoc[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));

  const filter: Record<string, unknown> = { isDeleted: false };

  if (query.date) filter.date = query.date;
  if (query.month) filter.date = trustedFilter({ $regex: `^${query.month}` });
  if (query.status) filter.status = query.status;

  if (actor.role === 'Employee') {
    if (!actor.employeeId) return { data: [], total: 0, page, limit };
    filter.employeeId = new Types.ObjectId(actor.employeeId);
  } else if (actor.role === 'Manager') {
    if (!actor.employeeId) return { data: [], total: 0, page, limit };
    const teamIds = await collectTeamIds(actor.employeeId);
    if (query.employeeId) {
      if (!teamIds.has(query.employeeId)) {
        throw forbidden('Employee is not in your reporting hierarchy');
      }
      filter.employeeId = new Types.ObjectId(query.employeeId);
    } else {
      filter.employeeId = trustedFilter({ $in: Array.from(teamIds).map((id) => new Types.ObjectId(id)) });
    }
  } else if (query.employeeId) {
    filter.employeeId = new Types.ObjectId(query.employeeId);
  }

  const [data, total] = await Promise.all([
    Attendance.find(filter)
      .populate('employeeId', 'employeeCode firstName lastName designation departmentId')
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Attendance.countDocuments(filter),
  ]);

  return { data, total, page, limit };
}

export async function getMonthlyGrid(
  yearMonth: string,
  query: { departmentId?: string; employeeId?: string },
  actor: AuthAccount,
): Promise<{
  yearMonth: string;
  records: Array<{
    employee: { id: string; employeeCode: string; name: string };
    days: Record<string, { status: string; workMode: string | null }>;
    summary: { present: number; absent: number; halfDay: number; leave: number; holiday: number };
  }>;
}> {
  const employeeFilter: Record<string, unknown> = { isDeleted: false };
  if (actor.role === 'Employee') {
    if (!actor.employeeId) return { yearMonth, records: [] };
    employeeFilter._id = new Types.ObjectId(actor.employeeId);
  } else if (actor.role === 'Manager') {
    if (!actor.employeeId) return { yearMonth, records: [] };
    const teamIds = await collectTeamIds(actor.employeeId);
    employeeFilter._id = trustedFilter({ $in: Array.from(teamIds).map((id) => new Types.ObjectId(id)) });
  } else if (query.employeeId) {
    employeeFilter._id = new Types.ObjectId(query.employeeId);
  }

  if (query.departmentId) {
    employeeFilter.departmentId = new Types.ObjectId(query.departmentId);
  }

  const employees = await Employee.find(employeeFilter).select('employeeCode firstName lastName').lean();
  const empIds = employees.map((e) => e._id);

  const attendances = await Attendance.find({
    employeeId: trustedFilter({ $in: empIds }),
    date: trustedFilter({ $regex: `^${yearMonth}` }),
    isDeleted: false,
  }).lean();

  const attendanceMap = new Map<string, Map<string, { status: string; workMode: string | null }>>();
  for (const att of attendances) {
    const empKey = String(att.employeeId);
    if (!attendanceMap.has(empKey)) attendanceMap.set(empKey, new Map());
    attendanceMap.get(empKey)!.set(att.date, { status: att.status, workMode: att.workMode ?? null });
  }

  const records = employees.map((emp) => {
    const empKey = String(emp._id);
    const dayMap = attendanceMap.get(empKey) ?? new Map();
    const daysObj: Record<string, { status: string; workMode: string | null }> = {};
    const summary = { present: 0, absent: 0, halfDay: 0, leave: 0, holiday: 0 };

    dayMap.forEach((val, dateKey) => {
      daysObj[dateKey] = val;
      if (val.status === 'Present') summary.present += 1;
      else if (val.status === 'Absent') summary.absent += 1;
      else if (val.status === 'Half Day') summary.halfDay += 1;
      else if (val.status === 'Leave') summary.leave += 1;
      else if (val.status === 'Holiday') summary.holiday += 1;
    });

    return {
      employee: {
        id: empKey,
        employeeCode: emp.employeeCode,
        name: `${emp.firstName} ${emp.lastName}`.trim(),
      },
      days: daysObj,
      summary,
    };
  });

  return { yearMonth, records };
}

export async function requestAttendanceCorrection(
  input: RequestCorrectionInput,
  actor: AuthAccount,
): Promise<AttendanceCorrectionDoc> {
  const targetEmployeeId = input.employeeId ?? actor.employeeId;
  if (!targetEmployeeId) {
    throw badRequest('Employee ID is required');
  }

  const isSelf = actor.employeeId && actor.employeeId === targetEmployeeId;
  const isHr = actor.role === 'HR Admin' || actor.role === 'HR Manager';

  if (!isSelf && !isHr) {
    throw forbidden('You can only request corrections for yourself');
  }

  const today = todayInTimeZone();
  if (input.date > today) {
    throw unprocessable('Future attendance correction forbidden');
  }

  const employee = await Employee.findOne({ _id: targetEmployeeId, isDeleted: false });
  if (!employee) {
    throw notFound('Employee not found');
  }

  if (employee.status === 'Relieved' && employee.lastWorkingDay && input.date > employee.lastWorkingDay) {
    throw unprocessable('Cannot correct attendance after last working day');
  }

  if (input.requestedWorkMode && input.requestedStatus !== 'Present' && input.requestedStatus !== 'Half Day') {
    throw unprocessable('WFH/Office only applies to Present or Half Day');
  }

  const correction = await AttendanceCorrection.create({
    employeeId: new Types.ObjectId(targetEmployeeId),
    date: input.date,
    requestedStatus: input.requestedStatus,
    requestedWorkMode: input.requestedWorkMode ?? null,
    reason: input.reason,
    status: 'Pending',
    createdBy: actor.userId ? new Types.ObjectId(actor.userId) : null,
  });

  await recordAudit({
    actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
    action: 'CREATE',
    entityType: 'AttendanceCorrection',
    entityId: correction._id,
    after: correction.toObject(),
  });

  return correction;
}

export async function listAttendanceCorrections(
  query: { status?: string; employeeId?: string },
  actor: AuthAccount,
): Promise<AttendanceCorrectionDoc[]> {
  const filter: Record<string, unknown> = { isDeleted: false };
  if (query.status) filter.status = query.status;

  if (actor.role === 'Employee') {
    if (!actor.employeeId) return [];
    filter.employeeId = new Types.ObjectId(actor.employeeId);
  } else if (actor.role === 'Manager') {
    if (!actor.employeeId) return [];
    const teamIds = await collectTeamIds(actor.employeeId);
    filter.employeeId = trustedFilter({ $in: Array.from(teamIds).map((id) => new Types.ObjectId(id)) });
  } else if (query.employeeId) {
    filter.employeeId = new Types.ObjectId(query.employeeId);
  }

  return AttendanceCorrection.find(filter)
    .populate('employeeId', 'employeeCode firstName lastName designation')
    .sort({ createdAt: -1 });
}

export async function reviewAttendanceCorrection(
  correctionId: string,
  input: ReviewCorrectionInput,
  actor: AuthAccount,
): Promise<AttendanceCorrectionDoc> {
  const correction = await AttendanceCorrection.findOne({ _id: correctionId, isDeleted: false });
  if (!correction) {
    throw notFound('Attendance correction request not found');
  }

  if (correction.status !== 'Pending') {
    throw badRequest(`Correction is already ${correction.status}`);
  }

  // AGENTS.md §14 ATT — employee cannot approve own correction
  if (actor.employeeId && actor.employeeId === String(correction.employeeId)) {
    throw forbidden('Employee cannot approve own correction');
  }

  // Verify manager / HR authority
  const isHr = actor.role === 'HR Admin' || actor.role === 'HR Manager';
  if (!isHr) {
    if (actor.role !== 'Manager' || !actor.employeeId) {
      throw forbidden('Unauthorized to approve attendance correction');
    }
    const teamIds = await collectTeamIds(actor.employeeId);
    if (!teamIds.has(String(correction.employeeId))) {
      throw forbidden('Unauthorized manager cannot approve correction outside their hierarchy');
    }
  }

  correction.status = input.status;
  correction.reviewNote = input.reviewNote ?? null;
  correction.reviewedBy = actor.userId ? new Types.ObjectId(actor.userId) : null;
  correction.decidedAt = new Date();
  await correction.save();

  if (input.status === 'Approved') {
    // Upsert or update attendance record
    const existing = await Attendance.findOne({
      employeeId: correction.employeeId,
      date: correction.date,
      isDeleted: false,
    });

    if (existing) {
      existing.status = correction.requestedStatus;
      existing.workMode = correction.requestedWorkMode;
      existing.source = 'Correction';
      existing.note = correction.reason;
      await existing.save();
    } else {
      await Attendance.create({
        employeeId: correction.employeeId,
        date: correction.date,
        status: correction.requestedStatus,
        workMode: correction.requestedWorkMode,
        source: 'Correction',
        note: correction.reason,
        createdBy: actor.userId ? new Types.ObjectId(actor.userId) : null,
      });
    }
    await invalidateDashboardCache();
  }

  await recordAudit({
    actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
    action: 'STATUS_CHANGE',
    entityType: 'AttendanceCorrection',
    entityId: correction._id,
    after: correction.toObject(),
  });

  return correction;
}

/**
 * AGENTS.md §8.5 — Nightly attendance job.
 * Must be idempotent!
 * - creates Holiday for holidays
 * - approved leave creates Leave
 * - weekends do not create Absent
 * - working day without record creates Absent
 * - Relieved employee cannot receive attendance after LWD
 */
export async function runNightlyAttendanceJob(
  targetDate?: string,
): Promise<{ date: string; created: number; holidays: number; leaves: number; absents: number; skipped: number }> {
  const date = targetDate ?? todayInTimeZone();

  const isHoliday = await Holiday.findOne({ date, isDeleted: false });
  const weekend = isWeekend(date);

  const activeEmployees = await Employee.find({
    isDeleted: false,
    status: trustedFilter({ $nin: ['Inactive'] }),
  }).select('_id status lastWorkingDay');

  // Query approved leaves covering this date
  const approvedLeaves = await LeaveRequest.find({
    fromDate: trustedFilter({ $lte: date }),
    toDate: trustedFilter({ $gte: date }),
    status: 'Approved',
    isDeleted: false,
  }).select('employeeId halfDay');

  const leaveMap = new Map<string, boolean>();
  for (const l of approvedLeaves) {
    leaveMap.set(String(l.employeeId), l.halfDay);
  }

  let created = 0;
  let holidays = 0;
  let leaves = 0;
  let absents = 0;
  let skipped = 0;

  for (const emp of activeEmployees) {
    // If relieved and date > LWD, cannot receive attendance
    if (emp.status === 'Relieved' && emp.lastWorkingDay && date > emp.lastWorkingDay) {
      skipped += 1;
      continue;
    }

    const existing = await Attendance.findOne({
      employeeId: emp._id,
      date,
      isDeleted: false,
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const empIdStr = String(emp._id);

    if (leaveMap.has(empIdStr)) {
      const isHalf = leaveMap.get(empIdStr);
      await Attendance.create({
        employeeId: emp._id,
        date,
        status: isHalf ? 'Half Day' : 'Leave',
        source: 'LeaveSync',
      });
      created += 1;
      leaves += 1;
    } else if (isHoliday) {
      await Attendance.create({
        employeeId: emp._id,
        date,
        status: 'Holiday',
        note: isHoliday.name,
        source: 'NightlyJob',
      });
      created += 1;
      holidays += 1;
    } else if (weekend) {
      // Weekends do not create Absent!
      skipped += 1;
    } else {
      // Working day without record creates Absent
      await Attendance.create({
        employeeId: emp._id,
        date,
        status: 'Absent',
        source: 'NightlyJob',
      });
      created += 1;
      absents += 1;
    }
  }

  await invalidateDashboardCache();
  return { date, created, holidays, leaves, absents, skipped };
}
