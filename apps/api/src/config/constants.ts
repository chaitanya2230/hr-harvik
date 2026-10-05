/**
 * Domain constants shared across modules.
 *
 * These are the values mandated by AGENTS.md §7. Configuration-driven values
 * (leave types, asset types, license types) live in MongoDB and are NOT
 * duplicated here — see `src/config/constants.ts` notes on extensibility.
 */

/** AGENTS.md §6 — Roles. */
export const ROLES = ['HR Admin', 'HR Manager', 'Manager', 'Employee'] as const;
export type Role = (typeof ROLES)[number];

/** AGENTS.md §6 — RBAC is enforced server-side; these are capability keys. */
export const PERMISSIONS = {
  manageUsers: 'manageUsers',
  manageSettings: 'manageSettings',
  manageRoles: 'manageRoles',
  createEmployee: 'createEmployee',
  updateEmployee: 'updateEmployee',
  deleteEmployee: 'deleteEmployee',
  processExit: 'processExit',
  forceRelieve: 'forceRelieve',
  viewAllReports: 'viewAllReports',
  viewCostReports: 'viewCostReports',
  viewEmployeeDirectory: 'viewEmployeeDirectory',
  approveTeamLeave: 'approveTeamLeave',
  approveAttendanceCorrection: 'approveAttendanceCorrection',
  provideManagerClearance: 'provideManagerClearance',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Role → permission matrix.
 *
 * AGENTS.md §6:
 *  - HR Admin   → full access.
 *  - HR Manager → all HR operations, but no user/system management, no deletes.
 *  - Manager    → team-scoped only.
 *  - Employee   → self-service only.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  'HR Admin': Object.values(PERMISSIONS),
  'HR Manager': [
    PERMISSIONS.createEmployee,
    PERMISSIONS.updateEmployee,
    PERMISSIONS.processExit,
    PERMISSIONS.viewAllReports,
    PERMISSIONS.viewCostReports,
    PERMISSIONS.viewEmployeeDirectory,
    PERMISSIONS.approveTeamLeave,
    PERMISSIONS.approveAttendanceCorrection,
    PERMISSIONS.provideManagerClearance,
  ],
  Manager: [
    PERMISSIONS.approveTeamLeave,
    PERMISSIONS.approveAttendanceCorrection,
    PERMISSIONS.provideManagerClearance,
  ],
  Employee: [],
};

/** AGENTS.md §7 — Employee statuses. */
export const EMPLOYEE_STATUSES = [
  'Active',
  'Probation',
  'On Notice',
  'Resigned',
  'Relieved',
  'Inactive',
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** AGENTS.md §7 — Employment types. */
export const EMPLOYMENT_TYPES = [
  'Full-Time',
  'Intern',
  'Freelancer',
  'Contractor',
  'Other',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** AGENTS.md §8.2 — Allowed employee status transitions. */
export const STATUS_TRANSITIONS: Record<EmployeeStatus, readonly EmployeeStatus[]> = {
  Probation: ['Active', 'On Notice', 'Resigned', 'Inactive'],
  Active: ['On Notice', 'Resigned', 'Inactive'],
  Resigned: ['On Notice', 'Relieved'],
  'On Notice': ['Relieved', 'Active'],
  Inactive: ['Active'],
  Relieved: [],
};

/** AGENTS.md §7 — A human-readable ID prefix per entity. */
export const ID_PREFIXES = {
  employee: 'HRV',
  asset: 'AST',
  job: 'JOB',
  license: 'LIC',
  candidate: 'CAN',
} as const;
export type IdPrefixKey = keyof typeof ID_PREFIXES;

export const ID_SEQUENCE_WIDTH = 4;

/** AGENTS.md §6 — Refresh token lifetime / denylist. */
export const REFRESH_COOKIE_NAME = 'hr_refresh_token';

/** AGENTS.md §8.1 — Dashboard cache TTL. */
export const DASHBOARD_CACHE_TTL_SECONDS = 60;

/** AGENTS.md §10 — Maximum page size. */
export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;