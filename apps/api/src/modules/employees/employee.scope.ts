import { Types } from 'mongoose';
import { Employee } from './employee.model';
import type { AuthAccount } from '../auth/auth.service';
import { forbidden } from '../../utils/errors';
import { trustedFilter } from '../../utils/mongo';

/**
 * AGENTS.md §6 — "Manager scope is derived recursively from reportingManagerId,
 * maximum depth 5."
 *
 * Scope is a per-request property of the caller, never of the client: a Manager
 * cannot widen it by sending a parameter, because the root is the employee id on
 * their own account.
 */

/** §6 — hard cap on how far the reporting chain is walked. */
export const MAX_TEAM_DEPTH = 5;

export type ScopeKind = 'organisation' | 'team' | 'self';

export interface ResolvedScope {
  kind: ScopeKind;
  /** Visible employee ids. Empty for `organisation`, which means "no filter". */
  employeeIds: Set<string>;
}

const ORGANISATION: ResolvedScope = { kind: 'organisation', employeeIds: new Set() };

/** True when the caller is scoped to the whole organisation. */
export const isUnrestricted = (scope: ResolvedScope): boolean => scope.kind === 'organisation';

/**
 * Fail-closed id check for self-scoping reads: a missing or malformed account
 * link yields no rows, never a 500 from ObjectId construction. (JWT claims and
 * DB links are valid in practice; this guards corrupt data only.)
 */
export function isValidScopeId(value: string | null | undefined): value is string {
  return !!value && Types.ObjectId.isValid(value);
}

/**
 * Breadth-first walk of the reporting tree.
 *
 * A `visited` set makes this safe against a cycle that somehow reached the
 * database, so a corrupt chain degrades to a bounded search instead of hanging.
 */
export async function collectTeamIds(rootEmployeeId: string, maxDepth = MAX_TEAM_DEPTH): Promise<Set<string>> {
  // Fail closed on a malformed root: a broken account link must yield an
  // empty scope (403s downstream), never a 500 from ObjectId construction.
  if (!rootEmployeeId || !Types.ObjectId.isValid(rootEmployeeId)) {
    return new Set<string>();
  }
  const seen = new Set<string>([rootEmployeeId]);
  let frontier = [rootEmployeeId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const reports = await Employee.find(
      {
        reportingManagerId: trustedFilter({
          $in: frontier.map((id) => new Types.ObjectId(id)),
        }),
      },
      { _id: 1 },
    )
      .lean()
      .exec();

    frontier = [];
    for (const report of reports) {
      const id = report._id.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      frontier.push(id);
    }
  }

  return seen;
}

/**
 * AGENTS.md §6:
 *  - HR Admin / HR Manager → the whole organisation.
 *  - Manager               → self + reports, recursively, depth 5.
 *  - Employee              → self only.
 *
 * A Manager or Employee whose account has no `employeeId` resolves to an empty
 * set, so they can see nothing. Failing closed here is deliberate: a broken
 * account link must never silently widen access.
 */
export async function resolveScope(account: AuthAccount): Promise<ResolvedScope> {
  if (account.role === 'HR Admin' || account.role === 'HR Manager') return ORGANISATION;

  if (!account.employeeId || !Types.ObjectId.isValid(account.employeeId)) {
    return { kind: account.role === 'Manager' ? 'team' : 'self', employeeIds: new Set() };
  }

  if (account.role === 'Manager') {
    return {
      kind: 'team',
      employeeIds: await collectTeamIds(account.employeeId),
    };
  }

  return { kind: 'self', employeeIds: new Set([account.employeeId]) };
}

/**
 * Guard a single employee read. Returns silently when the caller may see the
 * employee, and raises 403 otherwise.
 *
 * A 404 would leak less, but AGENTS.md §6 describes Manager and Employee scope
 * as a permission outcome, and §10 expects 403 for "authenticated but not
 * allowed", so 403 is used consistently here.
 */
export function assertWithinScope(scope: ResolvedScope, employeeId: string): void {
  if (isUnrestricted(scope)) return;
  if (scope.employeeIds.has(employeeId)) return;
  throw forbidden('You do not have access to this employee');
}
