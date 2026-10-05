import { describe, expect, it } from 'vitest';
import {
  EMPLOYEE_STATUSES,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  STATUS_TRANSITIONS,
  type EmployeeStatus,
} from '../../src/config/constants';
import { hasPermission } from '../../src/middleware/rbac';

/** AGENTS.md §6 — role capabilities. */
describe('role → permission matrix', () => {
  it('gives HR Admin every permission', () => {
    for (const permission of Object.values(PERMISSIONS)) {
      expect(hasPermission('HR Admin', permission)).toBe(true);
    }
  });

  it('lets HR Manager run HR operations but not user/system management', () => {
    expect(hasPermission('HR Manager', PERMISSIONS.createEmployee)).toBe(true);
    expect(hasPermission('HR Manager', PERMISSIONS.processExit)).toBe(true);
    expect(hasPermission('HR Manager', PERMISSIONS.viewAllReports)).toBe(true);

    expect(hasPermission('HR Manager', PERMISSIONS.manageUsers)).toBe(false);
    expect(hasPermission('HR Manager', PERMISSIONS.manageRoles)).toBe(false);
    expect(hasPermission('HR Manager', PERMISSIONS.manageSettings)).toBe(false);
    expect(hasPermission('HR Manager', PERMISSIONS.deleteEmployee)).toBe(false);
    expect(hasPermission('HR Manager', PERMISSIONS.forceRelieve)).toBe(false);
  });

  it('restricts Manager to team-scoped capabilities', () => {
    expect(hasPermission('Manager', PERMISSIONS.approveTeamLeave)).toBe(true);
    expect(hasPermission('Manager', PERMISSIONS.approveAttendanceCorrection)).toBe(true);
    expect(hasPermission('Manager', PERMISSIONS.provideManagerClearance)).toBe(true);

    expect(hasPermission('Manager', PERMISSIONS.viewEmployeeDirectory)).toBe(false);
    expect(hasPermission('Manager', PERMISSIONS.viewAllReports)).toBe(false);
    expect(hasPermission('Manager', PERMISSIONS.viewCostReports)).toBe(false);
    expect(hasPermission('Manager', PERMISSIONS.createEmployee)).toBe(false);
    expect(hasPermission('Manager', PERMISSIONS.processExit)).toBe(false);
  });

  it('gives Employee no HR permissions at all (self-service only)', () => {
    for (const permission of Object.values(PERMISSIONS)) {
      expect(hasPermission('Employee', permission)).toBe(false);
    }
  });

  it('limits salary/cost reporting to HR roles (§8.11)', () => {
    expect(hasPermission('HR Admin', PERMISSIONS.viewCostReports)).toBe(true);
    expect(hasPermission('HR Manager', PERMISSIONS.viewCostReports)).toBe(true);
    expect(hasPermission('Manager', PERMISSIONS.viewCostReports)).toBe(false);
    expect(hasPermission('Employee', PERMISSIONS.viewCostReports)).toBe(false);
  });

  it('reserves force-relieve for HR Admin (§8.10)', () => {
    const holders = ROLES.filter((role) => hasPermission(role, PERMISSIONS.forceRelieve));

    expect(holders).toEqual(['HR Admin']);
  });

  it('defines a permission set for every role', () => {
    for (const role of ROLES) expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
  });
});

/** AGENTS.md §8.2 — allowed status transitions. */
describe('employee status machine', () => {
  it('declares transitions for every status', () => {
    for (const status of EMPLOYEE_STATUSES) {
      expect(Array.isArray(STATUS_TRANSITIONS[status])).toBe(true);
    }
  });

  it('makes Relieved terminal', () => {
    expect(STATUS_TRANSITIONS.Relieved).toEqual([]);
  });

  it('allows the documented transitions', () => {
    const allowed: Array<[EmployeeStatus, EmployeeStatus]> = [
      ['Probation', 'Active'],
      ['Probation', 'On Notice'],
      ['Probation', 'Resigned'],
      ['Probation', 'Inactive'],
      ['Active', 'On Notice'],
      ['Active', 'Resigned'],
      ['Active', 'Inactive'],
      ['Resigned', 'On Notice'],
      ['Resigned', 'Relieved'],
      ['On Notice', 'Relieved'],
      ['On Notice', 'Active'],
      ['Inactive', 'Active'],
    ];

    for (const [from, to] of allowed) {
      expect(STATUS_TRANSITIONS[from]).toContain(to);
    }
  });

  it('forbids skipping straight from Active to Relieved', () => {
    expect(STATUS_TRANSITIONS.Active).not.toContain('Relieved');
  });

  it('supports notice withdrawal (§8.10) and reactivation (§8.2)', () => {
    expect(STATUS_TRANSITIONS['On Notice']).toContain('Active');
    expect(STATUS_TRANSITIONS.Inactive).toContain('Active');
  });
});