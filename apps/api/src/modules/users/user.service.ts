import { Types } from 'mongoose';
import { User } from './user.model';
import type { UserDoc } from './user.schema';
import { Employee } from '../employees/employee.model';
import { hashPassword } from '../auth/auth.service';
import type { Role } from '../../config/constants';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../utils/errors';
import { buildPagination, buildSort, listMeta, type ListMeta } from '../../utils/http';
import { trustedFilter } from '../../utils/mongo';

/**
 * AGENTS.md §6 — HR Admin "manage users / manage roles".
 *
 * The users module was previously schema-only; this service exposes the
 * lifecycle: list, read, create a login, change role / activation, and
 * reset a password. Password material never leaves this module.
 */

export interface UserEmployeeRef {
  id: string;
  name: string;
  employeeCode: string;
}

export interface UserView {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  employee: UserEmployeeRef | null;
}

export interface ListUsersResult {
  data: UserView[];
  meta: ListMeta;
}

const HEX24 = /^[a-f\d]{24}$/i;

/** Lean query result: schema fields plus Mongo's `_id` / timestamps. */
type UserRecord = UserDoc & {
  _id: Types.ObjectId;
  createdAt?: Date;
  employeeId?:
    | {
        _id: Types.ObjectId;
        firstName?: string | null;
        lastName?: string | null;
        employeeCode?: string;
      }
    | null;
};

/** Escape a user string before it is used inside a RegExp (§11 — no ReDoS). */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toEmployeeRef = (
  employee: { _id: Types.ObjectId; firstName?: string | null; lastName?: string | null; employeeCode?: string } | null,
): UserEmployeeRef | null => {
  if (!employee) return null;
  const name = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim();
  return {
    id: employee._id.toString(),
    name,
    employeeCode: employee.employeeCode ?? '',
  };
};

const toUserView = (doc: UserRecord): UserView => ({
  id: doc._id.toString(),
  email: doc.email,
  role: doc.role,
  isActive: doc.isActive,
  lastLoginAt: doc.lastLoginAt ? doc.lastLoginAt.toISOString() : null,
  createdAt: doc.createdAt?.toISOString() ?? '',
  employee: toEmployeeRef(doc.employeeId ?? null),
});

export async function listUsers(query: {
  page?: number;
  limit?: number;
  q?: string;
  role?: Role;
  isActive?: boolean;
  sort?: string;
}): Promise<ListUsersResult> {
  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
  });
  const sort = buildSort(query.sort, ['email', 'role', 'isActive', 'lastLoginAt', 'createdAt'], {
    createdAt: -1,
  });

  const filter: Record<string, unknown> = { isDeleted: false };
  if (query.role) filter.role = query.role;
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    const employeeIds = await Employee.find({
      $or: [{ firstName: rx }, { lastName: rx }, { employeeCode: rx }],
    })
      .select('_id')
      .lean();
    filter.$or = [
      { email: rx },
      // D-27: sanitizeFilter would $eq-wrap the nested operator otherwise.
      { employeeId: trustedFilter({ $in: employeeIds.map((doc) => doc._id) }) },
    ];
  }

  const [total, docs] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate('employeeId', 'firstName lastName employeeCode')
      .lean(),
  ]);

  return {
    data: docs.map((doc) => toUserView(doc as unknown as UserRecord)),
    meta: listMeta(pagination, total),
  };
}

export async function getUser(userId: string): Promise<UserView> {
  if (!HEX24.test(userId)) throw notFound('User');
  const doc = await User.findOne({ _id: userId, isDeleted: false })
    .populate('employeeId', 'firstName lastName employeeCode')
    .lean();
  if (!doc) throw notFound('User');
  return toUserView(doc as unknown as UserRecord);
}

export interface CreateUserContext {
  actorId: string;
  actorRole: Role;
}

export async function createUser(
  body: { email: string; password: string; role: Role; employeeId?: string | null },
  ctx: CreateUserContext,
): Promise<UserView> {
  const email = body.email.toLowerCase();

  if (await User.exists({ email })) {
    throw conflict(`A login already exists for ${email}`);
  }

  let employeeId: Types.ObjectId | null = null;
  if (body.employeeId) {
    if (!HEX24.test(body.employeeId)) throw badRequest('`employeeId` must be a valid id');
    const employee = await Employee.findOne({
      _id: new Types.ObjectId(body.employeeId),
      isDeleted: false,
    }).lean();
    if (!employee) throw notFound('Employee');
    if (await User.exists({ employeeId: employee._id, isDeleted: false })) {
      throw conflict('That employee already has a login');
    }
    employeeId = employee._id;
  }

  // §6 — only an HR Admin may grant the HR Admin role.
  if (body.role === 'HR Admin' && ctx.actorRole !== 'HR Admin') {
    throw forbidden('Only an HR Admin can grant the HR Admin role');
  }

  const created = await User.create({
    email,
    passwordHash: await hashPassword(body.password),
    role: body.role,
    employeeId,
    isActive: true,
    lastLoginAt: null,
    refreshTokenHash: null,
    refreshTokenExpiresAt: null,
    createdBy: new Types.ObjectId(ctx.actorId),
    isDeleted: false,
  });

  return getUser(created._id.toString());
}

/**
 * Change a login's role and/or activation state.
 *
 * Guards (business rules, 422):
 *  - an account cannot change its own role or disable itself;
 *  - the last active HR Admin login can neither be demoted nor disabled,
 *    otherwise the system could be locked out of user management.
 */
export async function updateUser(
  userId: string,
  patch: { role?: Role; isActive?: boolean },
  ctx: CreateUserContext,
): Promise<{ view: UserView; before: { role: Role; isActive: boolean }; after: { role: Role; isActive: boolean } }> {
  if (!HEX24.test(userId)) throw notFound('User');
  const doc = await User.findOne({ _id: userId, isDeleted: false });
  if (!doc) throw notFound('User');

  if (userId === ctx.actorId) {
    throw unprocessable('You cannot change your own role or disable your own login');
  }

  if (patch.role === 'HR Admin' && ctx.actorRole !== 'HR Admin') {
    throw forbidden('Only an HR Admin can grant the HR Admin role');
  }

  const before = { role: doc.role, isActive: doc.isActive };
  const nextRole = patch.role ?? doc.role;
  const nextActive = patch.isActive ?? doc.isActive;

  const losingAdmin =
    doc.role === 'HR Admin' && (nextRole !== 'HR Admin' || nextActive === false);
  if (losingAdmin) {
    const remaining = await User.countDocuments({
      // D-27: nested operator — trusted so sanitizeFilter keeps the $ne.
      _id: trustedFilter({ $ne: doc._id }),
      role: 'HR Admin',
      isActive: true,
      isDeleted: false,
    });
    if (remaining === 0) {
      throw unprocessable('At least one active HR Admin login must remain');
    }
  }

  doc.role = nextRole;
  doc.isActive = nextActive;
  await doc.save();

  return {
    view: await getUser(userId),
    before,
    after: { role: doc.role, isActive: doc.isActive },
  };
}

/**
 * Admin password reset. Clears the stored refresh-token hash so every
 * existing session for that login is invalidated on its next refresh.
 * The new password is hashed with bcrypt (cost 12) and never audited or
 * logged.
 */
export async function resetUserPassword(
  userId: string,
  password: string,
): Promise<UserView> {
  if (!HEX24.test(userId)) throw notFound('User');
  const doc = await User.findOne({ _id: userId, isDeleted: false });
  if (!doc) throw notFound('User');

  doc.passwordHash = await hashPassword(password);
  doc.refreshTokenHash = null;
  doc.refreshTokenExpiresAt = null;
  await doc.save();

  return getUser(userId);
}
