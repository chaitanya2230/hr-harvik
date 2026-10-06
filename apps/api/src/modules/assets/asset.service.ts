import mongoose, { Types } from 'mongoose';
import type { FilterQuery } from 'mongoose';
import type { AssetStatus } from '../../config/constants';
import { Asset, AssetAssignment } from './asset.model';
import type { AssetAssignmentDoc, AssetDoc } from './asset.schema';
import {
  assertEmployeeAssignable,
  scopeIdsFor,
  type EmployeeContext,
} from '../employees/employee.service';
import { recordAudit } from '../audit/audit.service';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { buildPagination, buildSort, listMeta, type Pagination } from '../../utils/http';
import { conflict, forbidden, notFound, unprocessable } from '../../utils/errors';
import { todayInTimeZone } from '../../utils/dates';
import { trustedFilter } from '../../utils/mongo';
import { nextHumanId } from '../../utils/ids';
import {
  ASSET_SORT_FIELDS,
  ASSIGNMENT_SORT_FIELDS,
  type AssignAssetBody,
  type CreateAssetBody,
  type ListAssetAssignmentsQuery,
  type ListAssetsQuery,
  type RepairAssetBody,
  type RetireAssetBody,
  type ReturnAssetBody,
  type UpdateAssetBody,
} from './asset.validation';

/**
 * AGENTS.md §8.8 — Assets service.
 *
 * Assignment and return run inside multi-document transactions (§3, §11):
 * the asset status flip, the assignment row and the back-pointer move
 * together, so a crash can never leave "Assigned with no assignment" or two
 * active assignments for one asset.
 */

const toId = (value: string): Types.ObjectId => new Types.ObjectId(value);

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface AssetView {
  id: string;
  assetCode: string;
  name: string;
  type: string;
  brand: string | null;
  model: string | null;
  serialNumber: string;
  purchaseDate: string | null;
  purchaseCost: number | null;
  condition: string | null;
  status: AssetStatus;
  currentAssignmentId: string | null;
  notes: string | null;
  activeAssignment: {
    id: string;
    employee: { id: string; employeeCode: string; fullName: string };
    assignedAt: string;
    expectedReturnDate: string | null;
    overdue: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetAssignmentView {
  id: string;
  asset: { id: string; assetCode: string; name: string; type: string } | null;
  employee: { id: string; employeeCode: string; fullName: string } | null;
  assignedAt: string;
  expectedReturnDate: string | null;
  actualReturnDate: string | null;
  overdue: boolean;
  conditionAtAssign: string | null;
  conditionAtReturn: string | null;
  notes: string | null;
}

/** Overdue = a return was expected before today and never happened. */
export function isOverdue(
  expectedReturnDate: string | null | undefined,
  actualReturnDate: string | null | undefined,
  today: string,
): boolean {
  return !actualReturnDate && !!expectedReturnDate && expectedReturnDate < today;
}

type PopulatedAsset = AssetDoc & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type PopulatedAssignment = AssetAssignmentDoc & {
  _id: Types.ObjectId;
  assetId: { _id: Types.ObjectId; assetCode: string; name: string; type: string } | null;
  employeeId: { _id: Types.ObjectId; employeeCode: string; firstName: string; lastName: string } | null;
};

function toAssignmentView(doc: PopulatedAssignment, today: string): AssetAssignmentView {
  return {
    id: doc._id.toString(),
    asset: doc.assetId
      ? {
          id: doc.assetId._id.toString(),
          assetCode: doc.assetId.assetCode,
          name: doc.assetId.name,
          type: doc.assetId.type,
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
    expectedReturnDate: doc.expectedReturnDate ?? null,
    actualReturnDate: doc.actualReturnDate ?? null,
    overdue: isOverdue(doc.expectedReturnDate, doc.actualReturnDate, today),
    conditionAtAssign: doc.conditionAtAssign ?? null,
    conditionAtReturn: doc.conditionAtReturn ?? null,
    notes: doc.notes ?? null,
  };
}

const ASSIGNMENT_POPULATE = [
  { path: 'assetId', select: 'assetCode name type' },
  { path: 'employeeId', select: 'employeeCode firstName lastName' },
];

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

// ---------------------------------------------------------------------------
// Events for P3 (D-31): return is observable without the exit module existing.
// ---------------------------------------------------------------------------

export interface AssetReturnedEvent {
  assetId: string;
  assetCode: string;
  employeeId: string;
  assignmentId: string;
  actualReturnDate: string;
  actorId: string;
}

type AssetReturnedListener = (event: AssetReturnedEvent) => Promise<void> | void;
const assetReturnedListeners: AssetReturnedListener[] = [];

export function onAssetReturned(listener: AssetReturnedListener): () => void {
  assetReturnedListeners.push(listener);
  return () => {
    const index = assetReturnedListeners.indexOf(listener);
    if (index >= 0) assetReturnedListeners.splice(index, 1);
  };
}

export interface AssetAssignedEvent {
  assetId: string;
  assetCode: string;
  assetName: string;
  employeeId: string;
  assignmentId: string;
  actorId: string;
}

type AssetAssignedListener = (event: AssetAssignedEvent) => Promise<void> | void;
const assetAssignedListeners: AssetAssignedListener[] = [];

export function onAssetAssigned(listener: AssetAssignedListener): () => void {
  assetAssignedListeners.push(listener);
  return () => {
    const index = assetAssignedListeners.indexOf(listener);
    if (index >= 0) assetAssignedListeners.splice(index, 1);
  };
}

async function emitAssetAssigned(event: AssetAssignedEvent): Promise<void> {
  for (const listener of assetAssignedListeners) {
    try {
      await listener(event);
    } catch {
      // Non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface AssetListResult {
  items: AssetView[];
  meta: { page: number; limit: number; total: number };
}

export async function listAssets(query: ListAssetsQuery): Promise<AssetListResult> {
  const pagination: Pagination = buildPagination({ page: query.page, limit: query.limit });
  const sort = buildSort(query.sort, ASSET_SORT_FIELDS, { createdAt: -1 });
  const today = todayInTimeZone();

  const filter: FilterQuery<AssetDoc> = { isDeleted: false };
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: rx }, { assetCode: rx }, { serialNumber: rx }, { brand: rx }, { model: rx }];
  }

  // §8.8 — overdue assets are filterable: assets holding an active assignment
  // whose expected return date has passed.
  if (query.overdue !== undefined) {
    const overdueIds = await AssetAssignment.distinct('assetId', {
      actualReturnDate: null,
      expectedReturnDate: trustedFilter({ $lt: today }),
    }).exec();
    const idSet = new Set(overdueIds.map(String));
    filter._id = query.overdue
      ? trustedFilter({ $in: [...idSet].map(toId) })
      : trustedFilter({ $nin: [...idSet].map(toId) });
  }

  const [docs, total] = await Promise.all([
    Asset.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit).exec(),
    Asset.countDocuments(filter).exec(),
  ]);

  const activeByAsset = await activeAssignmentsFor(docs.map((doc) => doc._id), today);

  return {
    items: docs.map((doc) => toAssetView(doc as unknown as PopulatedAsset, activeByAsset)),
    meta: listMeta(pagination, total),
  };
}

async function activeAssignmentsFor(
  assetIds: Types.ObjectId[],
  today: string,
): Promise<Map<string, AssetAssignmentView>> {
  if (assetIds.length === 0) return new Map();
  const rows = (await AssetAssignment.find({
    assetId: trustedFilter({ $in: assetIds }),
    actualReturnDate: null,
    isDeleted: false,
  })
    .populate(ASSIGNMENT_POPULATE)
    .lean()
    .exec()) as unknown as PopulatedAssignment[];

  return new Map(
    rows.map((row) => {
      const rawAsset = row.assetId as unknown;
      const key =
        rawAsset && typeof rawAsset === 'object' && '_id' in rawAsset
          ? String((rawAsset as { _id: unknown })._id)
          : String(rawAsset);
      return [key, toAssignmentView(row, today)] as const;
    }),
  );
}

function toAssetView(
  doc: PopulatedAsset,
  activeByAsset: Map<string, AssetAssignmentView>,
): AssetView {
  const active = activeByAsset.get(doc._id.toString()) ?? null;
  return {
    id: doc._id.toString(),
    assetCode: doc.assetCode,
    name: doc.name,
    type: doc.type,
    brand: doc.brand ?? null,
    model: doc.model ?? null,
    serialNumber: doc.serialNumber,
    purchaseDate: doc.purchaseDate ?? null,
    purchaseCost: doc.purchaseCost ?? null,
    condition: doc.condition ?? null,
    status: doc.status,
    currentAssignmentId: doc.currentAssignmentId ? doc.currentAssignmentId.toString() : null,
    notes: doc.notes ?? null,
    activeAssignment: active
      ? {
          id: active.id,
          employee: active.employee ?? { id: '', employeeCode: '', fullName: '' },
          assignedAt: active.assignedAt,
          expectedReturnDate: active.expectedReturnDate,
          overdue: active.overdue,
        }
      : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function getAssetById(id: string): Promise<AssetView> {
  const today = todayInTimeZone();
  const doc = await Asset.findOne({ _id: toId(id), isDeleted: false }).exec();
  if (!doc) throw notFound('Asset');

  const activeByAsset = await activeAssignmentsFor([doc._id], today);
  return toAssetView(doc as unknown as PopulatedAsset, activeByAsset);
}

/** Assignment history for one asset, newest first. */
export async function getAssetHistory(id: string): Promise<AssetAssignmentView[]> {
  const today = todayInTimeZone();
  const rows = await AssetAssignment.find({ assetId: toId(id), isDeleted: false })
    .populate(ASSIGNMENT_POPULATE)
    .sort({ assignedAt: -1 })
    .exec();
  return rows.map((row) => toAssignmentView(row as unknown as PopulatedAssignment, today));
}

export interface AssignmentListResult {
  items: AssetAssignmentView[];
  meta: { page: number; limit: number; total: number };
}

export async function listAssetAssignments(
  query: ListAssetAssignmentsQuery,
  visibleIds?: Set<string>,
): Promise<AssignmentListResult> {
  const pagination: Pagination = buildPagination({ page: query.page, limit: query.limit });
  const sort = buildSort(query.sort, ASSIGNMENT_SORT_FIELDS, { assignedAt: -1 });
  const today = todayInTimeZone();

  const filter: FilterQuery<AssetAssignmentDoc> = { isDeleted: false };
  if (visibleIds) {
    filter.employeeId = trustedFilter({ $in: [...visibleIds].map(toId) });
  }
  if (query.assetId) filter.assetId = toId(query.assetId);
  if (query.employeeId) {
    if (visibleIds && !visibleIds.has(query.employeeId)) {
      throw forbidden('You do not have access to this employee');
    }
    filter.employeeId = toId(query.employeeId);
  }
  if (query.active !== undefined) {
    filter.actualReturnDate = query.active ? null : trustedFilter({ $ne: null });
  }
  if (query.overdue !== undefined) {
    filter.$and = [
      { actualReturnDate: null },
      query.overdue
        ? { expectedReturnDate: trustedFilter({ $lt: today }) }
        : {
            $or: [
              { expectedReturnDate: null },
              { expectedReturnDate: trustedFilter({ $gte: today }) },
            ],
          },
    ];
  }

  const [rows, total] = await Promise.all([
    AssetAssignment.find(filter)
      .populate(ASSIGNMENT_POPULATE)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    AssetAssignment.countDocuments(filter).exec(),
  ]);

  return {
    items: rows.map((row) => toAssignmentView(row as unknown as PopulatedAssignment, today)),
    meta: listMeta(pagination, total),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function assertSerialAvailable(serialNumber: string, excludeId?: Types.ObjectId): Promise<void> {
  const filter: FilterQuery<AssetDoc> = { serialNumber };
  if (excludeId) filter._id = trustedFilter({ $ne: excludeId });
  if (await Asset.exists(filter)) {
    throw conflict(`An asset with serial number "${serialNumber}" already exists`);
  }
}

export async function createAsset(body: CreateAssetBody, ctx: EmployeeContext): Promise<AssetView> {
  await assertSerialAvailable(body.serialNumber);

  const created = await Asset.create({
    assetCode: await nextHumanId('asset'),
    name: body.name,
    type: body.type,
    brand: body.brand ?? null,
    model: body.model ?? null,
    serialNumber: body.serialNumber,
    purchaseDate: body.purchaseDate ?? null,
    purchaseCost: body.purchaseCost ?? null,
    condition: body.condition ?? null,
    status: 'Available',
    currentAssignmentId: null,
    notes: body.notes ?? null,
    createdBy: ctx.account.userId ? toId(ctx.account.userId) : null,
    isDeleted: false,
  });

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'asset.created',
    entityType: 'Asset',
    entityId: created._id,
    after: { assetCode: created.assetCode, name: body.name, type: body.type },
  });
  await invalidateDashboardCache();

  return getAssetById(created._id.toString());
}

export async function updateAsset(
  id: string,
  body: UpdateAssetBody,
  ctx: EmployeeContext,
): Promise<AssetView> {
  const assetId = toId(id);
  const existing = await Asset.findOne({ _id: assetId, isDeleted: false }).exec();
  if (!existing) throw notFound('Asset');

  const before = {
    name: existing.name,
    type: existing.type,
    serialNumber: existing.serialNumber,
    purchaseCost: existing.purchaseCost,
    condition: existing.condition,
  };

  if (body.serialNumber !== undefined && body.serialNumber !== existing.serialNumber) {
    await assertSerialAvailable(body.serialNumber, assetId);
    existing.serialNumber = body.serialNumber;
  }
  if (body.name !== undefined) existing.name = body.name;
  if (body.type !== undefined) existing.type = body.type;
  if (body.brand !== undefined) existing.brand = body.brand;
  // `model` collides with Mongoose's `Document.model` accessor on hydrated
  // documents, so the schema field is written via `.set()` (reads use lean
  // objects, where no collision exists).
  if (body.model !== undefined) existing.set('model', body.model);
  if (body.purchaseDate !== undefined) existing.purchaseDate = body.purchaseDate;
  if (body.purchaseCost !== undefined) existing.purchaseCost = body.purchaseCost;
  if (body.condition !== undefined) existing.condition = body.condition;
  if (body.notes !== undefined) existing.notes = body.notes;

  await existing.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'asset.updated',
    entityType: 'Asset',
    entityId: assetId,
    before,
    after: {
      name: existing.name,
      type: existing.type,
      serialNumber: existing.serialNumber,
      purchaseCost: existing.purchaseCost,
      condition: existing.condition,
    },
  });
  await invalidateDashboardCache();

  return getAssetById(id);
}

/** §14 — deletion with history is prevented; otherwise a soft delete. */
export async function deleteAsset(id: string, ctx: EmployeeContext): Promise<void> {
  const assetId = toId(id);
  const existing = await Asset.findOne({ _id: assetId, isDeleted: false }).exec();
  if (!existing) throw notFound('Asset');

  const historyCount = await AssetAssignment.countDocuments({ assetId }).exec();
  if (historyCount > 0) {
    throw conflict(
      `Asset ${existing.assetCode} has ${historyCount} assignment record(s) and cannot be deleted. Retire it instead.`,
    );
  }

  existing.isDeleted = true;
  await existing.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'asset.deleted',
    entityType: 'Asset',
    entityId: assetId,
    before: { assetCode: existing.assetCode, isDeleted: false },
    after: { isDeleted: true },
  });
  await invalidateDashboardCache();
}

/**
 * §8.8 + §3 — assignment is a transaction: the status flip, the assignment
 * row and the back-pointer commit together. The partial unique index plus the
 * atomic Available→Assigned flip make concurrent assigns resolve to exactly
 * one winner: losers abort on the unique key and surface as 409.
 */
export async function assignAsset(
  id: string,
  body: AssignAssetBody,
  ctx: EmployeeContext,
): Promise<AssetAssignmentView> {
  const assetId = toId(id);
  const employeeObjectId = toId(body.employeeId);
  await assertEmployeeAssignable(employeeObjectId, 'asset');

  const session = await mongoose.startSession();
  let assignmentId: Types.ObjectId;
  try {
    const outcome = await session.withTransaction(async () => {
      const asset = await Asset.findOne({ _id: assetId, isDeleted: false }).session(session);
      if (!asset) throw notFound('Asset');
      if (asset.status !== 'Available') {
        throw unprocessable(
          `Asset ${asset.assetCode} cannot be assigned while its status is "${asset.status}"`,
        );
      }

      // Atomic flip first: a concurrent transaction flipping the same document
      // conflicts here, so only one assign can proceed.
      asset.status = 'Assigned';
      await asset.save({ session });

      try {
        const created = await AssetAssignment.create(
          [
            {
              assetId,
              employeeId: employeeObjectId,
              assignedAt: new Date(),
              expectedReturnDate: body.expectedReturnDate ?? null,
              actualReturnDate: null,
              conditionAtAssign: body.conditionAtAssign ?? null,
              assignedBy: ctx.account.userId ? toId(ctx.account.userId) : null,
              returnedTo: null,
              notes: body.notes ?? null,
              createdBy: ctx.account.userId ? toId(ctx.account.userId) : null,
              isDeleted: false,
            },
          ],
          { session },
        );
        const createdId = created[0]?._id ?? null;
        if (!createdId) throw unprocessable('Assignment could not be completed');
        asset.currentAssignmentId = createdId;
        await asset.save({ session });
        return { assignmentId: createdId, assetCode: asset.assetCode, assetName: asset.name };
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw conflict(`Asset is already assigned (concurrent assignment detected)`);
        }
        throw error;
      }
    });
    if (!outcome) throw unprocessable('Assignment could not be completed');
    assignmentId = outcome.assignmentId;

    await recordAudit({
      ...ctx,
      actorId: ctx.account.userId,
      action: 'asset.assigned',
      entityType: 'AssetAssignment',
      entityId: assignmentId,
      after: { assetId: id, employeeId: body.employeeId },
    });
    await invalidateDashboardCache();

    await emitAssetAssigned({
      assetId: id,
      assetCode: outcome.assetCode,
      assetName: outcome.assetName,
      employeeId: body.employeeId,
      assignmentId: assignmentId.toString(),
      actorId: ctx.account.userId,
    });
  } finally {
    await session.endSession();
  }

  const row = await AssetAssignment.findById(assignmentId)
    .populate(ASSIGNMENT_POPULATE)
    .lean()
    .exec();
  if (!row) throw notFound('AssetAssignment');
  return toAssignmentView(row as unknown as PopulatedAssignment, todayInTimeZone());
}

/**
 * §8.8 + D-29 — return closes the assignment and rests the asset at
 * `Returned`; a repair walk returns it to `Available`.
 */
export async function returnAsset(
  id: string,
  body: ReturnAssetBody,
  ctx: EmployeeContext,
): Promise<AssetAssignmentView> {
  const assetId = toId(id);
  const today = todayInTimeZone();

  const session = await mongoose.startSession();
  let outcome: { assignmentId: Types.ObjectId; employeeId: string };
  try {
    // The transaction callback *returns* the outcome: withTransaction resolves
    // with the callback's return value, which keeps the type outside the
    // closure (TS does not narrow outer `let`s assigned inside callbacks).
    outcome = await session.withTransaction(async () => {
      const asset = await Asset.findOne({ _id: assetId, isDeleted: false }).session(session);
      if (!asset) throw notFound('Asset');
      if (asset.status !== 'Assigned') {
        throw unprocessable(
          `Asset ${asset.assetCode} cannot be returned while its status is "${asset.status}"`,
        );
      }

      const active = await AssetAssignment.findOne({
        assetId,
        actualReturnDate: null,
        isDeleted: false,
      }).session(session);
      if (!active) {
        throw unprocessable(`Asset ${asset.assetCode} has no active assignment to return`);
      }

      active.actualReturnDate = today;
      active.conditionAtReturn = body.conditionAtReturn ?? null;
      if (body.notes) active.notes = body.notes;
      active.returnedTo = ctx.account.userId ? toId(ctx.account.userId) : null;
      await active.save({ session });

      asset.status = 'Returned';
      asset.currentAssignmentId = null;
      await asset.save({ session });

      return { assignmentId: active._id, employeeId: active.employeeId.toString() };
    });
  } finally {
    await session.endSession();
  }

  const { assignmentId, employeeId } = outcome;

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'asset.returned',
    entityType: 'AssetAssignment',
    entityId: assignmentId,
    after: { assetId: id, actualReturnDate: today },
  });
  await invalidateDashboardCache();

  const asset = await Asset.findById(assetId).lean().exec();
  for (const listener of assetReturnedListeners) {
    try {
      await listener({
        assetId: id,
        assetCode: asset?.assetCode ?? '',
        employeeId,
        assignmentId: assignmentId.toString(),
        actualReturnDate: today,
        actorId: ctx.account.userId,
      });
    } catch {
      // Subscriber failures never roll back a valid return.
    }
  }

  const row = await AssetAssignment.findById(assignmentId)
    .populate(ASSIGNMENT_POPULATE)
    .lean()
    .exec();
  if (!row) throw notFound('AssetAssignment');
  return toAssignmentView(row as unknown as PopulatedAssignment, today);
}

/**
 * §8.8 repair (D-29): walks Available ↔ Under Repair, records Lost / Damaged,
 * or returns a Returned asset to Available. Requires no active assignment —
 * an assigned asset's status is owned by the assignment — and never touches
 * Retired, which is terminal.
 */
const REPAIRABLE_FROM: Record<string, readonly AssetStatus[]> = {
  Available: ['Available', 'Under Repair', 'Lost', 'Damaged'],
  Returned: ['Available', 'Under Repair', 'Lost', 'Damaged'],
  'Under Repair': ['Available', 'Lost', 'Damaged'],
  Lost: ['Available', 'Under Repair', 'Damaged'],
  Damaged: ['Available', 'Under Repair', 'Lost'],
};

export async function repairAsset(
  id: string,
  body: RepairAssetBody,
  ctx: EmployeeContext,
): Promise<AssetView> {
  const assetId = toId(id);
  const existing = await Asset.findOne({ _id: assetId, isDeleted: false }).exec();
  if (!existing) throw notFound('Asset');

  if (existing.status === 'Retired') {
    throw unprocessable(`Asset ${existing.assetCode} is Retired, which is terminal`);
  }
  if (existing.status === 'Assigned') {
    throw unprocessable(
      `Asset ${existing.assetCode} is currently assigned; return it before changing its condition status`,
    );
  }

  const allowed = REPAIRABLE_FROM[existing.status] ?? [];
  if (!allowed.includes(body.status)) {
    throw unprocessable(
      `Cannot move asset ${existing.assetCode} from "${existing.status}" to "${body.status}"`,
    );
  }

  const before = existing.status;
  existing.status = body.status;
  if (body.notes) existing.notes = body.notes;
  await existing.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'asset.repair',
    entityType: 'Asset',
    entityId: assetId,
    before: { status: before },
    after: { status: body.status },
  });
  await invalidateDashboardCache();

  return getAssetById(id);
}

/** §8.8 retire: terminal, requires no active assignment. */
export async function retireAsset(
  id: string,
  body: RetireAssetBody,
  ctx: EmployeeContext,
): Promise<AssetView> {
  const assetId = toId(id);
  const existing = await Asset.findOne({ _id: assetId, isDeleted: false }).exec();
  if (!existing) throw notFound('Asset');

  if (existing.status === 'Retired') {
    throw unprocessable(`Asset ${existing.assetCode} is already Retired`);
  }
  if (existing.status === 'Assigned') {
    throw unprocessable(
      `Asset ${existing.assetCode} is currently assigned; return it before retiring`,
    );
  }

  const before = existing.status;
  existing.status = 'Retired';
  if (body.reason) {
    existing.notes = [existing.notes, `Retired: ${body.reason}`].filter(Boolean).join(' | ');
  }
  await existing.save();

  await recordAudit({
    ...ctx,
    actorId: ctx.account.userId,
    action: 'asset.retired',
    entityType: 'Asset',
    entityId: assetId,
    before: { status: before },
    after: { status: 'Retired' },
  });
  await invalidateDashboardCache();

  return getAssetById(id);
}

// Re-exported for tests and the dashboard so scope has one implementation.
export { scopeIdsFor };
