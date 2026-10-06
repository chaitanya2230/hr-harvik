import { Types } from 'mongoose';
import type { FilterQuery } from 'mongoose';
import { Employee } from '../employees/employee.model';
import type { EmployeeDoc } from '../employees/employee.schema';
import { AssetAssignment } from '../assets/asset.model';
import { LicenseAssignment } from '../licenses/license.model';
import { AccessItem } from '../access/access.model';
import { Exit } from '../exit/exit.model';
import { scopeIdsFor } from '../employees/employee.service';
import { cacheGetJson, cacheSetJson } from '../../utils/cache';
import { trustedFilter } from '../../utils/mongo';
import { addDaysIso, todayInTimeZone } from '../../utils/dates';
import { dashboardCacheKey, DASHBOARD_CACHE_TTL } from './dashboard.cache';
import type { AuthAccount } from '../auth/auth.service';

/**
 * AGENTS.md §8.1 — HR dashboard summary.
 *
 * Every number below is computed from MongoDB at request time (or read from the
 * 60-second Redis cache). Nothing is hardcoded and no fixture value is ever
 * returned.
 *
 * ## Metrics without a data source yet
 *
 * Three §8.1 metrics depend on collections that belong to later phases and do
 * not exist yet (`onLeave` → P5, `pendingOnboarding` → P6,
 * `pendingDocumentGeneration` → P4). The two P2 metrics (`pendingAssetReturns`,
 * `pendingLicenseRevocations`) are computed here since P2 owns those
 * collections — see D-32 for their exact definitions.
 *
 * Uncomputable metrics are returned as `null` with an entry in `unavailable`,
 * never as `0`. A zero would be a fabricated business claim. See
 * docs/DECISIONS.md D-26.
 */

export type ScopeKind = 'organisation' | 'team' | 'self';

export interface DashboardUnavailable {
  metric: string;
  phase: string;
  reason: string;
}

export interface PendingComponent {
  key: string;
  label: string;
  /** null when the owning phase has not shipped its collection. */
  value: number | null;
  phase: string | null;
}

export interface QuickAction {
  key: string;
  label: string;
  href: string;
  enabled: boolean;
  /** Owning build phase; present when `enabled` is false. */
  phase?: string;
}

export interface EmployeeChip {
  id: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  employmentType: string;
  status: string;
  dateOfJoining?: string;
  lastWorkingDay?: string | null;
}

export interface DashboardSummary {
  scope: { kind: ScopeKind; label: string; visibleEmployeeIds: number | null };
  generatedAt: string;
  cache: { ttlSeconds: number; hit: boolean };
  metrics: {
    totalEmployees: number;
    fullTime: number;
    interns: number;
    freelancers: number;
    newJoiners: number;
    onLeave: number | null;
    onNotice: number;
    leavingSoon: number;
    pendingHrActions: PendingComponent;
    pendingOnboarding: number | null;
    pendingDocumentGeneration: number | null;
    pendingAssetReturns: number | null;
    pendingLicenseRevocations: number | null;
  };
  /**
   * §8.1 — cards are clickable and lead to filtered lists. A null href means
   * no list exists yet (the owning phase has not shipped it); the UI renders
   * those cards without a link rather than a dead one.
   */
  links: Record<string, string | null>;
  unavailable: DashboardUnavailable[];
  recentlyJoined: EmployeeChip[];
  leavingSoonEmployees: EmployeeChip[];
  quickActions: QuickAction[];
}

/** §8.1 — "Total excludes Relieved and Inactive." */
const COUNTED_STATUSES = ['Active', 'Probation', 'On Notice', 'Resigned'] as const;

/** §8.1 — "New joiners = joined within last 30 days." */
const NEW_JOINER_WINDOW_DAYS = 30;
/** §8.1 — "Leaving soon = LWD within next 30 days." */
const LEAVING_SOON_WINDOW_DAYS = 30;

const SCOPE_LABEL: Record<ScopeKind, string> = {
  organisation: 'Whole organisation',
  team: 'Your team',
  self: 'Your profile',
};

const chip = (doc: {
  _id: unknown;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation?: string | null;
  employmentType: string;
  status: string;
  dateOfJoining?: string;
  lastWorkingDay?: string | null;
}): EmployeeChip => ({
  id: String(doc._id),
  employeeCode: doc.employeeCode,
  fullName: `${doc.firstName} ${doc.lastName}`.trim(),
  designation: doc.designation ?? null,
  employmentType: doc.employmentType,
  status: doc.status,
  ...(doc.dateOfJoining ? { dateOfJoining: doc.dateOfJoining } : {}),
  lastWorkingDay: doc.lastWorkingDay ?? null,
});

/**
 * §8.1 quick actions. "Assign Asset" and "Assign Software License" go live in
 * P2; the rest name the phase that owns them.
 */
const QUICK_ACTIONS: QuickAction[] = [
  { key: 'addEmployee', label: 'Add Employee', href: '/employees/new', enabled: true },
  { key: 'addCandidate', label: 'Add Candidate', href: '/recruitment/candidates/new', enabled: false, phase: 'P6' },
  { key: 'startOnboarding', label: 'Start Onboarding', href: '/onboarding', enabled: false, phase: 'P6' },
  { key: 'generateDocument', label: 'Generate Document', href: '/documents', enabled: true },
  { key: 'assignAsset', label: 'Assign Asset', href: '/assets', enabled: true },
  { key: 'assignLicense', label: 'Assign Software License', href: '/licenses', enabled: true },
  { key: 'processExit', label: 'Process Exit', href: '/exit', enabled: true },
];

const UNAVAILABLE: DashboardUnavailable[] = [
  { metric: 'onLeave', phase: 'P5', reason: 'Requires the Leave collection (approved leave today).' },
  { metric: 'pendingOnboarding', phase: 'P6', reason: 'Requires the Onboarding collection.' },
];

export async function buildDashboardSummary(account: AuthAccount): Promise<DashboardSummary> {
  const visibleIds = await scopeIdsFor(account);
  const scopeKind: ScopeKind =
    account.role === 'HR Admin' || account.role === 'HR Manager'
      ? 'organisation'
      : account.role === 'Manager'
        ? 'team'
        : 'self';

  const today = todayInTimeZone();
  const newJoinerFrom = addDaysIso(today, -NEW_JOINER_WINDOW_DAYS);
  const leavingUntil = addDaysIso(today, LEAVING_SOON_WINDOW_DAYS);

  // A Manager/Employee with an empty scope must see zeros, never "no filter".
  // An unrestricted caller gets no `_id` clause at all.
  const idFilter: FilterQuery<EmployeeDoc> | null =
    visibleIds === undefined
      ? null
      : {
          _id: trustedFilter({
            $in: [...visibleIds].map((id) => new Types.ObjectId(id)),
          }),
        };

  const base = (extra: FilterQuery<EmployeeDoc> = {}): FilterQuery<EmployeeDoc> => ({
    isDeleted: false,
    ...(idFilter ? { _id: idFilter._id } : {}),
    ...extra,
  });

  const counted = (extra: FilterQuery<EmployeeDoc> = {}): FilterQuery<EmployeeDoc> =>
    base({ status: trustedFilter({ $in: [...COUNTED_STATUSES] }), ...extra });

  const count = (filter: FilterQuery<EmployeeDoc>): Promise<number> =>
    Employee.countDocuments(filter).exec();

  // P2 metrics (D-32): employees whose exit is still open, scoped like
  // everything else. Pending returns/revocations hang off this set.
  const noticeIds = await Employee.distinct(
    '_id',
    base({ status: trustedFilter({ $in: ['On Notice', 'Resigned'] }) }),
  ).exec();
  const noticeIdFilter = trustedFilter({
    $in: noticeIds.map((id) => new Types.ObjectId(String(id))),
  });
  const scopeEmployeeFilter =
    visibleIds === undefined
      ? {}
      : { employeeId: trustedFilter({ $in: [...visibleIds].map((id) => new Types.ObjectId(id)) }) };

  const pendingAssetReturns = await AssetAssignment.countDocuments({
    isDeleted: false,
    actualReturnDate: null,
    ...scopeEmployeeFilter,
    $or: [
      { expectedReturnDate: trustedFilter({ $lt: today }) },
      { employeeId: noticeIdFilter },
    ],
  }).exec();

  const pendingLicenseRevocations =
    (await LicenseAssignment.countDocuments({
      isDeleted: false,
      status: 'Assigned',
      ...scopeEmployeeFilter,
      employeeId: noticeIdFilter,
    }).exec()) +
    (await AccessItem.countDocuments({
      isDeleted: false,
      status: 'Active',
      ...scopeEmployeeFilter,
      employeeId: noticeIdFilter,
    }).exec());

  const openExits = await Exit.find({
    isDeleted: false,
    stage: trustedFilter({ $nin: ['Relieved', 'Cancelled'] }),
    ...(visibleIds === undefined
      ? {}
      : { employeeId: trustedFilter({ $in: [...visibleIds].map((id) => new Types.ObjectId(id)) }) }),
  })
    .select('checklist')
    .lean()
    .exec();

  let pendingDocumentGeneration = 0;
  for (const ex of openExits) {
    for (const item of ex.checklist || []) {
      if (item.category === 'document' && item.status === 'Pending') {
        pendingDocumentGeneration += 1;
      }
    }
  }

  const [
    totalEmployees,
    fullTime,
    interns,
    freelancers,
    newJoiners,
    onNotice,
    leavingSoon,
    awaitingExit,
    recentlyJoinedDocs,
    leavingSoonDocs,
  ] = await Promise.all([
    count(counted()),
    count(counted({ employmentType: 'Full-Time' })),
    count(counted({ employmentType: 'Intern' })),
    count(counted({ employmentType: 'Freelancer' })),
    count(counted({ dateOfJoining: trustedFilter({ $gte: newJoinerFrom }) })),
    count(base({ status: trustedFilter({ $in: ['On Notice'] }) })),
    count(
      base({
        status: trustedFilter({ $in: ['On Notice', 'Resigned'] }),
        lastWorkingDay: trustedFilter({ $gte: today, $lte: leavingUntil }),
      }),
    ),
    // §8.1 definition: pending HR actions is the sum of its components.
    count(base({ status: trustedFilter({ $in: ['On Notice', 'Resigned'] }) })),
    Employee.find(counted())
      .sort({ dateOfJoining: -1, employeeCode: -1 })
      .limit(5)
      .select('employeeCode firstName lastName designation employmentType status dateOfJoining lastWorkingDay')
      .lean()
      .exec(),
    Employee.find(
      base({
        status: trustedFilter({ $in: ['On Notice', 'Resigned'] }),
        lastWorkingDay: trustedFilter({ $gte: today, $lte: leavingUntil }),
      }),
    )
      .sort({ lastWorkingDay: 1 })
      .limit(10)
      .select('employeeCode firstName lastName designation employmentType status dateOfJoining lastWorkingDay')
      .lean()
      .exec(),
  ]);

  return {
    scope: {
      kind: scopeKind,
      label: SCOPE_LABEL[scopeKind],
      visibleEmployeeIds: visibleIds === undefined ? null : visibleIds.size,
    },
    generatedAt: new Date().toISOString(),
    cache: { ttlSeconds: DASHBOARD_CACHE_TTL, hit: false },
    metrics: {
      totalEmployees,
      fullTime,
      interns,
      freelancers,
      newJoiners,
      onLeave: null,
      onNotice,
      leavingSoon,
      pendingHrActions: {
        key: 'pendingHrActions',
        label: 'Pending HR actions',
        value: awaitingExit + pendingAssetReturns + pendingLicenseRevocations + pendingDocumentGeneration,
        phase: null,
      },
      pendingOnboarding: null,
      pendingDocumentGeneration,
      pendingAssetReturns,
      pendingLicenseRevocations,
    },
    links: {
      totalEmployees: '/employees',
      fullTime: '/employees?employmentType=Full-Time',
      interns: '/employees?employmentType=Intern',
      freelancers: '/employees?employmentType=Freelancer',
      newJoiners: `/employees?joinedFrom=${newJoinerFrom}`,
      onLeave: null,
      onNotice: '/employees?status=On Notice',
      leavingSoon: '#leaving-soon',
      recentlyJoined: '#recently-joined',
      pendingHrActions: null,
      pendingOnboarding: null,
      pendingDocumentGeneration: '/documents',
      pendingAssetReturns: '/assets/assignments?active=true',
      pendingLicenseRevocations: '/licenses/assignments?status=Assigned',
    },
    unavailable: UNAVAILABLE,
    recentlyJoined: recentlyJoinedDocs.map(chip),
    leavingSoonEmployees: leavingSoonDocs.map(chip),
    quickActions: QUICK_ACTIONS,
  };
}

/**
 * §3 — read through the 60-second Redis cache.
 *
 * `cache.hit` is reported honestly: it is true only when a cached entry was
 * actually returned, so a client can verify the cache is being used rather than
 * taking the claim on trust.
 */
export async function getDashboardSummary(account: AuthAccount): Promise<DashboardSummary> {
  const visibleIds = await scopeIdsFor(account);
  const scopeKind: ScopeKind =
    account.role === 'HR Admin' || account.role === 'HR Manager'
      ? 'organisation'
      : account.role === 'Manager'
        ? 'team'
        : 'self';

  // Unrestricted callers share one cache entry; scoped callers get their own so
  // a Manager can never be served an organisation-wide total.
  const cacheScopeId = visibleIds === undefined ? 'all' : `${account.userId}`;
  const key = dashboardCacheKey(scopeKind, cacheScopeId);

  const cached = await cacheGetJson<DashboardSummary>(key);
  if (cached) {
    return { ...cached, cache: { ttlSeconds: DASHBOARD_CACHE_TTL, hit: true } };
  }

  const summary = await buildDashboardSummary(account);
  await cacheSetJson(key, summary, DASHBOARD_CACHE_TTL);
  return summary;
}
