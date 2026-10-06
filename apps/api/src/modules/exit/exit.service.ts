import mongoose, { Types } from 'mongoose';
import type { FilterQuery } from 'mongoose';
import { Exit } from './exit.model';
import type { ExitDoc, ExitChecklistItem, ExitStage } from './exit.schema';
import { Employee } from '../employees/employee.model';
import type { EmployeeDoc } from '../employees/employee.schema';
import { User } from '../users/user.model';
import { AssetAssignment } from '../assets/asset.model';
import { LicenseAssignment } from '../licenses/license.model';
import { AccessItem } from '../access/access.model';
import { revokeLicenseAssignment } from '../licenses/license.service';
import { collectTeamIds } from '../employees/employee.scope';
import { onEmployeeStatusChanged, type EmployeeContext } from '../employees/employee.service';
import { onAssetReturned, onAssetAssigned } from '../assets/asset.service';
import { onLicenseRevoked } from '../licenses/license.service';
import { onAccessRevoked } from '../access/access.service';
import { recordAudit } from '../audit/audit.service';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { addDaysIso, todayInTimeZone } from '../../utils/dates';
import { buildPagination, listMeta } from '../../utils/http';
import { conflict, forbidden, notFound, unprocessable } from '../../utils/errors';
import { trustedFilter } from '../../utils/mongo';
import type {
  CreateExitBody,
  ListExitsQuery,
  ProvideClearanceBody,
  RelieveEmployeeBody,
  UpdateChecklistItemBody,
  UpdateSettlementBody,
} from './exit.validation';

const toId = (val: string): Types.ObjectId => new Types.ObjectId(val);

export interface ExitView {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  resignationDate: string;
  noticePeriodDays: number;
  lastWorkingDay: string;
  reason: string;
  reasonNote?: string | null;
  clearances: ExitDoc['clearances'];
  checklist: ExitChecklistItem[];
  finalSettlementStatus: ExitDoc['finalSettlementStatus'];
  experienceLetterDocId?: string | null;
  relievingLetterDocId?: string | null;
  stage: ExitStage;
  completedAt?: string | null;
  forceRelieved?: boolean;
  forceReason?: string | null;
  blockers: string[];
  createdAt: string;
  updatedAt: string;
}

export function computeBlockers(exit: {
  checklist: ExitChecklistItem[];
  clearances: ExitDoc['clearances'];
  finalSettlementStatus: ExitDoc['finalSettlementStatus'];
}): string[] {
  const blockers: string[] = [];

  for (const item of exit.checklist) {
    if (item.status === 'Pending') {
      blockers.push(`Checklist pending: ${item.title}`);
    }
  }

  if (exit.clearances.manager.status !== 'Approved') {
    blockers.push('Pending manager clearance');
  }
  if (exit.clearances.hr.status !== 'Approved') {
    blockers.push('Pending HR clearance');
  }
  if (exit.clearances.finance.status !== 'Approved') {
    blockers.push('Pending finance clearance');
  }

  if (exit.finalSettlementStatus !== 'Completed') {
    blockers.push('Pending final settlement');
  }

  return blockers;
}

export function determineStage(exit: ExitDoc): ExitStage {
  if (exit.completedAt || exit.stage === 'Relieved') return 'Relieved';
  if (exit.stage === 'Cancelled') return 'Cancelled';

  // Clearances
  if (
    exit.clearances.manager.status !== 'Approved' ||
    exit.clearances.hr.status !== 'Approved' ||
    exit.clearances.finance.status !== 'Approved'
  ) {
    return 'Clearance';
  }

  // Assets
  const unreturnedAssets = exit.checklist.filter(
    (c) => c.category === 'asset' && c.status === 'Pending',
  );
  if (unreturnedAssets.length > 0) return 'Asset Return';

  // Licenses / Access
  const unrevokedAccess = exit.checklist.filter(
    (c) => (c.category === 'license' || c.category === 'access') && c.status === 'Pending',
  );
  if (unrevokedAccess.length > 0) return 'Software Revocation';

  // Settlement
  if (exit.finalSettlementStatus !== 'Completed') return 'Final Settlement';

  // Documents
  const pendingDocs = exit.checklist.filter(
    (c) => c.category === 'document' && c.status === 'Pending',
  );
  if (pendingDocs.length > 0) return 'Documents';

  return 'Notice Period';
}

function toExitView(
  exit: {
    _id: Types.ObjectId;
    employeeId?: unknown;
    resignationDate: string;
    noticePeriodDays: number;
    lastWorkingDay: string;
    reason: string;
    reasonNote?: string | null;
    clearances: ExitDoc['clearances'];
    checklist: ExitChecklistItem[];
    finalSettlementStatus: ExitDoc['finalSettlementStatus'];
    experienceLetterDocId?: Types.ObjectId | null;
    relievingLetterDocId?: Types.ObjectId | null;
    stage: ExitStage;
    completedAt?: Date | null;
    forceRelieved?: boolean;
    forceReason?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  employee: {
    _id?: Types.ObjectId;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation?: string | null;
    departmentId?: Types.ObjectId | null;
  },
  departmentName?: string,
): ExitView {
  const empId = employee._id
    ? employee._id.toString()
    : (exit.employeeId as Types.ObjectId).toString();

  return {
    id: exit._id.toString(),
    employeeId: empId,
    employeeCode: employee.employeeCode,
    employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
    designation: employee.designation ?? null,
    departmentId: employee.departmentId ? employee.departmentId.toString() : null,
    departmentName: departmentName ?? null,
    resignationDate: exit.resignationDate,
    noticePeriodDays: exit.noticePeriodDays,
    lastWorkingDay: exit.lastWorkingDay,
    reason: exit.reason,
    reasonNote: exit.reasonNote ?? null,
    clearances: exit.clearances,
    checklist: exit.checklist,
    finalSettlementStatus: exit.finalSettlementStatus,
    experienceLetterDocId: exit.experienceLetterDocId ? exit.experienceLetterDocId.toString() : null,
    relievingLetterDocId: exit.relievingLetterDocId ? exit.relievingLetterDocId.toString() : null,
    stage: exit.stage,
    completedAt: exit.completedAt ? exit.completedAt.toISOString() : null,
    forceRelieved: exit.forceRelieved ?? false,
    forceReason: exit.forceReason ?? null,
    blockers: computeBlockers(exit),
    createdAt: exit.createdAt.toISOString(),
    updatedAt: exit.updatedAt.toISOString(),
  };
}

/**
 * Creates initial exit checklist from current employee holdings and standard tasks.
 */
async function buildInitialChecklist(employeeId: Types.ObjectId): Promise<ExitChecklistItem[]> {
  const items: ExitChecklistItem[] = [];

  // 1. Assets
  const activeAssets = await AssetAssignment.find({
    employeeId,
    actualReturnDate: null,
    isDeleted: false,
  })
    .populate<{ assetId: { name: string; assetCode: string; serialNumber: string } }>('assetId')
    .exec();

  for (const asgn of activeAssets) {
    const asset = asgn.assetId as unknown as { name?: string; assetCode?: string; serialNumber?: string };
    const label = asset?.name ? `${asset.name} (${asset.assetCode ?? asgn._id.toString()})` : asgn._id.toString();
    items.push({
      id: `asset-${asgn._id.toString()}`,
      category: 'asset',
      title: `Return asset: ${label}`,
      status: 'Pending',
      referenceType: 'Asset',
      referenceId: asgn._id.toString(),
      details: asset?.serialNumber ? `Serial: ${asset.serialNumber}` : undefined,
    });
  }

  // 2. Licenses
  const activeLicenses = await LicenseAssignment.find({
    employeeId,
    status: 'Assigned',
    isDeleted: false,
  })
    .populate<{ licenseId: { softwareName: string; licenseCode: string } }>('licenseId')
    .exec();

  for (const asgn of activeLicenses) {
    const lic = asgn.licenseId as unknown as { softwareName?: string; licenseCode?: string };
    const label = lic?.softwareName ?? asgn._id.toString();
    items.push({
      id: `license-${asgn._id.toString()}`,
      category: 'license',
      title: `Revoke license: ${label}`,
      status: 'Pending',
      referenceType: 'License',
      referenceId: asgn._id.toString(),
      details: asgn.accountIdentifier ? `Account: ${asgn.accountIdentifier}` : undefined,
    });
  }

  // 3. Access Items
  const activeAccess = await AccessItem.find({
    employeeId,
    status: 'Active',
    isDeleted: false,
  }).exec();

  for (const acc of activeAccess) {
    items.push({
      id: `access-${acc._id.toString()}`,
      category: 'access',
      title: `Revoke access: ${acc.system}`,
      status: 'Pending',
      referenceType: 'AccessItem',
      referenceId: acc._id.toString(),
      details: acc.identifier ? `Identifier: ${acc.identifier}` : undefined,
    });
  }

  // 4. Clearances
  items.push({
    id: 'clr-manager',
    category: 'clearance',
    title: 'Manager clearance',
    status: 'Pending',
  });
  items.push({
    id: 'clr-hr',
    category: 'clearance',
    title: 'HR clearance',
    status: 'Pending',
  });
  items.push({
    id: 'clr-finance',
    category: 'clearance',
    title: 'Finance clearance',
    status: 'Pending',
  });

  // 5. Final Settlement
  items.push({
    id: 'set-final',
    category: 'settlement',
    title: 'Final settlement',
    status: 'Pending',
  });

  // 6. Documents
  items.push({
    id: 'doc-experience',
    category: 'document',
    title: 'Experience certificate',
    status: 'Pending',
  });
  items.push({
    id: 'doc-relieving',
    category: 'document',
    title: 'Relieving letter',
    status: 'Pending',
  });

  return items;
}

// ---------------------------------------------------------------------------
// Core Exit Service Functions
// ---------------------------------------------------------------------------

/**
 * Initiates an exit record for an employee.
 * Triggered automatically on On Notice / Resigned or explicitly by HR.
 */
export async function initiateExit(
  employeeIdInput: string,
  body: CreateExitBody,
  ctx: EmployeeContext,
): Promise<ExitView> {
  const employee = await Employee.findById(toId(employeeIdInput)).exec();
  if (!employee) throw notFound('Employee');

  if (employee.status === 'Relieved') {
    throw unprocessable('Cannot initiate exit for an already Relieved employee');
  }

  // Check if an active open exit already exists
  const existingExit = await Exit.findOne({
    employeeId: employee._id,
    stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
    isDeleted: false,
  }).exec();

  if (existingExit) {
    throw conflict('An active exit process is already open for this employee');
  }

  const today = todayInTimeZone();
  const resignationDate = body.resignationDate ?? today;
  const noticePeriodDays = body.noticePeriodDays ?? 30;
  const lastWorkingDay = body.lastWorkingDay ?? addDaysIso(resignationDate, noticePeriodDays);

  // Update employee status if needed
  if (employee.status !== 'On Notice' && employee.status !== 'Resigned') {
    employee.status = 'On Notice';
    employee.lastWorkingDay = lastWorkingDay;
    employee.statusHistory.push({
      status: 'On Notice',
      changedAt: new Date(),
      changedBy: toId(ctx.account.userId),
      note: `Exit initiated: ${body.reason}`,
    } as never);
    await employee.save();
  } else if (!employee.lastWorkingDay) {
    employee.lastWorkingDay = lastWorkingDay;
    await employee.save();
  }

  const checklist = await buildInitialChecklist(employee._id);

  const exit = new Exit({
    employeeId: employee._id,
    resignationDate,
    noticePeriodDays,
    lastWorkingDay,
    reason: body.reason,
    reasonNote: body.reasonNote ?? null,
    clearances: {
      manager: { status: 'Pending' },
      hr: { status: 'Pending' },
      finance: { status: 'Pending' },
    },
    checklist,
    finalSettlementStatus: 'Pending',
    stage: 'Notice Period',
    createdBy: toId(ctx.account.userId),
  });

  exit.stage = determineStage(exit);
  await exit.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'exit.initiated',
    entityType: 'Exit',
    entityId: exit._id,
    after: {
      employeeId: employee._id.toString(),
      resignationDate,
      lastWorkingDay,
      reason: body.reason,
    },
  });

  await invalidateDashboardCache();

  return toExitView(exit, employee);
}

/**
 * Get exit details by employeeId or exitId.
 */
export async function getExitForEmployee(
  idOrEmployeeId: string,
  ctx: EmployeeContext,
): Promise<ExitView> {
  const isObjectId = Types.ObjectId.isValid(idOrEmployeeId);
  if (!isObjectId) throw notFound('Exit');

  const objId = toId(idOrEmployeeId);

  // Find either by exit _id or by employeeId
  const exit = await Exit.findOne({
    $or: trustedFilter([{ _id: objId }, { employeeId: objId }]),
    stage: trustedFilter({ $ne: 'Cancelled' }),
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .exec();

  if (!exit) throw notFound('Exit');

  const employee = await Employee.findById(exit.employeeId).populate('departmentId').exec();
  if (!employee) throw notFound('Employee');

  // RBAC scope check
  if (ctx.account.role === 'Employee') {
    if (ctx.account.employeeId !== employee._id.toString()) {
      throw forbidden('Employees may only view their own exit offboarding details');
    }
  } else if (ctx.account.role === 'Manager') {
    const teamIds = await collectTeamIds(ctx.account.employeeId ?? '');
    if (!teamIds.has(employee._id.toString())) {
      throw forbidden('Managers may only view exit details for direct or indirect reports');
    }
  }

  const deptName = (employee.departmentId as unknown as { name?: string })?.name;
  return toExitView(exit, employee, deptName);
}

/**
 * List exits with scoping and filtering.
 */
export async function listExits(
  query: ListExitsQuery,
  ctx: EmployeeContext,
): Promise<{ items: ExitView[]; meta: { page: number; limit: number; total: number } }> {
  const pagination = buildPagination({ page: query.page, limit: query.limit });

  const filter: FilterQuery<ExitDoc> = { isDeleted: false };
  if (query.stage) filter.stage = query.stage;

  if (ctx.account.role === 'Employee') {
    filter.employeeId = toId(ctx.account.employeeId ?? '');
  } else if (ctx.account.role === 'Manager') {
    const teamIds = await collectTeamIds(ctx.account.employeeId ?? '');
    filter.employeeId = trustedFilter({ $in: Array.from(teamIds).map(toId) });
  }

  const total = await Exit.countDocuments(filter).exec();
  const rows = await Exit.find(filter)
    .sort({ createdAt: -1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .populate<{ employeeId: EmployeeDoc }>('employeeId')
    .exec();

  const items = rows
    .filter((r) => Boolean(r.employeeId))
    .map((r) => {
      const emp = r.employeeId as unknown as EmployeeDoc;
      return toExitView(r, emp);
    });

  return {
    items,
    meta: listMeta(pagination, total),
  };
}

/**
 * Provide department clearance.
 */
export async function provideClearance(
  employeeIdInput: string,
  body: ProvideClearanceBody,
  ctx: EmployeeContext,
): Promise<ExitView> {
  const exit = await Exit.findOne({
    employeeId: toId(employeeIdInput),
    stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
    isDeleted: false,
  }).exec();

  if (!exit) throw notFound('Exit');

  const employee = await Employee.findById(exit.employeeId).exec();
  if (!employee) throw notFound('Employee');

  // Enforce Clearance RBAC per AGENTS.md §6 and §14 items 10 & 11:
  // - Manager can only complete manager clearance (for direct/indirect reports).
  // - HR clearance cannot be completed by Manager!
  if (body.department === 'manager') {
    if (ctx.account.role === 'Manager') {
      const teamIds = await collectTeamIds(ctx.account.employeeId ?? '');
      if (!teamIds.has(employee._id.toString())) {
        throw forbidden('Manager may only provide clearance for reports in their team');
      }
    } else if (ctx.account.role !== 'HR Admin' && ctx.account.role !== 'HR Manager') {
      throw forbidden('Only managers and HR may provide manager clearance');
    }
  } else if (body.department === 'hr' || body.department === 'finance') {
    // HR and Finance clearance require HR Admin or HR Manager
    if (ctx.account.role !== 'HR Admin' && ctx.account.role !== 'HR Manager') {
      throw forbidden(`Only HR roles may provide ${body.department} clearance`);
    }
  }

  exit.clearances[body.department] = {
    status: body.status,
    comments: body.comments ?? null,
    reviewedBy: toId(ctx.account.userId),
    reviewedAt: new Date(),
  };

  // Sync matching clearance item on checklist
  const clrKey = `clr-${body.department}`;
  const clrItem = exit.checklist.find((c) => c.id === clrKey);
  if (clrItem) {
    clrItem.status = body.status === 'Approved' ? 'Completed' : 'Pending';
    clrItem.completedAt = body.status === 'Approved' ? new Date() : null;
    clrItem.completedBy = toId(ctx.account.userId);
    clrItem.notes = body.comments ?? null;
  }

  exit.stage = determineStage(exit);
  await exit.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: `exit.clearance_${body.department}`,
    entityType: 'Exit',
    entityId: exit._id,
    after: { department: body.department, status: body.status, comments: body.comments },
  });

  await invalidateDashboardCache();

  return toExitView(exit, employee);
}

/**
 * Update a checklist item directly (or trigger linked module actions).
 */
export async function updateChecklistItem(
  employeeIdInput: string,
  itemId: string,
  body: UpdateChecklistItemBody,
  ctx: EmployeeContext,
): Promise<ExitView> {
  const exit = await Exit.findOne({
    employeeId: toId(employeeIdInput),
    stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
    isDeleted: false,
  }).exec();

  if (!exit) throw notFound('Exit');

  const employee = await Employee.findById(exit.employeeId).exec();
  if (!employee) throw notFound('Employee');

  const item = exit.checklist.find((c) => c.id === itemId);
  if (!item) throw notFound('ChecklistItem');

  // AGENTS.md §14 test 8:
  // "Exit checklist license action must revoke the actual license assignment"
  if (
    item.category === 'license' &&
    item.referenceType === 'License' &&
    item.referenceId &&
    body.status === 'Completed'
  ) {
    try {
      await revokeLicenseAssignment(
        item.referenceId,
        { revocationNote: body.notes ?? 'Revoked via exit offboarding checklist' },
        ctx,
      );
    } catch {
      // If assignment was already revoked or missing, proceed to mark checklist item
    }
  }

  item.status = body.status;
  item.completedAt = body.status === 'Completed' ? new Date() : null;
  item.completedBy = toId(ctx.account.userId);
  if (body.notes !== undefined) item.notes = body.notes;

  exit.stage = determineStage(exit);
  await exit.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'exit.checklist_updated',
    entityType: 'Exit',
    entityId: exit._id,
    after: { itemId, status: body.status, notes: body.notes },
  });

  await invalidateDashboardCache();

  return toExitView(exit, employee);
}

/**
 * Update final settlement status.
 */
export async function updateFinalSettlement(
  employeeIdInput: string,
  body: UpdateSettlementBody,
  ctx: EmployeeContext,
): Promise<ExitView> {
  const exit = await Exit.findOne({
    employeeId: toId(employeeIdInput),
    stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
    isDeleted: false,
  }).exec();

  if (!exit) throw notFound('Exit');

  const employee = await Employee.findById(exit.employeeId).exec();
  if (!employee) throw notFound('Employee');

  exit.finalSettlementStatus = body.status;

  const setItem = exit.checklist.find((c) => c.id === 'set-final');
  if (setItem) {
    setItem.status = body.status === 'Completed' ? 'Completed' : 'Pending';
    setItem.completedAt = body.status === 'Completed' ? new Date() : null;
    setItem.completedBy = toId(ctx.account.userId);
    if (body.notes) setItem.notes = body.notes;
  }

  exit.stage = determineStage(exit);
  await exit.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'exit.settlement_updated',
    entityType: 'Exit',
    entityId: exit._id,
    after: { status: body.status, notes: body.notes },
  });

  await invalidateDashboardCache();

  return toExitView(exit, employee);
}

/**
 * Relieve employee with blockers guard and transactional execution.
 * AGENTS.md §8.10, §14 items 12, 13, 14, 15, 16, 17, 18, 19, 24.
 */
export async function relieveEmployee(
  employeeIdInput: string,
  body: RelieveEmployeeBody,
  ctx: EmployeeContext,
): Promise<ExitView> {
  const exit = await Exit.findOne({
    employeeId: toId(employeeIdInput),
    stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
    isDeleted: false,
  }).exec();

  if (!exit) throw notFound('Exit');

  const employee = await Employee.findById(exit.employeeId).exec();
  if (!employee) throw notFound('Employee');

  const blockers = computeBlockers(exit);

  if (blockers.length > 0) {
    if (!body.force) {
      throw unprocessable(
        `Cannot relieve employee with ${blockers.length} pending blocker(s). Complete all checklist items or use force relieve if authorized.`,
        { blockers },
      );
    }

    // Force-relieve validation: HR Admin only (§14 test 13 & 14)
    if (ctx.account.role !== 'HR Admin') {
      throw forbidden('Only an HR Admin may force relieve an employee with pending exit blockers');
    }

    if (!body.forceReason || body.forceReason.trim().length === 0) {
      throw unprocessable('A mandatory forceReason must be provided when force-relieving an employee');
    }
  }

  const isForced = Boolean(body.force && blockers.length > 0);
  const lwd = exit.lastWorkingDay || todayInTimeZone();

  // Multi-document transaction (§3)
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // 1. Employee status update
      employee.status = 'Relieved';
      employee.lastWorkingDay = lwd;
      employee.statusHistory.push({
        status: 'Relieved',
        changedAt: new Date(),
        changedBy: toId(ctx.account.userId),
        note: isForced
          ? `Force-relieved by HR Admin: ${body.forceReason}`
          : 'Offboarding completed. Relieved.',
      } as never);

      // Close employment history
      const currentHist = employee.employmentHistory[employee.employmentHistory.length - 1];
      if (currentHist && !currentHist.to) {
        currentHist.to = new Date(lwd);
      }

      await employee.save({ session });

      // 2. Disable user login (§8.10, §14 item 16)
      await User.updateMany({ employeeId: employee._id }, { $set: { isActive: false } }, { session });

      // 3. Mark exit complete
      exit.stage = 'Relieved';
      exit.completedAt = new Date();
      if (isForced) {
        exit.forceRelieved = true;
        exit.forceReason = body.forceReason?.trim() ?? null;
        exit.forceRelievedBy = toId(ctx.account.userId);
      }
      await exit.save({ session });
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: isForced ? 'exit.force_relieved' : 'exit.relieved',
    entityType: 'Exit',
    entityId: exit._id,
    after: {
      employeeId: employee._id.toString(),
      status: 'Relieved',
      forceRelieved: isForced,
      forceReason: body.forceReason ?? null,
      completedAt: exit.completedAt,
    },
  });

  await emitEmployeeRelieved({
    employeeId: employee._id.toString(),
    lastWorkingDay: lwd,
    relievedAt: exit.completedAt?.toISOString() ?? new Date().toISOString(),
    actorId: ctx.account.userId,
  });

  await invalidateDashboardCache();

  return toExitView(exit, employee);
}

/**
 * Withdrawal: On Notice → Active cancels the open exit and preserves history.
 * AGENTS.md §8.10, §14 test 20.
 */
export async function withdrawExit(
  employeeIdInput: string,
  ctx: EmployeeContext,
): Promise<{ success: boolean; message: string }> {
  const employee = await Employee.findById(toId(employeeIdInput)).exec();
  if (!employee) throw notFound('Employee');

  const exit = await Exit.findOne({
    employeeId: employee._id,
    stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
    isDeleted: false,
  }).exec();

  if (!exit) throw notFound('Active Exit');

  // Cancel exit record while preserving checklist and audit history
  exit.stage = 'Cancelled';
  await exit.save();

  // Reset employee status if currently On Notice or Resigned
  if (employee.status === 'On Notice' || employee.status === 'Resigned') {
    employee.status = 'Active';
    employee.lastWorkingDay = null;
    employee.statusHistory.push({
      status: 'Active',
      changedAt: new Date(),
      changedBy: toId(ctx.account.userId),
      note: 'Resignation withdrawn; restored to Active',
    } as never);
    await employee.save();
  }

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'exit.withdrawn',
    entityType: 'Exit',
    entityId: exit._id,
    after: { employeeId: employee._id.toString(), stage: 'Cancelled', employeeStatus: 'Active' },
  });

  await invalidateDashboardCache();

  return {
    success: true,
    message: 'Exit process cancelled and employee restored to Active.',
  };
}

// ---------------------------------------------------------------------------
// In-Process Event Seams for Post-Relieve Teardown
// ---------------------------------------------------------------------------

export interface EmployeeRelievedEvent {
  employeeId: string;
  lastWorkingDay: string;
  relievedAt: string;
  actorId: string;
}

type EmployeeRelievedListener = (event: EmployeeRelievedEvent) => Promise<void> | void;
const employeeRelievedListeners: EmployeeRelievedListener[] = [];

export function onEmployeeRelieved(listener: EmployeeRelievedListener): () => void {
  employeeRelievedListeners.push(listener);
  return () => {
    const index = employeeRelievedListeners.indexOf(listener);
    if (index >= 0) employeeRelievedListeners.splice(index, 1);
  };
}

async function emitEmployeeRelieved(event: EmployeeRelievedEvent): Promise<void> {
  for (const listener of employeeRelievedListeners) {
    try {
      await listener(event);
    } catch {
      // Non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Event Listeners Wiring (P1/P2 -> P3 Automatic Synchronization)
// ---------------------------------------------------------------------------

/**
 * Automatically creates an Exit record when an employee transitions
 * to 'On Notice' or 'Resigned' (§8.10). Cancels exit if withdrawn to 'Active'.
 */
onEmployeeStatusChanged(async (event) => {
  try {
    if (event.to === 'On Notice' || event.to === 'Resigned') {
      const existing = await Exit.findOne({
        employeeId: toId(event.employeeId),
        stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
        isDeleted: false,
      }).exec();

      if (!existing) {
        const emp = await Employee.findById(toId(event.employeeId)).exec();
        if (emp && emp.status !== 'Relieved') {
          const today = todayInTimeZone();
          const lwd = event.lastWorkingDay || addDaysIso(today, 30);
          const checklist = await buildInitialChecklist(emp._id);

          const exit = new Exit({
            employeeId: emp._id,
            resignationDate: today,
            noticePeriodDays: 30,
            lastWorkingDay: lwd,
            reason: `Status transitioned to ${event.to}`,
            clearances: {
              manager: { status: 'Pending' },
              hr: { status: 'Pending' },
              finance: { status: 'Pending' },
            },
            checklist,
            finalSettlementStatus: 'Pending',
            stage: 'Notice Period',
            createdBy: toId(event.actorId),
          });
          exit.stage = determineStage(exit);
          await exit.save();
        }
      }
    } else if (event.to === 'Active' && event.from === 'On Notice') {
      // Withdrawal side effect
      const activeExit = await Exit.findOne({
        employeeId: toId(event.employeeId),
        stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
        isDeleted: false,
      }).exec();

      if (activeExit) {
        activeExit.stage = 'Cancelled';
        await activeExit.save();
      }
    }
  } catch {
    // Non-fatal background listener
  }
});

/**
 * When an asset is returned, automatically mark the corresponding
 * exit checklist item Completed (§8.10, §14 test 6).
 */
onAssetReturned(async (event) => {
  try {
    const exit = await Exit.findOne({
      employeeId: toId(event.employeeId),
      stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
      isDeleted: false,
    }).exec();

    if (!exit) return;

    let updated = false;
    for (const item of exit.checklist) {
      if (
        item.category === 'asset' &&
        item.referenceType === 'Asset' &&
        (item.referenceId === event.assignmentId || item.referenceId === event.assetId) &&
        item.status === 'Pending'
      ) {
        item.status = 'Completed';
        item.completedAt = new Date();
        updated = true;
      }
    }

    if (updated) {
      exit.stage = determineStage(exit);
      await exit.save();
      await invalidateDashboardCache();
    }
  } catch {
    // Non-fatal
  }
});

/**
 * When an asset is newly assigned to an employee on notice,
 * append a checklist item to the active exit (§14 test 9).
 */
onAssetAssigned(async (event) => {
  try {
    const exit = await Exit.findOne({
      employeeId: toId(event.employeeId),
      stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
      isDeleted: false,
    }).exec();

    if (!exit) return;

    // Check if already in checklist
    const exists = exit.checklist.some((c) => c.referenceId === event.assignmentId);
    if (!exists) {
      exit.checklist.push({
        id: `asset-${event.assignmentId}`,
        category: 'asset',
        title: `Return asset: ${event.assetName} (${event.assetCode})`,
        status: 'Pending',
        referenceType: 'Asset',
        referenceId: event.assignmentId,
      });
      exit.stage = determineStage(exit);
      await exit.save();
      await invalidateDashboardCache();
    }
  } catch {
    // Non-fatal
  }
});

/**
 * When a license is revoked, automatically mark the corresponding
 * exit checklist item Completed (§8.10, §14 test 7).
 */
onLicenseRevoked(async (event) => {
  try {
    const exit = await Exit.findOne({
      employeeId: toId(event.employeeId),
      stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
      isDeleted: false,
    }).exec();

    if (!exit) return;

    let updated = false;
    for (const item of exit.checklist) {
      if (
        item.category === 'license' &&
        item.referenceType === 'License' &&
        item.referenceId === event.assignmentId &&
        item.status === 'Pending'
      ) {
        item.status = 'Completed';
        item.completedAt = new Date();
        updated = true;
      }
    }

    if (updated) {
      exit.stage = determineStage(exit);
      await exit.save();
      await invalidateDashboardCache();
    }
  } catch {
    // Non-fatal
  }
});

/**
 * When an access item is revoked, automatically mark the corresponding
 * exit checklist item Completed.
 */
onAccessRevoked(async (event) => {
  try {
    const exit = await Exit.findOne({
      employeeId: toId(event.employeeId),
      stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
      isDeleted: false,
    }).exec();

    if (!exit) return;

    let updated = false;
    for (const item of exit.checklist) {
      if (
        item.category === 'access' &&
        item.referenceType === 'AccessItem' &&
        item.referenceId === event.accessId &&
        item.status === 'Pending'
      ) {
        item.status = 'Completed';
        item.completedAt = new Date();
        updated = true;
      }
    }

    if (updated) {
      exit.stage = determineStage(exit);
      await exit.save();
      await invalidateDashboardCache();
    }
  } catch {
    // Non-fatal
  }
});
