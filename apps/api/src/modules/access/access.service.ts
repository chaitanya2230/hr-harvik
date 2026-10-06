import { Types } from 'mongoose';
import type { FilterQuery } from 'mongoose';
import { AccessItem } from './access.model';
import type { AccessItemDoc } from './access.schema';
import {
  assertEmployeeAssignable,
  type EmployeeContext,
} from '../employees/employee.service';
import { LicenseAssignment } from '../licenses/license.model';
import { recordAudit } from '../audit/audit.service';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { buildPagination, buildSort, listMeta, type Pagination } from '../../utils/http';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { trustedFilter } from '../../utils/mongo';
import {
  ACCESS_SORT_FIELDS,
  type CreateAccessItemBody,
  type ListAccessItemsQuery,
} from './access.validation';

/**
 * AGENTS.md §7 — Access Items service.
 *
 * External accounts beyond licenses. Manual records only (§2 rule 11, D-31):
 * nothing here calls an external API and nothing cascades automatically.
 */

const toId = (value: string): Types.ObjectId => new Types.ObjectId(value);

export interface AccessItemView {
  id: string;
  employee: { id: string; employeeCode: string; fullName: string } | null;
  system: string;
  identifier: string | null;
  status: 'Active' | 'Revoked';
  revokedAt: string | null;
  linkedLicenseAssignmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

type PopulatedAccessItem = AccessItemDoc & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  employeeId: { _id: Types.ObjectId; employeeCode: string; firstName: string; lastName: string } | null;
};

function toView(doc: PopulatedAccessItem): AccessItemView {
  return {
    id: doc._id.toString(),
    employee: doc.employeeId
      ? {
          id: doc.employeeId._id.toString(),
          employeeCode: doc.employeeId.employeeCode,
          fullName: `${doc.employeeId.firstName} ${doc.employeeId.lastName}`.trim(),
        }
      : null,
    system: doc.system,
    identifier: doc.identifier ?? null,
    status: doc.status,
    revokedAt: doc.revokedAt ? doc.revokedAt.toISOString() : null,
    linkedLicenseAssignmentId: doc.linkedLicenseAssignmentId
      ? doc.linkedLicenseAssignmentId.toString()
      : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

const POPULATE = [{ path: 'employeeId', select: 'employeeCode firstName lastName' }];

// ---------------------------------------------------------------------------
// Events for P3 (D-31).
// ---------------------------------------------------------------------------

export interface AccessRevokedEvent {
  accessId: string;
  employeeId: string;
  system: string;
  actorId: string;
}

type AccessRevokedListener = (event: AccessRevokedEvent) => Promise<void> | void;
const accessRevokedListeners: AccessRevokedListener[] = [];

export function onAccessRevoked(listener: AccessRevokedListener): () => void {
  accessRevokedListeners.push(listener);
  return () => {
    const index = accessRevokedListeners.indexOf(listener);
    if (index >= 0) accessRevokedListeners.splice(index, 1);
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface AccessListResult {
  items: AccessItemView[];
  meta: { page: number; limit: number; total: number };
}

export async function listAccessItems(
  query: ListAccessItemsQuery,
  visibleIds?: Set<string>,
): Promise<AccessListResult> {
  const pagination: Pagination = buildPagination({ page: query.page, limit: query.limit });
  const sort = buildSort(query.sort, ACCESS_SORT_FIELDS, { createdAt: -1 });

  const filter: FilterQuery<AccessItemDoc> = { isDeleted: false };
  if (visibleIds) {
    filter.employeeId = trustedFilter({ $in: [...visibleIds].map(toId) });
  }
  if (query.employeeId) {
    if (visibleIds && !visibleIds.has(query.employeeId)) {
      throw forbidden('You do not have access to this employee');
    }
    filter.employeeId = toId(query.employeeId);
  }
  if (query.system) filter.system = query.system;
  if (query.status) filter.status = query.status;

  const [rows, total] = await Promise.all([
    AccessItem.find(filter).populate(POPULATE).sort(sort).skip(pagination.skip).limit(pagination.limit).exec(),
    AccessItem.countDocuments(filter).exec(),
  ]);

  return {
    items: rows.map((row) => toView(row as unknown as PopulatedAccessItem)),
    meta: listMeta(pagination, total),
  };
}

export async function getAccessItemById(id: string): Promise<AccessItemView> {
  const doc = await AccessItem.findOne({ _id: toId(id), isDeleted: false })
    .populate(POPULATE)
    .exec();
  if (!doc) throw notFound('Access item');
  return toView(doc as unknown as PopulatedAccessItem);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createAccessItem(
  body: CreateAccessItemBody,
  ctx: EmployeeContext,
): Promise<AccessItemView> {
  const employeeObjectId = toId(body.employeeId);
  await assertEmployeeAssignable(employeeObjectId, 'access item');

  if (body.linkedLicenseAssignmentId) {
    const linked = await LicenseAssignment.exists({
      _id: toId(body.linkedLicenseAssignmentId),
      isDeleted: false,
    });
    if (!linked) throw conflict('The linked license assignment does not exist');
  }

  const created = await AccessItem.create({
    employeeId: employeeObjectId,
    system: body.system,
    identifier: body.identifier ?? null,
    status: 'Active',
    revokedAt: null,
    revokedBy: null,
    linkedLicenseAssignmentId: body.linkedLicenseAssignmentId
      ? toId(body.linkedLicenseAssignmentId)
      : null,
    createdBy: ctx.account.userId ? toId(ctx.account.userId) : null,
    isDeleted: false,
  });

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'access.created',
    entityType: 'AccessItem',
    entityId: created._id,
    after: { employeeId: body.employeeId, system: body.system },
  });
  await invalidateDashboardCache();

  return getAccessItemById(created._id.toString());
}

export async function revokeAccessItem(id: string, ctx: EmployeeContext): Promise<AccessItemView> {
  const itemId = toId(id);
  const existing = await AccessItem.findOne({ _id: itemId, isDeleted: false }).exec();
  if (!existing) throw notFound('Access item');
  if (existing.status === 'Revoked') {
    throw conflict('This access item has already been revoked');
  }

  existing.status = 'Revoked';
  existing.revokedAt = new Date();
  existing.revokedBy = ctx.account.userId ? toId(ctx.account.userId) : null;
  await existing.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'access.revoked',
    entityType: 'AccessItem',
    entityId: itemId,
    before: { status: 'Active' },
    after: { status: 'Revoked' },
  });
  await invalidateDashboardCache();

  for (const listener of accessRevokedListeners) {
    try {
      await listener({
        accessId: id,
        employeeId: existing.employeeId.toString(),
        system: existing.system,
        actorId: ctx.account.userId,
      });
    } catch {
      // Subscriber failures never roll back a valid revoke.
    }
  }

  return getAccessItemById(id);
}
