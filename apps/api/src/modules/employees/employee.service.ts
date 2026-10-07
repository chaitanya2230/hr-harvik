import { Types } from 'mongoose';
import type { FilterQuery } from 'mongoose';
import {
  EMPLOYMENT_TYPES,
  STATUS_TRANSITIONS,
  type EmployeeStatus,
  type EmploymentType,
} from '../../config/constants';
import { Employee } from './employee.model';
import type { EmployeeDoc } from './employee.schema';
import { Department } from '../departments/department.model';
import { User } from '../users/user.model';
import { hashPassword, type AuthAccount } from '../auth/auth.service';
import { recordAudit } from '../audit/audit.service';
import { getSettings } from '../settings/settings.service';
import { collectTeamIds } from './employee.scope';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { initializeEmployeeBalances } from '../leave/leave-balance.service';
import { createOnboardingForEmployee, syncOnboardingForEmployee } from '../onboarding/onboarding.service';
import { buildPagination, buildSort, listMeta, type Pagination } from '../../utils/http';
import { decryptField, encryptField } from '../../utils/crypto';
import { trustedFilter } from '../../utils/mongo';
import { conflict, notFound, unprocessable } from '../../utils/errors';
import { isDateOnlyString, toDateOnly } from '../../utils/dates';
import { nextHumanId } from '../../utils/ids';
import {
  EMPLOYEE_SORT_FIELDS,
  type ChangeStatusBody,
  type CreateEmployeeBody,
  type ListEmployeesQuery,
  type UpdateEmployeeBody,
} from './employee.validation';

/**
 * AGENTS.md §8.2 — Employee Management service.
 *
 * Every business rule in §8.2 is enforced here rather than in the controller,
 * so the HTTP layer and any later bulk import share one implementation.
 */

/** §8.2 — "Joining date cannot be > 1 year in future." */
const MAX_FUTURE_JOINING_DAYS = 366;

/** §8.2 — "Intern age >= 16. Others age >= 18 unless configurable."
 *
 * The live values are configuration, not code: they come from the settings
 * module (`minAgeIntern` / `minAgeOther`, §6 "system settings"), with 16/18
 * as the `.env`-era defaults until a settings row exists.
 */

export interface EmployeeContext {
  account: AuthAccount;
  ip: string | null;
  requestId: string | null;
}

const HEX24 = /^[a-f\d]{24}$/i;

const toId = (value: string): Types.ObjectId => new Types.ObjectId(value);

const idOrNull = (value: string | null | undefined): Types.ObjectId | null =>
  value ? toId(value) : null;

/**
 * Whole years between two date-only strings. Returns null when either input is
 * malformed, so the caller decides whether that is an error.
 */
export function ageOnDate(dob: string, onDate: string): number | null {
  if (!isDateOnlyString(dob) || !isDateOnlyString(onDate)) return null;
  const birth = new Date(`${dob}T00:00:00.000Z`);
  const at = new Date(`${onDate}T00:00:00.000Z`);
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = at.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && at.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/** Escape a user string before it is used inside a RegExp (§11 — no ReDoS). */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------
// §8.2 business-rule guards
// ---------------------------------------------------------------------------

function assertJoiningDateNotTooFarFuture(dateOfJoining: string): void {
  const horizon = toDateOnly(new Date(Date.now() + MAX_FUTURE_JOINING_DAYS * 86_400_000));
  if (dateOfJoining > horizon) {
    throw unprocessable(
      `Date of joining must not be more than one year in the future (after ${horizon})`,
    );
  }
}

async function assertMinimumAge(dob: string | null | undefined, employmentType: EmploymentType, asOf: string): Promise<void> {
  if (!dob) return;
  const settings = await getSettings();
  const minimum =
    employmentType === 'Intern' ? settings.minAgeIntern : settings.minAgeOther;
  const age = ageOnDate(dob, asOf);
  if (age === null) return;
  if (age < minimum) {
    throw unprocessable(
      employmentType === 'Intern'
        ? `An Intern must be at least ${minimum} years old on the date of joining (this employee is ${age})`
        : `A ${employmentType} employee must be at least ${minimum} years old on the date of joining (this employee is ${age})`,
    );
  }
}

/**
 * §8.2 — the manager must exist and must not already be Relieved.
 * Also rejects self-reporting, which §8.2 forbids separately.
 */
async function assertManagerIsAssignable(
  employeeId: Types.ObjectId | null,
  managerId: Types.ObjectId | null,
): Promise<void> {
  if (!managerId) return;

  if (employeeId && managerId.equals(employeeId)) {
    throw unprocessable('An employee cannot report to themselves');
  }

  const manager = await Employee.findOne({ _id: managerId, isDeleted: false })
    .select('status')
    .lean()
    .exec();

  if (!manager) throw unprocessable('The selected reporting manager does not exist');
  if (manager.status === 'Relieved') {
    throw unprocessable('The selected reporting manager has been Relieved');
  }
}

/**
 * §8.2 — "Circular manager chains prohibited".
 *
 * Walk up from the proposed manager; if the employee being edited is met, the
 * new chain would contain a cycle. The walk is bounded so a pre-existing cycle
 * in the data cannot hang the request.
 */
async function assertNoCircularChain(employeeId: Types.ObjectId, managerId: Types.ObjectId): Promise<void> {
  let cursor: Types.ObjectId | null = managerId;
  const seen = new Set<string>();

  while (cursor) {
    const key = cursor.toString();
    if (key === employeeId.toString()) {
      throw unprocessable('This change would create a circular reporting chain');
    }
    if (seen.has(key)) break; // Pre-existing cycle: stop, do not loop.
    seen.add(key);

    const doc: { reportingManagerId?: Types.ObjectId | null } | null = await Employee.findById(cursor)
      .select('reportingManagerId')
      .lean()
      .exec();
    cursor = doc?.reportingManagerId ?? null;
  }
}

async function assertDepartmentExists(departmentId: string | null | undefined): Promise<void> {
  if (!departmentId) return;
  const exists = await Department.exists({ _id: toId(departmentId), isDeleted: false });
  if (!exists) throw unprocessable('The selected department does not exist');
}

/**
 * Shared by the P2 asset / license / access services: the receiving employee
 * must exist, must not be soft-deleted, and must not be Relieved (§8.8, §8.9).
 */
export async function assertEmployeeAssignable(
  employeeId: Types.ObjectId,
  resource: string,
): Promise<void> {
  const target = await Employee.findOne({ _id: employeeId, isDeleted: false })
    .select('status')
    .lean()
    .exec();

  if (!target) throw unprocessable(`The selected employee does not exist for this ${resource}`);
  if (target.status === 'Relieved') {
    throw unprocessable(`A Relieved employee cannot receive a ${resource}`);
  }
}

/** §8.2 — duplicate email is a 409, not a 400. */
async function assertEmailAvailable(email: string, excludeId?: Types.ObjectId): Promise<void> {
  const filter: FilterQuery<EmployeeDoc> = { email: email.toLowerCase() };
  if (excludeId) filter._id = trustedFilter({ $ne: excludeId });
  if (await Employee.exists(filter)) {
    throw conflict(`An employee with the email ${email.toLowerCase()} already exists`);
  }
}

// ---------------------------------------------------------------------------
// Response projection (§7 / §11 — never leak secrets)
// ---------------------------------------------------------------------------

interface EmployeeView {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
  dob: string | null;
  designation: string | null;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  dateOfJoining: string;
  probationEndDate: string | null;
  lastWorkingDay: string | null;
  department: { id: string; name: string } | null;
  reportingManager: { id: string; employeeCode: string; fullName: string } | null;
  address: Record<string, string | undefined> | null;
  emergencyContact: Record<string, string | undefined> | null;
  compensation: { amount?: number; currency?: string; period?: string } | null;
  /** Masked for everyone except HR Admin / self on single-detail reads (§7). */
  bankDetails: {
    accountHolder?: string;
    accountNumber?: string;
    ifscOrRouting?: string;
    bankName?: string;
    masked: boolean;
  } | null;
  statusHistory: Array<{ status: EmployeeStatus; changedAt: string; changedBy: string | null; note?: string }>;
  employmentHistory: Array<{
    employmentType: EmploymentType;
    designation?: string;
    departmentId: string | null;
    from: string;
    to: string | null;
    note?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

type Populated = EmployeeDoc & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  departmentId?: { _id: Types.ObjectId; name: string } | null;
  reportingManagerId?: {
    _id: Types.ObjectId;
    employeeCode: string;
    firstName: string;
    lastName: string;
  } | null;
};

const plainSubdoc = <T>(value: T): Record<string, unknown> => {
  if (!value || typeof value !== 'object') return {};
  const maybe = value as { toObject?: () => unknown };
  if (typeof maybe.toObject === 'function') {
    return (maybe.toObject() as Record<string, unknown>) ?? {};
  }
  return { ...(value as Record<string, unknown>) };
};

/**
 * §7 — "Normal responses must mask bank details except HR Admin/self according
 * to RBAC", balanced against §2.16 (never expose bank details in normal list
 * responses).
 *
 * Lists and mutation echoes are always masked. Only the single-employee detail
 * read reveals the account number, and only to HR Admin or the employee
 * themselves. `accountNumberEnc` itself never reaches any response.
 */
function projectBankDetails(doc: EmployeeDoc, reveal: boolean): EmployeeView['bankDetails'] {
  const bank = doc.bankDetails;
  const hasAnything =
    bank?.accountHolder || bank?.accountNumberEnc || bank?.ifscOrRouting || bank?.bankName;
  if (!hasAnything) return null;

  if (reveal && bank?.accountNumberEnc) {
    try {
      return {
        accountHolder: bank.accountHolder ?? undefined,
        accountNumber: decryptField(bank.accountNumberEnc),
        ifscOrRouting: bank.ifscOrRouting ?? undefined,
        bankName: bank.bankName ?? undefined,
        masked: false,
      };
    } catch {
      // A corrupt ciphertext must not fail the whole read; fall through masked.
    }
  }

  return {
    accountHolder: bank?.accountHolder ?? undefined,
    ifscOrRouting: bank?.ifscOrRouting ?? undefined,
    bankName: bank?.bankName ?? undefined,
    masked: true,
  };
}

/** Compensation is salary data (§8.11): HR roles and the employee themself. */
function maySeeCompensation(account: AuthAccount, employeeId: string): boolean {
  return (
    account.role === 'HR Admin' ||
    account.role === 'HR Manager' ||
    account.employeeId === employeeId
  );
}

function toView(
  doc: Populated,
  account: AuthAccount,
  options: { revealBankDetails?: boolean } = {},
): EmployeeView {
  const id = doc._id.toString();
  const manager = doc.reportingManagerId;

  return {
    id,
    employeeCode: doc.employeeCode,
    firstName: doc.firstName,
    lastName: doc.lastName,
    fullName: `${doc.firstName} ${doc.lastName}`.trim(),
    email: doc.email,
    phone: doc.phone ?? null,
    photoUrl: doc.photoUrl ?? null,
    dob: doc.dob ?? null,
    designation: doc.designation ?? null,
    employmentType: doc.employmentType,
    status: doc.status,
    dateOfJoining: doc.dateOfJoining,
    probationEndDate: doc.probationEndDate ?? null,
    lastWorkingDay: doc.lastWorkingDay ?? null,
    department: doc.departmentId
      ? { id: doc.departmentId._id.toString(), name: doc.departmentId.name }
      : null,
    reportingManager: manager
      ? {
          id: manager._id.toString(),
          employeeCode: manager.employeeCode,
          fullName: `${manager.firstName} ${manager.lastName}`.trim(),
        }
      : null,
    address: (doc.address as Record<string, string | undefined>) ?? null,
    emergencyContact: (doc.emergencyContact as Record<string, string | undefined>) ?? null,
    compensation: maySeeCompensation(account, id)
      ? ((doc.compensation as EmployeeView['compensation']) ?? null)
      : null,
    bankDetails: projectBankDetails(doc, options.revealBankDetails ?? false),
    statusHistory: (doc.statusHistory ?? []).map((entry) => ({
      status: entry.status,
      changedAt: entry.changedAt.toISOString(),
      changedBy: entry.changedBy ? entry.changedBy.toString() : null,
      ...(entry.note ? { note: entry.note } : {}),
    })),
    employmentHistory: (doc.employmentHistory ?? []).map((entry) => ({
      employmentType: entry.employmentType,
      ...(entry.designation ? { designation: entry.designation } : {}),
      departmentId: entry.departmentId ? entry.departmentId.toString() : null,
      from: entry.from.toISOString(),
      to: entry.to ? entry.to.toISOString() : null,
      ...(entry.note ? { note: entry.note } : {}),
    })),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

const POPULATE = [
  { path: 'departmentId', select: 'name' },
  { path: 'reportingManagerId', select: 'employeeCode firstName lastName' },
];

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ListResult {
  items: EmployeeView[];
  meta: { page: number; limit: number; total: number };
}

export async function listEmployees(
  query: ListEmployeesQuery,
  ctx: EmployeeContext,
  visibleIds?: Set<string>,
): Promise<ListResult> {
  const pagination: Pagination = buildPagination({
    page: query.page,
    limit: query.limit,
  });
  const sort = buildSort(query.sort, EMPLOYEE_SORT_FIELDS, { dateOfJoining: -1 });

  const filter: FilterQuery<EmployeeDoc> = {
    isDeleted: query.includeDeleted ? trustedFilter({ $in: [true, false] }) : false,
  };

  // Manager / Employee callers see only their own scope.
  if (visibleIds) {
    filter._id = trustedFilter({
      $in: [...visibleIds].filter((id) => HEX24.test(id)).map(toId),
    });
  }

  if (query.departmentId) filter.departmentId = toId(query.departmentId);
  if (query.employmentType) filter.employmentType = query.employmentType;
  if (query.status) filter.status = query.status;
  if (query.reportingManagerId) filter.reportingManagerId = toId(query.reportingManagerId);

  if (query.joinedFrom || query.joinedTo) {
    filter.dateOfJoining = trustedFilter({
      ...(query.joinedFrom ? { $gte: query.joinedFrom } : {}),
      ...(query.joinedTo ? { $lte: query.joinedTo } : {}),
    });
  }

  // §8.2 — search by name, email, employeeCode, phone.
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { email: rx },
      { employeeCode: rx },
      { phone: rx },
    ];
  }

  const [docs, total] = await Promise.all([
    Employee.find(filter)
      .populate(POPULATE)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    Employee.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map((doc) => toView(doc as unknown as Populated, ctx.account)),
    meta: listMeta(pagination, total),
  };
}

export async function getEmployeeById(id: string, ctx: EmployeeContext): Promise<EmployeeView> {
  const doc = await Employee.findOne({ _id: toId(id), isDeleted: false })
    .populate(POPULATE)
    .lean()
    .exec();

  if (!doc) throw notFound('Employee');
  // §7 exception: HR Admin and the employee themselves see full bank details
  // on the single-detail read. Every other path stays masked.
  const revealBankDetails = ctx.account.role === 'HR Admin' || ctx.account.employeeId === id;
  return toView(doc as unknown as Populated, ctx.account, { revealBankDetails });
}

/** §8.2 `GET /employees/:id/history` — status plus employment history. */
export async function getEmployeeHistory(id: string) {
  const doc = await Employee.findOne({ _id: toId(id), isDeleted: false })
    .select('employeeCode firstName lastName status statusHistory employmentHistory')
    .lean()
    .exec();

  if (!doc) throw notFound('Employee');

  return {
    employee: {
      id: doc._id.toString(),
      employeeCode: doc.employeeCode,
      fullName: `${doc.firstName} ${doc.lastName}`.trim(),
      status: doc.status,
    },
    statusHistory: (doc.statusHistory ?? []).map((entry) => ({
      status: entry.status,
      changedAt: entry.changedAt.toISOString(),
      changedBy: entry.changedBy ? entry.changedBy.toString() : null,
      ...(entry.note ? { note: entry.note } : {}),
    })),
    employmentHistory: (doc.employmentHistory ?? []).map((entry) => ({
      employmentType: entry.employmentType,
      ...(entry.designation ? { designation: entry.designation } : {}),
      departmentId: entry.departmentId ? entry.departmentId.toString() : null,
      from: entry.from.toISOString(),
      to: entry.to ? entry.to.toISOString() : null,
      ...(entry.note ? { note: entry.note } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * §8.2 — "Default Full-Time status is Probation when probation configured".
 *
 * Read as: a Full-Time employee starts on Probation when the settings row
 * has `probationDefault` enabled (they have just joined and have not yet
 * cleared probation), everyone else starts Active. An explicit `status` in
 * the body always wins. See docs/DECISIONS.md D-24; the toggle was added
 * with the settings module (D-48).
 */
export function defaultStatusFor(
  employmentType: EmploymentType,
  probationDefault = true,
): EmployeeStatus {
  if (employmentType === 'Full-Time' && probationDefault) return 'Probation';
  return 'Active';
}

export async function createEmployee(body: CreateEmployeeBody, ctx: EmployeeContext): Promise<EmployeeView> {
  const email = body.email.toLowerCase();

  await assertEmailAvailable(email);
  await assertDepartmentExists(body.departmentId);
  assertJoiningDateNotTooFarFuture(body.dateOfJoining);
  await assertMinimumAge(body.dob, body.employmentType, body.dateOfJoining);

  const settings = await getSettings();

  const managerId = idOrNull(body.reportingManagerId ?? undefined);
  await assertManagerIsAssignable(null, managerId);

  if (
    body.status &&
    !STATUS_TRANSITIONS[defaultStatusFor(body.employmentType, settings.probationDefault)].includes(
      body.status,
    )
  ) {
    throw unprocessable(
      `A new ${body.employmentType} employee cannot start with status "${body.status}"`,
    );
  }

  const status = body.status ?? defaultStatusFor(body.employmentType, settings.probationDefault);

  // §7 — human-readable id, allocated atomically through the counters collection.
  const employeeCode = await nextHumanId('employee');

  const created = await Employee.create({
    employeeCode,
    firstName: body.firstName,
    lastName: body.lastName,
    email,
    phone: body.phone ?? null,
    dob: body.dob ?? null,
    photoUrl: body.photoUrl ?? null,
    address: body.address ?? {},
    emergencyContact: body.emergencyContact ?? {},
    designation: body.designation ?? null,
    departmentId: idOrNull(body.departmentId ?? undefined),
    reportingManagerId: managerId,
    employmentType: body.employmentType,
    dateOfJoining: body.dateOfJoining,
    probationEndDate: body.probationEndDate ?? null,
    compensation: body.compensation ?? {},
    // §7 / §11 — encrypt before it ever reaches the database.
    bankDetails: body.bankDetails
      ? {
          accountHolder: body.bankDetails.accountHolder,
          ...(body.bankDetails.accountNumber
            ? { accountNumberEnc: encryptField(body.bankDetails.accountNumber) }
            : {}),
          ifscOrRouting: body.bankDetails.ifscOrRouting,
          bankName: body.bankDetails.bankName,
        }
      : {},
    status,
    statusHistory: [
      {
        status,
        changedAt: new Date(),
        changedBy: idOrNull(ctx.account.userId),
        note: 'Initial status on creation',
      },
    ],
    employmentHistory: [
      {
        employmentType: body.employmentType,
        designation: body.designation,
        departmentId: idOrNull(body.departmentId ?? undefined),
        from: new Date(`${body.dateOfJoining}T00:00:00.000Z`),
        to: null,
        note: 'Initial employment record',
      },
    ],
    createdBy: idOrNull(ctx.account.userId),
    isDeleted: false,
  });

  // §8.2 — "Creating employee can optionally create login."
  if (body.createLogin) {
    // An HR Manager must not be able to mint an administrator (§6).
    if (ctx.account.role !== 'HR Admin' && body.createLogin.role === 'HR Admin') {
      throw unprocessable('Only an HR Admin can create an HR Admin login');
    }
    if (await User.exists({ email: body.createLogin.email })) {
      throw conflict(`A login already exists for ${body.createLogin.email.toLowerCase()}`);
    }
    await User.create({
      email: body.createLogin.email,
      passwordHash: await hashPassword(body.createLogin.password),
      role: body.createLogin.role,
      employeeId: created._id,
      isActive: true,
      lastLoginAt: null,
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
      createdBy: idOrNull(ctx.account.userId),
      isDeleted: false,
    });
  }

  // §8.2 — "Creating employee auto-creates leave balances."
  await initializeEmployeeBalances(created._id, created.dateOfJoining, created.employmentType);

  // §8.2 — "Creating employee auto-creates onboarding checklist."
  await createOnboardingForEmployee(created);

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'employee.created',
    entityType: 'Employee',
    entityId: created._id,
    after: { employeeCode, email, employmentType: body.employmentType, status },
  });

  // §3 — invalidate the dashboard cache after relevant employee writes.
  await invalidateDashboardCache();

  const populated = await Employee.findById(created._id).populate(POPULATE).lean().exec();
  return toView(populated as unknown as Populated, ctx.account);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateEmployee(
  id: string,
  body: UpdateEmployeeBody,
  ctx: EmployeeContext,
): Promise<EmployeeView> {
  const employeeId = toId(id);
  const existing = await Employee.findOne({ _id: employeeId, isDeleted: false }).exec();
  if (!existing) throw notFound('Employee');

  const before = {
    firstName: existing.firstName,
    lastName: existing.lastName,
    email: existing.email,
    designation: existing.designation,
    employmentType: existing.employmentType,
    departmentId: existing.departmentId?.toString() ?? null,
    reportingManagerId: existing.reportingManagerId?.toString() ?? null,
    dateOfJoining: existing.dateOfJoining,
  };

  if (body.email && body.email.toLowerCase() !== existing.email) {
    await assertEmailAvailable(body.email, employeeId);
    existing.email = body.email.toLowerCase();
  }

  if (body.firstName !== undefined) existing.firstName = body.firstName;
  if (body.lastName !== undefined) existing.lastName = body.lastName;
  if (body.phone !== undefined) existing.phone = body.phone;
  if (body.dob !== undefined) existing.dob = body.dob;
  if (body.photoUrl !== undefined) existing.photoUrl = body.photoUrl;
  if (body.designation !== undefined) existing.designation = body.designation;
  if (body.probationEndDate !== undefined) existing.probationEndDate = body.probationEndDate;
  if (body.address) existing.address = { ...plainSubdoc(existing.address), ...body.address };
  if (body.emergencyContact) {
    existing.emergencyContact = {
      ...plainSubdoc(existing.emergencyContact),
      ...body.emergencyContact,
    };
  }
  if (body.compensation) existing.compensation = { ...plainSubdoc(existing.compensation), ...body.compensation };

  if (body.bankDetails) {
    existing.bankDetails = {
      ...plainSubdoc(existing.bankDetails),
      ...body.bankDetails,
      // Re-encrypt only when a new number was supplied; otherwise keep the
      // stored ciphertext rather than overwriting it with `undefined`.
      ...(body.bankDetails.accountNumber
        ? { accountNumberEnc: encryptField(body.bankDetails.accountNumber) }
        : {}),
    };
    // `accountNumber` is an input-only field and must never be persisted.
    delete (existing.bankDetails as unknown as Record<string, unknown>).accountNumber;
  }

  if (body.departmentId !== undefined) {
    await assertDepartmentExists(body.departmentId);
    existing.departmentId = idOrNull(body.departmentId);
  }

  if (body.reportingManagerId !== undefined) {
    const managerId = idOrNull(body.reportingManagerId);
    await assertManagerIsAssignable(employeeId, managerId);
    if (managerId) await assertNoCircularChain(employeeId, managerId);
    existing.reportingManagerId = managerId;
  }

  if (body.dateOfJoining !== undefined) {
    assertJoiningDateNotTooFarFuture(body.dateOfJoining);
    existing.dateOfJoining = body.dateOfJoining;
  }

  // §8.2 — "Employment type change appends employment history."
  if (body.employmentType !== undefined && body.employmentType !== existing.employmentType) {
    const nextType = body.employmentType as EmploymentType;
    if (!EMPLOYMENT_TYPES.includes(nextType)) throw unprocessable('Unknown employment type');

    await assertMinimumAge(
      existing.dob,
      nextType,
      body.dateOfJoining ?? existing.dateOfJoining,
    );

    // Close the previous employment record and open a new one.
    const currentRecord = existing.employmentHistory[existing.employmentHistory.length - 1];
    if (currentRecord && !currentRecord.to) {
      currentRecord.to = new Date();
      currentRecord.note = 'Employment type changed';
    }
    existing.employmentHistory.push({
      employmentType: nextType,
      designation: body.designation ?? existing.designation ?? undefined,
      departmentId: existing.departmentId,
      from: new Date(),
      to: null,
      note: `Employment type changed to ${nextType}`,
    } as never);
    existing.employmentType = nextType;
  }

  // §8.2 — "Employee code remains unchanged." Deliberately never written here.

  await existing.save();

  await syncOnboardingForEmployee(employeeId);

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'employee.updated',
    entityType: 'Employee',
    entityId: employeeId,
    before,
    after: {
      firstName: existing.firstName,
      lastName: existing.lastName,
      email: existing.email,
      designation: existing.designation,
      employmentType: existing.employmentType,
      departmentId: existing.departmentId?.toString() ?? null,
      reportingManagerId: existing.reportingManagerId?.toString() ?? null,
      dateOfJoining: existing.dateOfJoining,
    },
  });

  await invalidateDashboardCache();

  const populated = await Employee.findById(employeeId).populate(POPULATE).lean().exec();
  return toView(populated as unknown as Populated, ctx.account);
}

// ---------------------------------------------------------------------------
// Status changes (§8.2)
// ---------------------------------------------------------------------------

/**
 * §8.2 allowed transitions, as an explicit table so the error message can say
 * exactly what is permitted.
 */
const ALLOWED_FROM: Record<EmployeeStatus, readonly EmployeeStatus[]> = STATUS_TRANSITIONS;

/**
 * AGENTS.md §8.2 requires that moving an employee to On Notice / Resigned
 * auto-creates an Exit record and checklist. That belongs to the exit module,
 * which is P3, so P1 deliberately performs only the status change itself and
 * emits a domain event. P3 subscribes to that event and creates the Exit.
 *
 * P1 creates no Exit document and no placeholder — see docs/DECISIONS.md D-25.
 */
export interface EmployeeStatusChangedEvent {
  employeeId: string;
  employeeCode: string;
  from: EmployeeStatus;
  to: EmployeeStatus;
  lastWorkingDay: string | null;
  changedAt: string;
  actorId: string;
}

/**
 * In-process subscriber list.
 *
 * Deliberately a plain array rather than an event bus or queue: one hook point,
 * no new dependency, and P3 can push to Redis/BullMQ from inside its handler if
 * cross-process delivery is ever needed.
 */
type StatusChangedListener = (event: EmployeeStatusChangedEvent) => Promise<void> | void;
const statusChangedListeners: StatusChangedListener[] = [];

export function onEmployeeStatusChanged(listener: StatusChangedListener): () => void {
  statusChangedListeners.push(listener);
  return () => {
    const index = statusChangedListeners.indexOf(listener);
    if (index >= 0) statusChangedListeners.splice(index, 1);
  };
}

async function emitStatusChanged(event: EmployeeStatusChangedEvent): Promise<void> {
  for (const listener of statusChangedListeners) {
    try {
      await listener(event);
    } catch {
      // A subscriber failure must not roll back a valid status change; the audit
      // entry and the persisted status remain the source of truth.
    }
  }
}

export async function changeEmployeeStatus(
  id: string,
  body: ChangeStatusBody,
  ctx: EmployeeContext,
): Promise<EmployeeView> {
  const employeeId = toId(id);
  const existing = await Employee.findOne({ _id: employeeId, isDeleted: false }).exec();
  if (!existing) throw notFound('Employee');

  const from = existing.status;
  const to = body.status;

  // §8.2 — "Relieved → terminal, except HR Admin re-hire".
  const isRehire = from === 'Relieved' && to === 'Active';
  if (isRehire) {
    if (ctx.account.role !== 'HR Admin') {
      throw unprocessable(
        'Only an HR Admin may re-hire a Relieved employee. Relieved is otherwise a terminal status.',
      );
    }
  } else if (!ALLOWED_FROM[from].includes(to)) {
    throw unprocessable(
      `Cannot change status from "${from}" to "${to}". Allowed from "${from}": ${
        ALLOWED_FROM[from].join(', ') || 'none (terminal status)'
      }`,
      { from, to, allowed: ALLOWED_FROM[from] },
    );
  }

  if (body.lastWorkingDay) existing.lastWorkingDay = body.lastWorkingDay;
  existing.status = to;
  existing.statusHistory.push({
    status: to,
    changedAt: new Date(),
    changedBy: idOrNull(ctx.account.userId),
    note: body.note ?? (isRehire ? 'Re-hired by HR Admin' : `Changed from ${from}`),
  } as never);

  // A re-hire opens a new employment record, which §14 requires.
  if (isRehire) {
    const currentRecord = existing.employmentHistory[existing.employmentHistory.length - 1];
    if (currentRecord && !currentRecord.to) currentRecord.to = new Date();
    existing.employmentHistory.push({
      employmentType: existing.employmentType,
      designation: existing.designation ?? undefined,
      departmentId: existing.departmentId,
      from: new Date(),
      to: null,
      note: body.reason ? `Re-hired: ${body.reason}` : 'Re-hired by HR Admin',
    } as never);
    // §8.10 (P3) — a re-hire must not inherit the previous exit's LWD.
    existing.lastWorkingDay = null;
  }

  await existing.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'employee.status_changed',
    entityType: 'Employee',
    entityId: employeeId,
    before: { status: from },
    after: { status: to, lastWorkingDay: existing.lastWorkingDay ?? null },
  });

  await emitStatusChanged({
    employeeId: employeeId.toString(),
    employeeCode: existing.employeeCode,
    from,
    to,
    lastWorkingDay: existing.lastWorkingDay ?? null,
    changedAt: new Date().toISOString(),
    actorId: ctx.account.userId,
  });

  await invalidateDashboardCache();

  const populated = await Employee.findById(employeeId).populate(POPULATE).lean().exec();
  return toView(populated as unknown as Populated, ctx.account);
}

// ---------------------------------------------------------------------------
// Soft delete (§7 — every document carries isDeleted)
// ---------------------------------------------------------------------------

export async function softDeleteEmployee(id: string, ctx: EmployeeContext): Promise<void> {
  const employeeId = toId(id);
  const existing = await Employee.findOne({ _id: employeeId, isDeleted: false }).exec();
  if (!existing) throw notFound('Employee');

  // §8.2 — an employee with active reports cannot simply vanish.
  const reportCount = await Employee.countDocuments({
    reportingManagerId: employeeId,
    isDeleted: false,
  });
  if (reportCount > 0) {
    throw conflict(
      `${existing.firstName} ${existing.lastName} still has ${reportCount} active report(s). Reassign them before deleting.`,
    );
  }

  existing.isDeleted = true;
  await existing.save();

  await User.updateMany({ employeeId, isDeleted: false }, { $set: { isActive: false } }).exec();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'employee.deleted',
    entityType: 'Employee',
    entityId: employeeId,
    before: { employeeCode: existing.employeeCode, status: existing.status, isDeleted: false },
    after: { isDeleted: true },
  });

  await invalidateDashboardCache();
}

/**
 * Employee ids a caller may see, or `undefined` for an unrestricted caller.
 * Exported for the dashboard so both modules share one scope implementation.
 */
export async function scopeIdsFor(account: AuthAccount): Promise<Set<string> | undefined> {
  if (account.role === 'HR Admin' || account.role === 'HR Manager') return undefined;
  if (!account.employeeId || !HEX24.test(account.employeeId)) return new Set<string>();
  if (account.role === 'Manager') return collectTeamIds(account.employeeId);
  return new Set([account.employeeId]);
}
