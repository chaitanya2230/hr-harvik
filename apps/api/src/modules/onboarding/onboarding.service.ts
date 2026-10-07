import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { Onboarding } from './onboarding.model';
import type { OnboardingChecklistItemDoc, OnboardingDoc } from './onboarding.schema';
import { Employee } from '../employees/employee.model';
import type { EmployeeDoc } from '../employees/employee.schema';
import { User } from '../users/user.model';
import { Document } from '../documents/document.model';
import { AssetAssignment } from '../assets/asset.model';
import { onAssetAssigned } from '../assets/asset.service';
import { LicenseAssignment } from '../licenses/license.model';
import { onLicenseAssigned } from '../licenses/license.service';
import { AccessItem } from '../access/access.model';
import { recordAudit } from '../audit/audit.service';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { collectTeamIds } from '../employees/employee.scope';
import { trustedFilter } from '../../utils/mongo';
import { forbidden, notFound, unprocessable } from '../../utils/errors';
import { buildPagination, listMeta } from '../../utils/http';
import {
  ONBOARDING_ITEM_DEFINITIONS,
  type OnboardingItemKey,
  type OnboardingStatus,
} from '../../config/constants';
import type { AuthAccount } from '../auth/auth.service';
import type {
  ListOnboardingsQuery,
  ReopenOnboardingBody,
  UpdateChecklistItemBody,
} from './onboarding.validation';

export interface OnboardingContext {
  account: AuthAccount;
  ip?: string;
  userAgent?: string;
}

export interface OnboardingItemView {
  key: OnboardingItemKey;
  title: string;
  category: string;
  status: string;
  isRequired: boolean;
  completedAt?: string | null;
  completedBy?: string | null;
  completedSource?: string | null;
  notes?: string | null;
  naReason?: string | null;
  smartLink: string;
}

export interface OnboardingView {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  employmentType: string;
  dateOfJoining: string;
  status: OnboardingStatus;
  progressPercent: number;
  completedItemsCount: number;
  totalItemsCount: number;
  startedAt?: string | null;
  completedAt?: string | null;
  reopenedAt?: string | null;
  reopenReason?: string | null;
  items: OnboardingItemView[];
  createdAt: string;
  updatedAt: string;
}

const toId = (val: string): Types.ObjectId => new Types.ObjectId(val);

function buildSmartLink(key: OnboardingItemKey, employeeId: string): string {
  switch (key) {
    case 'personalInfo':
    case 'bankInfo':
    case 'taxInfo':
    case 'departmentAssignment':
    case 'managerAssignment':
    case 'companyEmailAccount':
      return `/employees/${employeeId}`;
    case 'identityDocs':
      return `/documents?employeeId=${employeeId}&category=Identity`;
    case 'educationalDocs':
      return `/documents?employeeId=${employeeId}&category=Education`;
    case 'offerLetter':
      return `/documents?employeeId=${employeeId}&category=Offer+Letter`;
    case 'agreementNda':
      return `/documents?employeeId=${employeeId}&category=Agreement`;
    case 'hardwareAssignment':
      return `/assets?employeeId=${employeeId}`;
    case 'softwareLicenseAssignment':
      return `/licenses?employeeId=${employeeId}`;
    case 'orientation':
    case 'policyAcknowledgement':
    default:
      return `/onboarding/${employeeId}`;
  }
}

export function computeOverallStatus(items: OnboardingChecklistItemDoc[]): {
  status: OnboardingStatus;
  completedCount: number;
  totalCount: number;
  progressPercent: number;
} {
  const totalCount = items.length;
  let completedCount = 0;
  let allRequiredDone = true;

  for (const item of items) {
    const isDone = item.status === 'Completed' || item.status === 'NA';
    if (isDone) {
      completedCount += 1;
    } else if (item.isRequired) {
      allRequiredDone = false;
    }
  }

  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  let status: OnboardingStatus = 'Not Started';
  if (completedCount === 0) {
    status = 'Not Started';
  } else if (allRequiredDone && completedCount === totalCount) {
    status = 'Completed';
  } else {
    status = 'In Progress';
  }

  return { status, completedCount, totalCount, progressPercent };
}

function toOnboardingView(doc: OnboardingDoc, employee: Partial<EmployeeDoc>): OnboardingView {
  const empId = doc.employeeId.toString();
  const { status, completedCount, totalCount, progressPercent } = computeOverallStatus(doc.items);

  const dept = employee.departmentId as unknown as { _id?: Types.ObjectId; name?: string };
  const deptName = typeof dept === 'object' && dept !== null && 'name' in dept ? dept.name : undefined;
  const deptId =
    typeof dept === 'object' && dept !== null && '_id' in dept && dept._id
      ? dept._id.toString()
      : employee.departmentId?.toString();

  const employeeName = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim();

  return {
    id: doc._id.toString(),
    employeeId: empId,
    employeeCode: employee.employeeCode ?? '',
    employeeName,
    designation: employee.designation ?? null,
    departmentId: deptId ?? null,
    departmentName: deptName ?? null,
    employmentType: employee.employmentType ?? 'Full-Time',
    dateOfJoining: employee.dateOfJoining ?? '',
    status: doc.status || status,
    progressPercent,
    completedItemsCount: completedCount,
    totalItemsCount: totalCount,
    startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    reopenedAt: doc.reopenedAt ? doc.reopenedAt.toISOString() : null,
    reopenReason: doc.reopenReason ?? null,
    items: doc.items.map((item) => ({
      key: item.key,
      title: item.title,
      category: item.category,
      status: item.status,
      isRequired: item.isRequired,
      completedAt: item.completedAt ? item.completedAt.toISOString() : null,
      completedBy: item.completedBy ? item.completedBy.toString() : null,
      completedSource: item.completedSource ?? null,
      notes: item.notes ?? null,
      naReason: item.naReason ?? null,
      smartLink: buildSmartLink(item.key, empId),
    })),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export interface EmployeeForOnboarding {
  _id: Types.ObjectId;
  employeeCode: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  dob?: string | null;
  address?: EmployeeDoc['address'];
  emergencyContact?: EmployeeDoc['emergencyContact'];
  departmentId?: Types.ObjectId | null;
  reportingManagerId?: Types.ObjectId | null;
  bankDetails?: EmployeeDoc['bankDetails'];
}

export async function createOnboardingForEmployee(
  employee: EmployeeForOnboarding,
  session?: ClientSession,
): Promise<OnboardingDoc> {
  const existing = await Onboarding.findOne({ employeeId: employee._id })
    .session(session ?? null)
    .exec();
  if (existing) return existing;

  const initialItems: OnboardingChecklistItemDoc[] = ONBOARDING_ITEM_DEFINITIONS.map((def) => ({
    key: def.key,
    title: def.title,
    category: def.category,
    status: 'Pending',
    isRequired: def.isRequired,
    completedAt: null,
    completedBy: null,
    completedSource: null,
    notes: null,
    naReason: null,
  }));

  // Automatic initial evaluation based on employee fields
  const hasPersonalInfo = Boolean(
    employee.phone &&
      (employee.address?.city || employee.address?.line1) &&
      employee.emergencyContact?.phone,
  );
  if (hasPersonalInfo) {
    const item = initialItems.find((i) => i.key === 'personalInfo');
    if (item) {
      item.status = 'Completed';
      item.completedAt = new Date();
      item.completedSource = 'Auto';
    }
  }

  if (employee.departmentId) {
    const item = initialItems.find((i) => i.key === 'departmentAssignment');
    if (item) {
      item.status = 'Completed';
      item.completedAt = new Date();
      item.completedSource = 'Auto';
    }
  }

  if (employee.reportingManagerId) {
    const item = initialItems.find((i) => i.key === 'managerAssignment');
    if (item) {
      item.status = 'Completed';
      item.completedAt = new Date();
      item.completedSource = 'Auto';
    }
  }

  if (employee.bankDetails?.accountHolder || employee.bankDetails?.accountNumberEnc) {
    const item = initialItems.find((i) => i.key === 'bankInfo');
    if (item) {
      item.status = 'Completed';
      item.completedAt = new Date();
      item.completedSource = 'Auto';
    }
  }

  const { status } = computeOverallStatus(initialItems);

  const createdDocs = await Onboarding.create(
    [
      {
        employeeId: employee._id,
        status,
        startedAt: status === 'In Progress' ? new Date() : null,
        completedAt: status === 'Completed' ? new Date() : null,
        items: initialItems,
        createdBy: null,
        isDeleted: false,
      },
    ],
    { session },
  );

  const created = createdDocs[0];
  if (!created) throw unprocessable('Failed to create onboarding document');
  return created;
}

export async function syncOnboardingForEmployee(employeeId: Types.ObjectId): Promise<void> {
  const onboarding = await Onboarding.findOne({ employeeId, isDeleted: false }).exec();
  if (!onboarding) return;

  const employee = await Employee.findById(employeeId).lean().exec();
  if (!employee) return;

  let changed = false;

  const markComplete = (key: OnboardingItemKey): void => {
    const item = onboarding.items.find((i) => i.key === key);
    if (item && item.status === 'Pending') {
      item.status = 'Completed';
      item.completedAt = new Date();
      item.completedSource = 'Auto';
      changed = true;
    }
  };

  // 1. Personal info
  if (
    employee.phone &&
    (employee.address?.city || employee.address?.line1) &&
    employee.emergencyContact?.phone
  ) {
    markComplete('personalInfo');
  }

  // 2. Department & Manager
  if (employee.departmentId) markComplete('departmentAssignment');
  if (employee.reportingManagerId) markComplete('managerAssignment');

  // 3. Bank details
  if (employee.bankDetails?.accountHolder || employee.bankDetails?.accountNumberEnc) {
    markComplete('bankInfo');
  }

  // 4. User account
  const userExists = await User.exists({ employeeId, isDeleted: false });
  if (userExists) markComplete('companyEmailAccount');

  // 5. Documents
  const docs = await Document.find({ employeeId, isDeleted: false }).select('category').lean().exec();
  const docCategories = new Set(docs.map((d) => d.category));
  if (docCategories.has('Identity')) markComplete('identityDocs');
  if (docCategories.has('Education')) markComplete('educationalDocs');
  if (docCategories.has('Offer Letter')) markComplete('offerLetter');
  if (docCategories.has('Agreement') || docCategories.has('NDA')) markComplete('agreementNda');

  // 6. Hardware (Assets)
  const hasAsset = await AssetAssignment.exists({
    employeeId,
    actualReturnDate: null,
    isDeleted: false,
  });
  if (hasAsset) markComplete('hardwareAssignment');

  // 7. Software / License / Access
  const [hasLic, hasAccess] = await Promise.all([
    LicenseAssignment.exists({ employeeId, status: 'Assigned', isDeleted: false }),
    AccessItem.exists({ employeeId, status: 'Active', isDeleted: false }),
  ]);
  if (hasLic || hasAccess) markComplete('softwareLicenseAssignment');

  if (changed) {
    const { status } = computeOverallStatus(onboarding.items);
    onboarding.status = status;
    if (status === 'In Progress' && !onboarding.startedAt) {
      onboarding.startedAt = new Date();
    } else if (status === 'Completed' && !onboarding.completedAt) {
      onboarding.completedAt = new Date();
    }
    await onboarding.save();
    await invalidateDashboardCache();
  }
}

export async function getOnboardingByEmployeeId(
  employeeIdStr: string,
  ctx: OnboardingContext,
): Promise<OnboardingView> {
  const employeeId = toId(employeeIdStr);

  // Scoping checks
  if (ctx.account.role === 'Employee') {
    if (ctx.account.employeeId !== employeeIdStr) {
      throw forbidden('Employees may only view their own onboarding checklist');
    }
  } else if (ctx.account.role === 'Manager') {
    if (!ctx.account.employeeId) throw forbidden('Manager without employee record');
    const teamIds = await collectTeamIds(ctx.account.employeeId);
    if (!teamIds.has(employeeIdStr)) {
      throw forbidden('You are not authorized to view onboarding for this employee');
    }
  }

  let onboarding: OnboardingDoc | null = await Onboarding.findOne({ employeeId, isDeleted: false }).exec();
  const employee = await Employee.findOne({ _id: employeeId, isDeleted: false })
    .populate('departmentId', 'name')
    .lean()
    .exec();

  if (!employee) throw notFound('Employee');

  if (!onboarding) {
    // If employee exists but onboarding record is missing, auto-create it
    onboarding = await createOnboardingForEmployee(employee as unknown as EmployeeForOnboarding);
  }

  // Sync auto-completion to ensure latest live domain states are reflected
  await syncOnboardingForEmployee(employeeId);
  const refreshed = await Onboarding.findOne({ employeeId, isDeleted: false }).exec();
  const targetOnboarding = refreshed ?? onboarding;
  if (!targetOnboarding) throw notFound('Onboarding checklist');

  return toOnboardingView(targetOnboarding, employee as unknown as EmployeeDoc);
}

export async function listOnboardings(
  query: ListOnboardingsQuery,
  ctx: OnboardingContext,
): Promise<{ data: OnboardingView[]; meta: ReturnType<typeof listMeta> }> {
  const { skip, limit, page } = buildPagination(query);

  let allowedEmployeeIds: Types.ObjectId[] | null = null;
  if (ctx.account.role === 'Employee') {
    if (!ctx.account.employeeId) return { data: [], meta: listMeta({ page, limit, skip }, 0) };
    allowedEmployeeIds = [toId(ctx.account.employeeId)];
  } else if (ctx.account.role === 'Manager') {
    if (!ctx.account.employeeId) return { data: [], meta: listMeta({ page, limit, skip }, 0) };
    const teamIds = await collectTeamIds(ctx.account.employeeId);
    allowedEmployeeIds = Array.from(teamIds).map((id) => toId(id));
  }

  const employeeFilter: FilterQuery<EmployeeDoc> = { isDeleted: false };
  if (allowedEmployeeIds) {
    employeeFilter._id = trustedFilter({ $in: allowedEmployeeIds });
  }
  if (query.departmentId) {
    employeeFilter.departmentId = toId(query.departmentId);
  }
  if (query.q) {
    const regex = new RegExp(query.q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i');
    employeeFilter.$or = trustedFilter([
      { firstName: regex },
      { lastName: regex },
      { employeeCode: regex },
      { designation: regex },
    ]);
  }

  const matchingEmployees = await Employee.find(employeeFilter)
    .select('_id employeeCode firstName lastName designation departmentId employmentType dateOfJoining')
    .populate('departmentId', 'name')
    .lean()
    .exec();

  const matchingEmpIds = matchingEmployees.map((e) => e._id);
  const onboardingFilter: FilterQuery<OnboardingDoc> = {
    employeeId: trustedFilter({ $in: matchingEmpIds }),
    isDeleted: false,
  };
  if (query.status) {
    onboardingFilter.status = query.status;
  }

  const total = await Onboarding.countDocuments(onboardingFilter).exec();
  const docs = await Onboarding.find(onboardingFilter)
    .sort(query.sort ? { [query.sort]: 1 } : { createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .exec();

  const employeeMap = new Map(matchingEmployees.map((e) => [e._id.toString(), e]));
  const data = docs.map((doc) => {
    const emp = employeeMap.get(doc.employeeId.toString()) ?? {};
    return toOnboardingView(doc, emp as unknown as EmployeeDoc);
  });

  return { data, meta: listMeta({ page, limit, skip }, total) };
}

export async function updateChecklistItem(
  employeeIdStr: string,
  itemKey: OnboardingItemKey,
  body: UpdateChecklistItemBody,
  ctx: OnboardingContext,
): Promise<OnboardingView> {
  const employeeId = toId(employeeIdStr);

  // Scoping & role checks
  if (ctx.account.role === 'Employee') {
    if (ctx.account.employeeId !== employeeIdStr) {
      throw forbidden('Employees may only update their own onboarding checklist');
    }
    // Employees may only sign off self-service items (personalInfo, policyAcknowledgement)
    if (itemKey !== 'personalInfo' && itemKey !== 'policyAcknowledgement') {
      throw forbidden(`Employees cannot update checklist item "${itemKey}"`);
    }
  }

  const onboarding = await Onboarding.findOne({ employeeId, isDeleted: false }).exec();
  if (!onboarding) throw notFound('Onboarding checklist');

  const item = onboarding.items.find((i) => i.key === itemKey);
  if (!item) throw notFound(`Checklist item "${itemKey}"`);

  if (body.status === 'NA') {
    if (item.isRequired && ctx.account.role !== 'HR Admin' && ctx.account.role !== 'HR Manager') {
      throw unprocessable('Only HR can mark a required onboarding item as NA');
    }
    item.status = 'NA';
    item.naReason = body.naReason ?? null;
    item.completedAt = new Date();
    item.completedBy = ctx.account.userId ? toId(ctx.account.userId) : null;
    item.completedSource = 'Manual';
  } else if (body.status === 'Completed') {
    item.status = 'Completed';
    item.completedAt = new Date();
    item.completedBy = ctx.account.userId ? toId(ctx.account.userId) : null;
    item.completedSource = 'Manual';
  } else {
    item.status = 'Pending';
    item.completedAt = null;
    item.completedBy = null;
    item.completedSource = null;
  }

  if (body.notes !== undefined) item.notes = body.notes;

  const { status } = computeOverallStatus(onboarding.items);
  onboarding.status = status;
  if (status === 'In Progress' && !onboarding.startedAt) {
    onboarding.startedAt = new Date();
  } else if (status === 'Completed') {
    onboarding.completedAt = new Date();
  }

  await onboarding.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'onboarding.item_updated',
    entityType: 'Onboarding',
    entityId: onboarding._id,
    after: { itemKey, status: item.status, notes: item.notes },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();

  return getOnboardingByEmployeeId(employeeIdStr, ctx);
}

export async function reopenOnboarding(
  employeeIdStr: string,
  body: ReopenOnboardingBody,
  ctx: OnboardingContext,
): Promise<OnboardingView> {
  const employeeId = toId(employeeIdStr);
  const onboarding = await Onboarding.findOne({ employeeId, isDeleted: false }).exec();
  if (!onboarding) throw notFound('Onboarding checklist');

  if (onboarding.status !== 'Completed') {
    throw unprocessable('Only completed onboarding checklists can be reopened');
  }

  onboarding.status = 'In Progress';
  onboarding.reopenedAt = new Date();
  onboarding.reopenedBy = ctx.account.userId ? toId(ctx.account.userId) : null;
  onboarding.reopenReason = body.reason;
  onboarding.completedAt = null;

  await onboarding.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'onboarding.reopened',
    entityType: 'Onboarding',
    entityId: onboarding._id,
    after: { reason: body.reason, status: 'In Progress' },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();

  return getOnboardingByEmployeeId(employeeIdStr, ctx);
}

export async function getPendingOnboardingCount(account: AuthAccount): Promise<number> {
  const filter: FilterQuery<OnboardingDoc> = {
    status: trustedFilter({ $ne: 'Completed' }),
    isDeleted: false,
  };

  if (account.role === 'Employee') {
    if (!account.employeeId) return 0;
    filter.employeeId = toId(account.employeeId);
  } else if (account.role === 'Manager') {
    if (!account.employeeId) return 0;
    const teamIds = await collectTeamIds(account.employeeId);
    filter.employeeId = trustedFilter({ $in: Array.from(teamIds).map((id) => toId(id)) });
  }

  return Onboarding.countDocuments(filter).exec();
}

onAssetAssigned(async (event) => {
  try {
    await syncOnboardingForEmployee(toId(event.employeeId));
  } catch {
    // Non-blocking background sync
  }
});

onLicenseAssigned(async (event) => {
  try {
    await syncOnboardingForEmployee(toId(event.employeeId));
  } catch {
    // Non-blocking background sync
  }
});

