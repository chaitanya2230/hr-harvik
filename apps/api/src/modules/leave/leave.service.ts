import mongoose, { Types } from 'mongoose';
import { LeaveRequest } from './leave-request.model';
import type { LeaveRequestDoc } from './leave-request.schema';
import { LeaveBalance } from './leave-balance.model';
import { LeaveType } from './leave-type.model';
import { Employee } from '../employees/employee.model';
import { Attendance } from '../attendance/attendance.model';
import { Document } from '../documents/document.model';
import type { DocumentDoc } from '../documents/document.schema';
import * as documentService from '../documents/document.service';
import { calculateWorkingDays } from './leave-balance.service';
import { collectTeamIds, isValidScopeId } from '../employees/employee.scope';
import { recordAudit } from '../audit/audit.service';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { badRequest, forbidden, internalError, notFound, unprocessable } from '../../utils/errors';
import { todayInTimeZone } from '../../utils/dates';
import { trustedFilter } from '../../utils/mongo';
import type { AuthAccount } from '../auth/auth.service';
import type { ApplyLeaveInput, ReviewLeaveInput } from './leave.validation';
import { notifyLeaveEvent } from '../notifications/reminder.service';
import { logger } from '../../utils/logger';

export interface UploadLeaveDocumentInput {
  employeeId?: string;
  title?: string;
  fileBuffer: Buffer;
  originalName: string;
  mimeType: string;
}

/**
 * AGENTS.md §8.6 / §8.7 — leave supporting-document upload.
 *
 * Reuses the secure document architecture: MIME + magic-byte validation,
 * size limit, random server-side filename, no public static serving, and a
 * `Document` record (category "Other") whose id can be passed as
 * `documentId` when applying for a leave type with `requiresDocument`.
 *
 * Employees may upload only for themselves; HR may upload on behalf of an
 * employee (e.g. a scanned medical certificate handed to HR).
 */
export async function uploadLeaveDocument(
  input: UploadLeaveDocumentInput,
  actor: AuthAccount,
  ctx: { ip: string | null; requestId: string | null },
): Promise<DocumentDoc> {
  const isHr = actor.role === 'HR Admin' || actor.role === 'HR Manager';
  const targetEmployeeId = input.employeeId ?? actor.employeeId;
  if (!targetEmployeeId) {
    throw badRequest('Employee ID is required');
  }

  const isSelf = Boolean(actor.employeeId) && actor.employeeId === targetEmployeeId;
  if (!isSelf && !isHr) {
    throw forbidden('You can only upload a supporting document for yourself');
  }

  return documentService.uploadDocument(
    {
      employeeId: targetEmployeeId,
      category: 'Other',
      title: input.title?.trim() || `Leave supporting document — ${input.originalName}`,
      fileBuffer: input.fileBuffer,
      originalName: input.originalName,
      mimeType: input.mimeType,
      // The approver (Manager/HR) must be able to open the proof.
      confidential: false,
    },
    { account: actor, ip: ctx.ip, requestId: ctx.requestId },
  );
}

export async function applyLeave(
  input: ApplyLeaveInput,
  actor: AuthAccount,
): Promise<LeaveRequestDoc> {
  const targetEmployeeId = input.employeeId ?? actor.employeeId;
  if (!targetEmployeeId) {
    throw badRequest('Employee ID is required');
  }

  const isSelf = actor.employeeId && actor.employeeId === targetEmployeeId;
  const isHr = actor.role === 'HR Admin' || actor.role === 'HR Manager';

  if (!isSelf && !isHr) {
    throw forbidden('You can only apply for leave on behalf of yourself');
  }

  const employee = await Employee.findOne({ _id: targetEmployeeId, isDeleted: false });
  if (!employee) {
    throw notFound('Employee not found');
  }

  if (employee.status === 'Relieved') {
    throw unprocessable('Relieved employees cannot apply for leave');
  }

  // AGENTS.md §8.6 — exclude weekends and holidays from days
  const { workingDays, dates } = await calculateWorkingDays(
    input.fromDate,
    input.toDate,
    input.halfDay,
  );
  if (workingDays <= 0 || dates.length === 0) {
    throw badRequest('Selected date range contains no working days (all weekends or holidays)');
  }

  const leaveType = await LeaveType.findOne({ _id: input.leaveTypeId, isDeleted: false });
  if (!leaveType) {
    throw notFound('Leave type not found');
  }

  if (!leaveType.applicableEmploymentTypes.includes(employee.employmentType)) {
    throw unprocessable(`Leave type is not applicable for ${employee.employmentType}`);
  }

  // AGENTS.md §14 LEV — required sick/medical document enforced
  if (leaveType.requiresDocument && !input.documentId) {
    throw unprocessable('Medical/document proof is required for this leave type');
  }

  // The referenced proof must exist and belong to the employee applying —
  // otherwise anyone could attach another employee's document as "proof".
  if (input.documentId) {
    if (!Types.ObjectId.isValid(input.documentId)) {
      throw unprocessable('Supporting document not found');
    }
    const proof = await Document.findOne({
      _id: new Types.ObjectId(input.documentId),
      isDeleted: false,
    });
    if (!proof) {
      throw unprocessable('Supporting document not found');
    }
    if (String(proof.employeeId) !== String(targetEmployeeId)) {
      throw unprocessable('Supporting document belongs to a different employee');
    }
  }

  // The overlap check, balance claim and insert run inside one transaction
  // serialized per employee: the `leaveOpSeq` touch write-conflicts concurrent
  // applications for the same employee, the loser retries automatically and
  // then observes the winner in its overlap check. Without this, two
  // simultaneous overlapping applications could both pass the check and both
  // commit (snapshot isolation hides uncommitted inserts from each other).
  const leaveYear = parseInt(input.fromDate.slice(0, 4), 10);
  const session = await mongoose.startSession();
  let leaveRequest: LeaveRequestDoc;
  try {
    const created = await session.withTransaction(async () => {
      await Employee.updateOne(
        { _id: targetEmployeeId },
        { $inc: { leaveOpSeq: 1 } },
        { session },
      ).exec();

      // AGENTS.md §8.6, §14 LEV — overlapping leave rejected
      const overlapping = await LeaveRequest.findOne({
        employeeId: targetEmployeeId,
        status: trustedFilter({ $in: ['Pending', 'Approved'] }),
        fromDate: trustedFilter({ $lte: input.toDate }),
        toDate: trustedFilter({ $gte: input.fromDate }),
        isDeleted: false,
      })
        .session(session)
        .exec();
      if (overlapping) {
        throw unprocessable('Overlapping leave request exists for the selected dates');
      }

      // AGENTS.md §8.6, §14 LEV — balance checks and concurrent overdraft prevention
      if (leaveType.isPaid) {
        const balance = await LeaveBalance.findOne({
          employeeId: targetEmployeeId,
          leaveTypeId: leaveType._id,
          year: leaveYear,
          isDeleted: false,
        })
          .session(session)
          .exec();

        if (!balance) {
          throw unprocessable('No leave balance found for this leave type');
        }

        const available = balance.allocated + balance.carriedForward - balance.used - balance.pending;
        if (available < workingDays) {
          throw unprocessable('Insufficient leave balance');
        }

        // Optimistic concurrency update to lock pending balance safely against concurrent requests
        const updatedBalance = await LeaveBalance.updateOne(
          {
            _id: balance._id,
            isDeleted: false,
            pending: balance.pending,
          },
          { $inc: { pending: workingDays } },
          { session },
        ).exec();

        if (updatedBalance.matchedCount === 0) {
          throw unprocessable('Concurrent leave applications cannot overdraw balance');
        }
      }

      const doc = new LeaveRequest({
        employeeId: new Types.ObjectId(targetEmployeeId),
        leaveTypeId: leaveType._id,
        fromDate: input.fromDate,
        toDate: input.toDate,
        halfDay: input.halfDay,
        days: workingDays,
        reason: input.reason,
        status: 'Pending',
        documentId: input.documentId ? new Types.ObjectId(input.documentId) : null,
        createdBy: actor.userId ? new Types.ObjectId(actor.userId) : null,
      });
      await doc.save({ session });
      return doc;
    });
    if (!created) {
      throw internalError('Leave application could not be completed');
    }
    leaveRequest = created;
  } finally {
    await session.endSession();
  }

  await recordAudit({
    actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
    action: 'CREATE',
    entityType: 'LeaveRequest',
    entityId: leaveRequest._id,
    after: leaveRequest.toObject(),
  });

  await invalidateDashboardCache();

  // Awaited (not fire-and-forget): the in-app notification row must exist
  // when the response commits (§14 NOT-09). Only the SMTP send stays async
  // inside createNotification. Failures here must never fail the leave itself.
  try {
    await notifyLeaveEvent({
      leaveRequestId: leaveRequest._id,
      employeeId: leaveRequest.employeeId,
      eventType: 'applied',
      datesDescription: `${leaveRequest.fromDate} to ${leaveRequest.toDate}`,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to trigger leave notification');
  }

  return leaveRequest;
}

export async function reviewLeave(
  requestId: string,
  input: ReviewLeaveInput,
  actor: AuthAccount,
): Promise<LeaveRequestDoc> {
  const request = await LeaveRequest.findOne({ _id: requestId, isDeleted: false });
  if (!request) {
    throw notFound('Leave request not found');
  }

  if (request.status !== 'Pending') {
    throw badRequest(`Leave request is already ${request.status}`);
  }

  // AGENTS.md §14 LEV — employee cannot approve own leave
  if (actor.employeeId && actor.employeeId === String(request.employeeId)) {
    throw forbidden('Employee cannot approve own leave');
  }

  // Verify manager / HR authority
  const isHr = actor.role === 'HR Admin' || actor.role === 'HR Manager';
  if (!isHr) {
    if (actor.role !== 'Manager' || !actor.employeeId) {
      throw forbidden('Unauthorized to approve leave');
    }
    const teamIds = await collectTeamIds(actor.employeeId);
    if (!teamIds.has(String(request.employeeId))) {
      throw forbidden('Unauthorized manager cannot approve leave outside their hierarchy');
    }
  }

  const leaveType = await LeaveType.findById(request.leaveTypeId);
  const leaveYear = parseInt(request.fromDate.slice(0, 4), 10);

  // Atomic state claim: the status flip and the decision metadata commit as
  // one operation guarded on `Pending`, so two concurrent reviewers cannot
  // both approve the same request (which would double-deduct the balance and
  // double-write attendance). The loser observes the decided state below.
  const claimed = await LeaveRequest.findOneAndUpdate(
    { _id: request._id, status: 'Pending', isDeleted: false },
    {
      $set: {
        status: input.status,
        decisionNote: input.decisionNote ?? null,
        approverId: actor.userId ? new Types.ObjectId(actor.userId) : null,
        decidedAt: new Date(),
      },
    },
    { new: true },
  ).exec();

  if (!claimed) {
    const current = await LeaveRequest.findById(request._id).select('status').lean().exec();
    if (!current) {
      throw notFound('Leave request not found');
    }
    throw badRequest(`Leave request is already ${current.status}`);
  }

  if (input.status === 'Rejected') {
    // Restore pending balance if paid
    if (leaveType?.isPaid) {
      await LeaveBalance.updateOne(
        { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year: leaveYear },
        { $inc: { pending: -request.days } },
      );
    }
  } else if (input.status === 'Approved') {
    // Deduct pending, add to used atomically
    if (leaveType?.isPaid) {
      await LeaveBalance.updateOne(
        { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year: leaveYear },
        { $inc: { pending: -request.days, used: request.days } },
      );
    }

    // AGENTS.md §8.6 — approved leave updates attendance
    const { dates } = await calculateWorkingDays(request.fromDate, request.toDate, request.halfDay);
    for (const d of dates) {
      const existing = await Attendance.findOne({
        employeeId: request.employeeId,
        date: d,
        isDeleted: false,
      });

      if (existing) {
        existing.status = request.halfDay ? 'Half Day' : 'Leave';
        existing.source = 'LeaveSync';
        await existing.save();
      } else {
        await Attendance.create({
          employeeId: request.employeeId,
          date: d,
          status: request.halfDay ? 'Half Day' : 'Leave',
          source: 'LeaveSync',
        });
      }
    }
  }

  await recordAudit({
    actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
    action: 'STATUS_CHANGE',
    entityType: 'LeaveRequest',
    entityId: claimed._id,
    after: claimed.toObject(),
  });

  await invalidateDashboardCache();

  try {
    await notifyLeaveEvent({
      leaveRequestId: claimed._id,
      employeeId: claimed.employeeId,
      eventType: input.status === 'Approved' ? 'approved' : 'rejected',
      datesDescription: `${claimed.fromDate} to ${claimed.toDate}`,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to trigger leave decision notification');
  }

  return claimed;
}

export async function cancelLeave(
  requestId: string,
  actor: AuthAccount,
): Promise<LeaveRequestDoc> {
  const request = await LeaveRequest.findOne({ _id: requestId, isDeleted: false });
  if (!request) {
    throw notFound('Leave request not found');
  }

  const isSelf = actor.employeeId && actor.employeeId === String(request.employeeId);
  const isHr = actor.role === 'HR Admin' || actor.role === 'HR Manager';

  if (!isSelf && !isHr) {
    throw forbidden('You can only cancel your own leave requests');
  }

  if (request.status === 'Cancelled' || request.status === 'Rejected') {
    throw badRequest(`Cannot cancel leave request in status ${request.status}`);
  }

  const leaveType = await LeaveType.findById(request.leaveTypeId);
  const leaveYear = parseInt(request.fromDate.slice(0, 4), 10);
  const today = todayInTimeZone();

  // Atomic state claims (same rationale as reviewLeave): exactly one
  // concurrent cancellation wins; the loser observes the decided state.
  if (request.status === 'Pending') {
    const claimed = await LeaveRequest.findOneAndUpdate(
      { _id: request._id, status: 'Pending', isDeleted: false },
      { $set: { status: 'Cancelled' } },
      { new: true },
    ).exec();
    if (!claimed) {
      throw badRequest('Leave request is no longer pending and cannot be cancelled');
    }

    if (leaveType?.isPaid) {
      await LeaveBalance.updateOne(
        { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year: leaveYear },
        { $inc: { pending: -request.days } },
      );
    }

    await recordAudit({
      actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
      action: 'STATUS_CHANGE',
      entityType: 'LeaveRequest',
      entityId: claimed._id,
      after: claimed.toObject(),
    });

    await invalidateDashboardCache();
    return claimed;
  }

  if (request.status === 'Approved') {
    // AGENTS.md §14 LEV — past cancellation rejected; future restores balance
    if (request.fromDate <= today) {
      throw unprocessable('Cannot cancel past or ongoing approved leave');
    }

    const claimed = await LeaveRequest.findOneAndUpdate(
      { _id: request._id, status: 'Approved', isDeleted: false },
      { $set: { status: 'Cancelled' } },
      { new: true },
    ).exec();
    if (!claimed) {
      throw badRequest('Leave request is no longer approved and cannot be cancelled');
    }

    if (leaveType?.isPaid) {
      await LeaveBalance.updateOne(
        { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year: leaveYear },
        { $inc: { used: -request.days } },
      );
    }

    // Clean up synced attendance
    await Attendance.deleteMany({
      employeeId: request.employeeId,
      date: trustedFilter({ $gte: request.fromDate, $lte: request.toDate }),
      status: trustedFilter({ $in: ['Leave', 'Half Day'] }),
      source: 'LeaveSync',
    });

    await recordAudit({
      actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
      action: 'STATUS_CHANGE',
      entityType: 'LeaveRequest',
      entityId: claimed._id,
      after: claimed.toObject(),
    });

    await invalidateDashboardCache();
    return claimed;
  }

  // Unreachable: terminal states rejected above, but kept for exhaustiveness.
  throw badRequest(`Cannot cancel leave request in status ${request.status}`);
}

export async function listLeaveRequests(
  query: {
    employeeId?: string;
    status?: string;
    leaveTypeId?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  },
  actor: AuthAccount,
): Promise<{ data: LeaveRequestDoc[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));

  const filter: Record<string, unknown> = { isDeleted: false };
  if (query.status) filter.status = query.status;
  if (query.leaveTypeId) filter.leaveTypeId = new Types.ObjectId(query.leaveTypeId);
  if (query.fromDate) filter.toDate = trustedFilter({ $gte: query.fromDate });
  if (query.toDate) filter.fromDate = trustedFilter({ $lte: query.toDate });

  if (actor.role === 'Employee') {
    if (!isValidScopeId(actor.employeeId)) return { data: [], total: 0, page, limit };
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
    LeaveRequest.find(filter)
      .populate('employeeId', 'employeeCode firstName lastName designation departmentId')
      .populate('leaveTypeId', 'name code isPaid')
      .populate('approverId', 'email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    LeaveRequest.countDocuments(filter),
  ]);

  return { data, total, page, limit };
}

/**
 * AGENTS.md §8.6, §14 LEV — Team leave calendar.
 * Scoped by manager reporting hierarchy for Managers, self for Employees, all for HR.
 */
export async function getTeamCalendar(
  yearMonth: string,
  actor: AuthAccount,
): Promise<Array<{
  id: string;
  employee: { id: string; name: string; employeeCode: string };
  leaveType: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  status: string;
}>> {
  const filter: Record<string, unknown> = {
    status: 'Approved',
    isDeleted: false,
    $or: trustedFilter([
      { fromDate: trustedFilter({ $regex: `^${yearMonth}` }) },
      { toDate: trustedFilter({ $regex: `^${yearMonth}` }) },
    ]),
  };

  if (actor.role === 'Employee') {
    if (!isValidScopeId(actor.employeeId)) return [];
    filter.employeeId = new Types.ObjectId(actor.employeeId);
  } else if (actor.role === 'Manager') {
    if (!actor.employeeId) return [];
    const teamIds = await collectTeamIds(actor.employeeId);
    filter.employeeId = trustedFilter({ $in: Array.from(teamIds).map((id) => new Types.ObjectId(id)) });
  }

  const requests = await LeaveRequest.find(filter)
    .populate('employeeId', 'employeeCode firstName lastName')
    .populate('leaveTypeId', 'name')
    .sort({ fromDate: 1 });

  return requests.map((r) => {
    const emp = r.employeeId as unknown as { _id: Types.ObjectId; firstName: string; lastName: string; employeeCode: string };
    const lt = r.leaveTypeId as unknown as { name: string };
    return {
      id: String(r._id),
      employee: {
        id: String(emp._id),
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        employeeCode: emp.employeeCode,
      },
      leaveType: lt?.name ?? 'Leave',
      fromDate: r.fromDate,
      toDate: r.toDate,
      halfDay: r.halfDay,
      days: r.days,
      status: r.status,
    };
  });
}
