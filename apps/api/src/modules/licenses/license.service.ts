import mongoose, { Types } from 'mongoose';
import type { FilterQuery } from 'mongoose';
import type { LicenseStatus } from '../../config/constants';
import { License, LicenseAssignment } from './license.model';
import type { LicenseAssignmentDoc, LicenseDoc } from './license.schema';
import {
  assertEmployeeAssignable,
  type EmployeeContext,
} from '../employees/employee.service';
import { recordAudit } from '../audit/audit.service';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { buildPagination, buildSort, listMeta, type Pagination } from '../../utils/http';
import { conflict, forbidden, notFound, unprocessable } from '../../utils/errors';
import { decryptField, encryptField } from '../../utils/crypto';
import { isDateOnlyString, todayInTimeZone } from '../../utils/dates';
import { trustedFilter } from '../../utils/mongo';
import { nextHumanId } from '../../utils/ids';
import {
  LICENSE_SORT_FIELDS,
  type AssignLicenseBody,
  type CreateLicenseBody,
  type ListLicenseAssignmentsQuery,
  type ListLicensesQuery,
  type RenewLicenseBody,
  type RevokeLicenseAssignmentBody,
  type SuspendLicenseBody,
  type UpdateLicenseBody,
} from './license.validation';

/**
 * AGENTS.md §8.9 — Software / Licenses service.
 *
 * Seat assignment is a transaction (§3): the seat claim, the assignment row
 * and the status flip commit together. The claim itself is an atomic
 * `$expr`-guarded `$inc`, so a last-seat race resolves to exactly one winner;
 * the partial unique index makes a duplicate commit impossible even then.
 *
 * Key handling (§7, §8.9, §11): the plaintext key exists only in the request
 * body. It is encrypted into `licenseKeyRef` before persistence and never
 * leaves the database except through the audited HR-Admin reveal endpoint.
 */

const toId = (value: string): Types.ObjectId => new Types.ObjectId(value);

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface LicenseView {
  id: string;
  licenseCode: string;
  softwareName: string;
  licenseType: string;
  /** True when a key is stored — the value itself is never included. */
  hasKey: boolean;
  provider: string | null;
  cost: number | null;
  currency: string | null;
  billingCycle: string | null;
  startDate: string | null;
  renewalDate: string | null;
  maxSeats: number;
  usedSeats: number;
  /** Always derived, never stored (§7). */
  availableSeats: number;
  status: LicenseStatus;
  /** Stored status says Available but the renewal date has passed. */
  effectivelyExpired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LicenseAssignmentView {
  id: string;
  license: { id: string; licenseCode: string; softwareName: string } | null;
  employee: { id: string; employeeCode: string; fullName: string } | null;
  assignedAt: string;
  accountIdentifier: string | null;
  status: 'Assigned' | 'Revoked';
  revokedAt: string | null;
  revocationNote: string | null;
}

type PopulatedLicense = LicenseDoc & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type PopulatedLicenseAssignment = LicenseAssignmentDoc & {
  _id: Types.ObjectId;
  createdAt: Date;
  licenseId: { _id: Types.ObjectId; licenseCode: string; softwareName: string } | null;
  employeeId: { _id: Types.ObjectId; employeeCode: string; firstName: string; lastName: string } | null;
};

function toLicenseView(doc: PopulatedLicense, today: string): LicenseView {
  const availableSeats = doc.maxSeats - doc.usedSeats;
  return {
    id: doc._id.toString(),
    licenseCode: doc.licenseCode,
    softwareName: doc.softwareName,
    licenseType: doc.licenseType,
    hasKey: !!doc.licenseKeyRef,
    provider: doc.provider ?? null,
    cost: doc.cost ?? null,
    currency: doc.currency ?? null,
    billingCycle: doc.billingCycle ?? null,
    startDate: doc.startDate ?? null,
    renewalDate: doc.renewalDate ?? null,
    maxSeats: doc.maxSeats,
    usedSeats: doc.usedSeats,
    availableSeats,
    status: doc.status,
    effectivelyExpired: !!doc.renewalDate && doc.renewalDate < today,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toAssignmentView(doc: PopulatedLicenseAssignment): LicenseAssignmentView {
  return {
    id: doc._id.toString(),
    license: doc.licenseId
      ? {
          id: doc.licenseId._id.toString(),
          licenseCode: doc.licenseId.licenseCode,
          softwareName: doc.licenseId.softwareName,
        }
      : null,
    employee: doc.employeeId
      ? {
          id: doc.employeeId._id.toString(),
          employeeCode: doc.employeeId.employeeCode,
          fullName: `${doc.employeeId.firstName} ${doc.employeeId.lastName}`.trim(),
        }
      : null,
    assignedAt: doc.assignedAt.toISOString(),
    accountIdentifier: doc.accountIdentifier ?? null,
    status: doc.status,
    revokedAt: doc.revokedAt ? doc.revokedAt.toISOString() : null,
    revocationNote: doc.revocationNote ?? null,
  };
}

const ASSIGNMENT_POPULATE = [
  { path: 'licenseId', select: 'licenseCode softwareName' },
  { path: 'employeeId', select: 'employeeCode firstName lastName' },
];

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

// ---------------------------------------------------------------------------
// Events for P3 (D-31).
// ---------------------------------------------------------------------------

export interface LicenseRevokedEvent {
  licenseId: string;
  licenseCode: string;
  employeeId: string;
  assignmentId: string;
  actorId: string;
}

type LicenseRevokedListener = (event: LicenseRevokedEvent) => Promise<void> | void;
const licenseRevokedListeners: LicenseRevokedListener[] = [];

export function onLicenseRevoked(listener: LicenseRevokedListener): () => void {
  licenseRevokedListeners.push(listener);
  return () => {
    const index = licenseRevokedListeners.indexOf(listener);
    if (index >= 0) licenseRevokedListeners.splice(index, 1);
  };
}

async function emitLicenseRevoked(event: LicenseRevokedEvent): Promise<void> {
  for (const listener of licenseRevokedListeners) {
    try {
      await listener(event);
    } catch {
      // Subscriber failures never roll back a valid revoke.
    }
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * §8.9 assignment blockers: no seats, expired, suspended, revoked, Relieved
 * employee. Expiry is *effective* (stored status or a past renewal date, D-30).
 */
function assertLicenseAssignable(
  license: { status: LicenseStatus; renewalDate?: string | null; licenseCode: string },
  today: string,
): void {
  if (license.status === 'Suspended') {
    throw unprocessable(`License ${license.licenseCode} is Suspended and cannot be assigned`);
  }
  if (license.status === 'Revoked') {
    throw unprocessable(`License ${license.licenseCode} is Revoked and cannot be assigned`);
  }
  if (license.status === 'Expired' || (license.renewalDate && license.renewalDate < today)) {
    throw unprocessable(`License ${license.licenseCode} is Expired and cannot be assigned`);
  }
}

function validateRenewalDate(startDate: string | null | undefined, renewalDate: string): void {
  if (!isDateOnlyString(renewalDate)) throw unprocessable('Renewal date must be a YYYY-MM-DD date');
  if (startDate && renewalDate <= startDate) {
    throw unprocessable('Renewal date must be after the start date');
  }
  if (renewalDate <= todayInTimeZone()) {
    throw unprocessable('Renewal date must be in the future');
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface LicenseListResult {
  items: LicenseView[];
  meta: { page: number; limit: number; total: number };
}

export async function listLicenses(query: ListLicensesQuery): Promise<LicenseListResult> {
  const pagination: Pagination = buildPagination({ page: query.page, limit: query.limit });
  const sort = buildSort(query.sort, LICENSE_SORT_FIELDS, { softwareName: 1 });
  const today = todayInTimeZone();

  // `licenseKeyRef` is `select: false` in the schema, so even a careless
  // projection cannot leak it — but exclude it explicitly anyway.
  const filter: FilterQuery<LicenseDoc> = { isDeleted: false };
  if (query.licenseType) filter.licenseType = query.licenseType;
  if (query.status) filter.status = query.status;
  if (query.provider) filter.provider = query.provider;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ softwareName: rx }, { licenseCode: rx }, { provider: rx }];
  }

  const [docs, total] = await Promise.all([
    License.find(filter).select('-licenseKeyRef').sort(sort).skip(pagination.skip).limit(pagination.limit).exec(),
    License.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map((doc) => toLicenseView(doc as unknown as PopulatedLicense, today)),
    meta: listMeta(pagination, total),
  };
}

export async function getLicenseById(id: string): Promise<LicenseView> {
  const doc = await License.findOne({ _id: toId(id), isDeleted: false })
    .select('-licenseKeyRef')
    .exec();
  if (!doc) throw notFound('License');
  return toLicenseView(doc as unknown as PopulatedLicense, todayInTimeZone());
}

export interface UtilizationView {
  licenseCode: string;
  softwareName: string;
  status: LicenseStatus;
  maxSeats: number;
  usedSeats: number;
  availableSeats: number;
  utilizationPct: number;
  renewalDate: string | null;
  activeAssignments: number;
}

/** §8.9 utilization. */
export async function getLicenseUtilization(id: string): Promise<UtilizationView> {
  const license = await License.findOne({ _id: toId(id), isDeleted: false }).exec();
  if (!license) throw notFound('License');

  const activeAssignments = await LicenseAssignment.countDocuments({
    licenseId: license._id,
    status: 'Assigned',
    isDeleted: false,
  }).exec();

  const availableSeats = license.maxSeats - license.usedSeats;
  return {
    licenseCode: license.licenseCode,
    softwareName: license.softwareName,
    status: license.status,
    maxSeats: license.maxSeats,
    usedSeats: license.usedSeats,
    availableSeats,
    utilizationPct:
      license.maxSeats === 0 ? 0 : Math.round((license.usedSeats / license.maxSeats) * 100),
    renewalDate: license.renewalDate ?? null,
    activeAssignments,
  };
}

export interface LicenseAssignmentListResult {
  items: LicenseAssignmentView[];
  meta: { page: number; limit: number; total: number };
}

export async function listLicenseAssignments(
  query: ListLicenseAssignmentsQuery,
  visibleIds?: Set<string>,
): Promise<LicenseAssignmentListResult> {
  const pagination: Pagination = buildPagination({ page: query.page, limit: query.limit });
  const sort = buildSort(query.sort, ['assignedAt', 'createdAt'], { assignedAt: -1 });

  const filter: FilterQuery<LicenseAssignmentDoc> = { isDeleted: false };
  if (visibleIds) {
    filter.employeeId = trustedFilter({ $in: [...visibleIds].map(toId) });
  }
  if (query.licenseId) filter.licenseId = toId(query.licenseId);
  if (query.employeeId) {
    if (visibleIds && !visibleIds.has(query.employeeId)) {
      throw forbidden('You do not have access to this employee');
    }
    filter.employeeId = toId(query.employeeId);
  }
  if (query.status) filter.status = query.status;

  const [rows, total] = await Promise.all([
    LicenseAssignment.find(filter)
      .populate(ASSIGNMENT_POPULATE)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    LicenseAssignment.countDocuments(filter).exec(),
  ]);

  return {
    items: rows.map((row) => toAssignmentView(row as unknown as PopulatedLicenseAssignment)),
    meta: listMeta(pagination, total),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createLicense(body: CreateLicenseBody, ctx: EmployeeContext): Promise<LicenseView> {
  const created = await License.create({
    licenseCode: await nextHumanId('license'),
    softwareName: body.softwareName,
    licenseType: body.licenseType,
    // §11 — encrypted before it ever reaches the database.
    licenseKeyRef: body.licenseKey ? encryptField(body.licenseKey) : null,
    provider: body.provider ?? null,
    cost: body.cost ?? null,
    currency: body.currency ?? null,
    billingCycle: body.billingCycle ?? null,
    startDate: body.startDate ?? null,
    renewalDate: body.renewalDate ?? null,
    maxSeats: body.maxSeats,
    usedSeats: 0,
    status: 'Available',
    createdBy: ctx.account.userId ? toId(ctx.account.userId) : null,
    isDeleted: false,
  });

  // The audit trail records that a key was stored, never the key itself
  // (redactSensitive would strip it anyway — belt and braces).
  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'license.created',
    entityType: 'License',
    entityId: created._id,
    after: {
      licenseCode: created.licenseCode,
      softwareName: body.softwareName,
      maxSeats: body.maxSeats,
      hasKey: !!body.licenseKey,
    },
  });
  await invalidateDashboardCache();

  return getLicenseById(created._id.toString());
}

export async function updateLicense(
  id: string,
  body: UpdateLicenseBody,
  ctx: EmployeeContext,
): Promise<LicenseView> {
  const licenseId = toId(id);
  const existing = await License.findOne({ _id: licenseId, isDeleted: false }).exec();
  if (!existing) throw notFound('License');

  const before = {
    softwareName: existing.softwareName,
    licenseType: existing.licenseType,
    maxSeats: existing.maxSeats,
    renewalDate: existing.renewalDate,
  };

  if (body.softwareName !== undefined) existing.softwareName = body.softwareName;
  if (body.licenseType !== undefined) existing.licenseType = body.licenseType;
  if (body.provider !== undefined) existing.provider = body.provider;
  if (body.cost !== undefined) existing.cost = body.cost;
  if (body.currency !== undefined) existing.currency = body.currency;
  if (body.billingCycle !== undefined) existing.billingCycle = body.billingCycle;
  if (body.startDate !== undefined) {
    if (existing.renewalDate && existing.renewalDate <= body.startDate) {
      throw unprocessable('Renewal date must be after the start date');
    }
    existing.startDate = body.startDate;
  }
  if (body.maxSeats !== undefined) {
    if (body.maxSeats < existing.usedSeats) {
      throw unprocessable(
        `Maximum seats cannot be reduced below the ${existing.usedSeats} seat(s) already in use`,
      );
    }
    existing.maxSeats = body.maxSeats;
    // A capacity increase on a full license reopens it.
    if (existing.status === 'Assigned' && existing.usedSeats < body.maxSeats) {
      existing.status = 'Available';
    }
  }
  if (body.licenseKey !== undefined) {
    // A null key clears the stored secret; a new key replaces it.
    existing.licenseKeyRef = body.licenseKey ? encryptField(body.licenseKey) : null;
  }

  await existing.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'license.updated',
    entityType: 'License',
    entityId: licenseId,
    before,
    after: {
      softwareName: existing.softwareName,
      licenseType: existing.licenseType,
      maxSeats: existing.maxSeats,
      renewalDate: existing.renewalDate,
      keyChanged: body.licenseKey !== undefined,
    },
  });
  await invalidateDashboardCache();

  return getLicenseById(id);
}

/** §14 — deletion with assignment history is prevented; otherwise soft delete. */
export async function deleteLicense(id: string, ctx: EmployeeContext): Promise<void> {
  const licenseId = toId(id);
  const existing = await License.findOne({ _id: licenseId, isDeleted: false }).exec();
  if (!existing) throw notFound('License');

  const historyCount = await LicenseAssignment.countDocuments({ licenseId }).exec();
  if (historyCount > 0) {
    throw conflict(
      `License ${existing.licenseCode} has ${historyCount} assignment record(s) and cannot be deleted.`,
    );
  }

  existing.isDeleted = true;
  await existing.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'license.deleted',
    entityType: 'License',
    entityId: licenseId,
    before: { licenseCode: existing.licenseCode, isDeleted: false },
    after: { isDeleted: true },
  });
  await invalidateDashboardCache();
}

/**
 * §8.9 + §3 — atomic seat assignment. Order inside the transaction:
 *   1. re-read the license and enforce the §8.9 blockers;
 *   2. reject an already-active duplicate (409);
 *   3. claim exactly one seat with an optimistic-concurrency guard
 *      (`usedSeats` must still equal the just-read value): a last-seat race
 *      resolves to one match and the loser gets 409. Equality-only filters
 *      keep P0's `sanitizeFilter` happy — `$expr` is banned outright by it;
 *   4. insert the assignment (the partial unique index backstops duplicates);
 *      on a duplicate-key abort, release the claimed seat before surfacing 409.
 */
export async function assignLicense(
  id: string,
  body: AssignLicenseBody,
  ctx: EmployeeContext,
): Promise<LicenseAssignmentView> {
  const licenseId = toId(id);
  const employeeObjectId = toId(body.employeeId);
  await assertEmployeeAssignable(employeeObjectId, 'license');

  const session = await mongoose.startSession();
  let assignmentId: Types.ObjectId;
  try {
    const outcome = await session.withTransaction(async () => {
      const license = await License.findOne({ _id: licenseId, isDeleted: false }).session(session);
      if (!license) throw notFound('License');
      assertLicenseAssignable(license, todayInTimeZone());

      const duplicate = await LicenseAssignment.findOne({
        licenseId,
        employeeId: employeeObjectId,
        status: 'Assigned',
        isDeleted: false,
      }).session(session);
      if (duplicate) {
        throw conflict(
          `Employee already holds an active assignment for license ${license.licenseCode}`,
        );
      }

      const claimedSeats = license.usedSeats;
      if (claimedSeats >= license.maxSeats) {
        throw conflict(`License ${license.licenseCode} has no seats available`);
      }
      const seatClaim = await License.updateOne(
        { _id: licenseId, isDeleted: false, usedSeats: claimedSeats },
        { $inc: { usedSeats: 1 } },
        { session },
      ).exec();
      if (seatClaim.matchedCount === 0) {
        // Either the pool filled or the row moved under us — either way there
        // is no seat to claim in this attempt.
        throw conflict(`License ${license.licenseCode} has no seats available`);
      }

      try {
        const created = await LicenseAssignment.create(
          [
            {
              licenseId,
              employeeId: employeeObjectId,
              assignedAt: new Date(),
              accountIdentifier: body.accountIdentifier ?? null,
              status: 'Assigned',
              revokedAt: null,
              revokedBy: null,
              revocationNote: null,
              createdBy: ctx.account.userId ? toId(ctx.account.userId) : null,
              isDeleted: false,
            },
          ],
          { session },
        );
        const createdId = created[0]?._id ?? null;
        if (!createdId) throw unprocessable('Assignment could not be completed');

        // The pool just filled: surface it on the license itself (D-30).
        if (claimedSeats + 1 >= license.maxSeats && license.status === 'Available') {
          await License.updateOne(
            { _id: licenseId },
            { $set: { status: 'Assigned' } },
            { session },
          ).exec();
        }
        return { assignmentId: createdId, licenseCode: license.licenseCode };
      } catch (error) {
        if (isDuplicateKey(error)) {
          // A duplicate slipped past the check (concurrent assigns): release
          // the claimed seat so counts stay exact, then report the duplicate.
          await License.findByIdAndUpdate(
            licenseId,
            { $inc: { usedSeats: -1 } },
            { session },
          ).exec();
          throw conflict(
            `Employee already holds an active assignment for license ${license.licenseCode}`,
          );
        }
        throw error;
      }
    });
    if (!outcome) throw unprocessable('Assignment could not be completed');
    assignmentId = outcome.assignmentId;
  } finally {
    await session.endSession();
  }

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'license.assigned',
    entityType: 'LicenseAssignment',
    entityId: assignmentId,
    after: { licenseId: id, employeeId: body.employeeId },
  });
  await invalidateDashboardCache();

  const row = await LicenseAssignment.findById(assignmentId)
    .populate(ASSIGNMENT_POPULATE)
    .lean()
    .exec();
  if (!row) throw notFound('LicenseAssignment');
  return toAssignmentView(row as unknown as PopulatedLicenseAssignment);
}

/**
 * §8.9 — revoke releases the seat. Revoking an already-revoked assignment is
 * a 409 ("duplicate revoke rejected"), not a silent no-op.
 */
export async function revokeLicenseAssignment(
  assignmentIdRaw: string,
  body: RevokeLicenseAssignmentBody,
  ctx: EmployeeContext,
): Promise<LicenseAssignmentView> {
  const assignmentObjectId = toId(assignmentIdRaw);

  const session = await mongoose.startSession();
  let outcome: { assignmentId: Types.ObjectId; licenseId: string; licenseCode: string; employeeId: string };
  try {
    outcome = await session.withTransaction(async () => {
      const assignment = await LicenseAssignment.findOne({
        _id: assignmentObjectId,
        isDeleted: false,
      }).session(session);
      if (!assignment) throw notFound('LicenseAssignment');
      if (assignment.status === 'Revoked') {
        throw conflict('This license assignment has already been revoked');
      }

      assignment.status = 'Revoked';
      assignment.revokedAt = new Date();
      assignment.revokedBy = ctx.account.userId ? toId(ctx.account.userId) : null;
      assignment.revocationNote = body.revocationNote ?? null;
      await assignment.save({ session });

      const license = await License.findById(assignment.licenseId).session(session);
      if (license && !license.isDeleted) {
        license.usedSeats = Math.max(0, license.usedSeats - 1);
        // A freed seat reopens a full license (D-30).
        if (license.status === 'Assigned' && license.usedSeats < license.maxSeats) {
          license.status = 'Available';
        }
        await license.save({ session });
      }

      return {
        assignmentId: assignment._id,
        licenseId: assignment.licenseId.toString(),
        licenseCode: license?.licenseCode ?? '',
        employeeId: assignment.employeeId.toString(),
      };
    });
    if (!outcome) throw unprocessable('Revoke could not be completed');
  } finally {
    await session.endSession();
  }

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'license.revoked',
    entityType: 'LicenseAssignment',
    entityId: outcome.assignmentId,
    after: { licenseId: outcome.licenseId },
  });
  await invalidateDashboardCache();

  await emitLicenseRevoked({
    licenseId: outcome.licenseId,
    licenseCode: outcome.licenseCode,
    employeeId: outcome.employeeId,
    assignmentId: outcome.assignmentId.toString(),
    actorId: ctx.account.userId,
  });

  const row = await LicenseAssignment.findById(outcome.assignmentId)
    .populate(ASSIGNMENT_POPULATE)
    .lean()
    .exec();
  if (!row) throw notFound('LicenseAssignment');
  return toAssignmentView(row as unknown as PopulatedLicenseAssignment);
}

/** §8.9 renew (D-30): new future date; an Expired license becomes Available. */
export async function renewLicense(
  id: string,
  body: RenewLicenseBody,
  ctx: EmployeeContext,
): Promise<LicenseView> {
  const licenseId = toId(id);
  const existing = await License.findOne({ _id: licenseId, isDeleted: false }).exec();
  if (!existing) throw notFound('License');

  validateRenewalDate(existing.startDate, body.renewalDate);

  const before = { renewalDate: existing.renewalDate, status: existing.status };
  existing.renewalDate = body.renewalDate;
  if (existing.status === 'Expired') existing.status = 'Available';
  await existing.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'license.renewed',
    entityType: 'License',
    entityId: licenseId,
    before,
    after: { renewalDate: existing.renewalDate, status: existing.status },
  });
  await invalidateDashboardCache();

  return getLicenseById(id);
}

/** §8.9 suspend: explicit boolean because there is no separate unsuspend op. */
export async function suspendLicense(
  id: string,
  body: SuspendLicenseBody,
  ctx: EmployeeContext,
): Promise<LicenseView> {
  const licenseId = toId(id);
  const existing = await License.findOne({ _id: licenseId, isDeleted: false }).exec();
  if (!existing) throw notFound('License');

  const target: LicenseStatus = body.suspend ? 'Suspended' : 'Available';
  if (existing.status === 'Revoked' && !body.suspend) {
    throw unprocessable(`License ${existing.licenseCode} is Revoked and cannot be reactivated`);
  }

  if (existing.status !== target) {
    const before = existing.status;
    existing.status = target;
    await existing.save();

    await recordAudit({
      ...ctx,
      actorId: ctx.account.userId,
      action: body.suspend ? 'license.suspended' : 'license.reactivated',
      entityType: 'License',
      entityId: licenseId,
      before: { status: before },
      after: { status: target },
    });
    await invalidateDashboardCache();
  }

  return getLicenseById(id);
}

/** Mark a license Expired (idempotent). Assignment blocking also honours past renewal dates. */
export async function expireLicense(id: string, ctx: EmployeeContext): Promise<LicenseView> {
  const licenseId = toId(id);
  const existing = await License.findOne({ _id: licenseId, isDeleted: false }).exec();
  if (!existing) throw notFound('License');

  if (existing.status !== 'Expired') {
    const before = existing.status;
    existing.status = 'Expired';
    await existing.save();

    await recordAudit({
      ...ctx,
      actorId: ctx.account.userId,
      action: 'license.expired',
      entityType: 'License',
      entityId: licenseId,
      before: { status: before },
      after: { status: 'Expired' },
    });
    await invalidateDashboardCache();
  }

  return getLicenseById(id);
}

/**
 * Revoke the license itself (idempotent): no new assignments may be made, but
 * existing assignment rows are preserved as history (D-31 — nothing cascades).
 * Distinct from assignment revoke, which releases a seat back into the pool.
 */
export async function revokeLicense(id: string, ctx: EmployeeContext): Promise<LicenseView> {
  const licenseId = toId(id);
  const existing = await License.findOne({ _id: licenseId, isDeleted: false }).exec();
  if (!existing) throw notFound('License');

  if (existing.status !== 'Revoked') {
    const before = existing.status;
    existing.status = 'Revoked';
    await existing.save();

    await recordAudit({
      ...ctx,
      actorId: ctx.account.userId,
      action: 'license.revoked',
      entityType: 'License',
      entityId: licenseId,
      before: { status: before },
      after: { status: 'Revoked' },
    });
    await invalidateDashboardCache();
  }

  return getLicenseById(id);
}

/**
 * §14 — "reveal key HR Admin only and audited". The plaintext key is returned
 * here and nowhere else; the audit entry records the reveal, never the key.
 */
export async function revealLicenseKey(
  id: string,
  ctx: EmployeeContext,
): Promise<{ licenseCode: string; licenseKey: string }> {
  if (ctx.account.role !== 'HR Admin') {
    throw forbidden('Only an HR Admin may reveal a license key');
  }

  const doc = await License.findOne({ _id: toId(id), isDeleted: false })
    .select('+licenseKeyRef')
    .lean()
    .exec();
  if (!doc) throw notFound('License');
  if (!doc.licenseKeyRef) throw notFound('License key');

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'license.key_revealed',
    entityType: 'License',
    entityId: doc._id,
    after: { licenseCode: doc.licenseCode },
  });

  return { licenseCode: doc.licenseCode, licenseKey: decryptField(doc.licenseKeyRef) };
}
