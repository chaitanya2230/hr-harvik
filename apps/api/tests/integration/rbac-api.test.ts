import type { Express, RequestHandler } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { requireAuth } from '../../src/middleware/auth';
import { requirePermission, requireRoles } from '../../src/middleware/rbac';
import { PERMISSIONS } from '../../src/config/constants';
import { bearer, DEMO_ACCOUNTS, loginAs, seedDatabase } from '../support/helpers';

/**
 * AGENTS.md §6 RBAC / §14 AUTH — the guards are only meaningful if the real
 * middleware stack rejects the wrong caller. These probes are mounted through
 * `createApp({ beforeNotFound })`, so they run behind helmet, CORS, HPP,
 * NoSQL sanitisation and the error handler exactly as production routes do.
 */

const NOOP: RequestHandler = (_req, res) => {
  res.status(200).json({ data: { ok: true } });
};

function buildApp(): Express {
  return createApp({
    beforeNotFound(app) {
      app.get('/__probe/any-role', requireAuth, NOOP);
      app.post('/__probe/any-role', requireAuth, NOOP);
      app.get('/__probe/hr-only', requireAuth, requireRoles('HR Admin'), NOOP);
      app.post('/__probe/hr-only', requireAuth, requireRoles('HR Admin'), NOOP);
      app.get(
        '/__probe/delete-employee',
        requireAuth,
        requirePermission(PERMISSIONS.deleteEmployee),
        NOOP,
      );
      // §6 — an OR set: holding either capability is enough.
      app.get(
        '/__probe/approve-or-correct',
        requireAuth,
        requirePermission(PERMISSIONS.approveTeamLeave, PERMISSIONS.approveAttendanceCorrection),
        NOOP,
      );
      // Guard without `authenticate` first, to prove it fails closed.
      app.get('/__probe/unauthenticated-guard', requireRoles('HR Admin'), NOOP);
    },
  });
}

const app = buildApp();

const tokenFor = (account: keyof typeof DEMO_ACCOUNTS): Promise<string> =>
  loginAs(DEMO_ACCOUNTS[account]).then((session) => session.accessToken);

describe('RBAC over HTTP (AGENTS.md §6, §14)', () => {
  beforeAll(async () => {
    await seedDatabase();
  });

  describe('authentication gate', () => {
    it('rejects an unauthenticated request with 401 (§14)', async () => {
      const response = await request(app).get('/__probe/any-role');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('fails closed when a role guard runs without authenticate first', async () => {
      const response = await request(app).get('/__probe/unauthenticated-guard');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('requireRoles', () => {
    it('allows HR Admin through the HR-only route', async () => {
      const response = await request(app)
        .get('/__probe/hr-only')
        .set(...bearer(await tokenFor('admin')));

      expect(response.status).toBe(200);
    });

    it.each([
      ['hrManager', 'HR Manager'],
      ['manager', 'Manager'],
      ['employee', 'Employee'],
    ] as const)('rejects %s with 403 FORBIDDEN (§14)', async (account, role) => {
      const response = await request(app)
        .get('/__probe/hr-only')
        .set(...bearer(await tokenFor(account)));

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      // The message names the roles that *would* be accepted.
      expect(response.body.error.message).toContain('HR Admin');
      expect(role).not.toBe('HR Admin');
    });
  });

  describe('requirePermission', () => {
    it('lets HR Admin delete employees (AGENTS.md §6)', async () => {
      const response = await request(app)
        .get('/__probe/delete-employee')
        .set(...bearer(await tokenFor('admin')));

      expect(response.status).toBe(200);
    });

    it.each(['hrManager', 'manager', 'employee'] as const)(
      'rejects %s: deleteEmployee is HR Admin only (§6)',
      async (account) => {
        const response = await request(app)
          .get('/__probe/delete-employee')
          .set(...bearer(await tokenFor(account)));

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
      },
    );

    it('uses OR semantics across several listed permissions', async () => {
      // Manager holds both, HR Admin holds both.
      const manager = await request(app)
        .get('/__probe/approve-or-correct')
        .set(...bearer(await tokenFor('manager')));

      // Employee holds neither.
      const employee = await request(app)
        .get('/__probe/approve-or-correct')
        .set(...bearer(await tokenFor('employee')));

      expect(manager.status).toBe(200);
      expect(employee.status).toBe(403);
    });
  });

  describe('permission matrix matches AGENTS.md §6', () => {
    const matrix: Array<{
      account: keyof typeof DEMO_ACCOUNTS;
      granted: string[];
      denied: string[];
    }> = [
      {
        account: 'admin',
        granted: [
          PERMISSIONS.manageUsers,
          PERMISSIONS.manageSettings,
          PERMISSIONS.manageRoles,
          PERMISSIONS.deleteEmployee,
          PERMISSIONS.processExit,
          PERMISSIONS.forceRelieve,
          PERMISSIONS.viewCostReports,
        ],
        denied: [],
      },
      {
        account: 'hrManager',
        granted: [
          PERMISSIONS.createEmployee,
          PERMISSIONS.updateEmployee,
          PERMISSIONS.processExit,
          PERMISSIONS.viewCostReports,
          PERMISSIONS.viewEmployeeDirectory,
        ],
        // §6 — cannot manage users/settings and cannot delete employees.
        denied: [
          PERMISSIONS.manageUsers,
          PERMISSIONS.manageSettings,
          PERMISSIONS.manageRoles,
          PERMISSIONS.deleteEmployee,
          PERMISSIONS.forceRelieve,
        ],
      },
      {
        account: 'manager',
        granted: [
          PERMISSIONS.approveTeamLeave,
          PERMISSIONS.approveAttendanceCorrection,
          PERMISSIONS.provideManagerClearance,
        ],
        denied: [
          PERMISSIONS.manageUsers,
          PERMISSIONS.createEmployee,
          PERMISSIONS.deleteEmployee,
          PERMISSIONS.forceRelieve,
          PERMISSIONS.viewAllReports,
          PERMISSIONS.viewCostReports,
        ],
      },
      {
        // §6 — self-service only, which needs no elevated capability.
        account: 'employee',
        granted: [],
        denied: [
          PERMISSIONS.manageUsers,
          PERMISSIONS.createEmployee,
          PERMISSIONS.updateEmployee,
          PERMISSIONS.deleteEmployee,
          PERMISSIONS.approveTeamLeave,
          PERMISSIONS.processExit,
          PERMISSIONS.viewEmployeeDirectory,
          PERMISSIONS.viewAllReports,
        ],
      },
    ];

    it.each(matrix)('$account holds and lacks the expected capabilities', async (row) => {
      const session = await loginAs(DEMO_ACCOUNTS[row.account]);

      for (const permission of row.granted) {
        expect(session.permissions, `${row.account} should hold ${permission}`).toContain(
          permission,
        );
      }
      for (const permission of row.denied) {
        expect(
          session.permissions,
          `${row.account} should NOT hold ${permission}`,
        ).not.toContain(permission);
      }
    });

    it('never advertises a permission outside the role map', async () => {
      for (const account of Object.keys(DEMO_ACCOUNTS) as Array<
        keyof typeof DEMO_ACCOUNTS
      >) {
        const session = await loginAs(DEMO_ACCOUNTS[account]);
        const known = new Set<string>(Object.values(PERMISSIONS));
        for (const permission of session.permissions) {
          expect(known.has(permission)).toBe(true);
        }
      }
    });
  });

  describe('authorisation is decided server-side', () => {
    it('ignores role and permission hints supplied in the request body', async () => {
      // §2/§11 — the frontend must not be able to escalate by sending claims.
      const session = await loginAs(DEMO_ACCOUNTS.employee);

      // The guard runs before any body is read, so the escalation attempt is
      // refused on authorisation alone.
      const response = await request(app)
        .post('/__probe/hr-only')
        .set(...bearer(session.accessToken))
        .send({ role: 'HR Admin', permissions: [PERMISSIONS.manageUsers] });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('ignores an unverified alg=none token', async () => {
      const forged =
        'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.' +
        Buffer.from(JSON.stringify({ sub: 'x', role: 'HR Admin' })).toString('base64url') +
        '.';

      const response = await request(app).get('/__probe/hr-only').set(...bearer(forged));

      expect(response.status).toBe(401);
    });
  });

  it('does not leak a stack trace inside the 403 envelope', async () => {
    const response = await request(app)
      .get('/__probe/delete-employee')
      .set(...bearer(await tokenFor('employee')));

    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toMatch(/\bat\b.+:\d+:\d+/);
    expect(response.body.error.details ?? null).toBeNull();
  });
});