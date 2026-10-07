import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { flushRedis } from '../setup/setup';
import {
  DEMO_ACCOUNTS,
  bearer,
  getApp,
  login,
  loginAs,
  seedDatabase,
  type Session,
} from '../support/helpers';
import { SEEDED, employeeIdByEmail } from '../support/employee-fixtures';
import { User } from '../../src/modules/users/user.model';
import { createUser, updateUser } from '../../src/modules/users/user.service';
import { AuditLog } from '../../src/modules/audit/audit.model';
import { trustedFilter } from '../../src/utils/mongo';

/**
 * AGENTS.md §6 — "HR Admin: manage users / manage roles"; "HR Manager cannot
 * manage users". Every route is gated by `manageUsers` (HR Admin only), the
 * guards prevent self-lockout, and credentials never leave the module.
 */

const app = getApp();

let admin: Session;
let hrManager: Session;
let manager: Session;
let employee: Session;

const authAs = {
  admin: () => bearer(admin.accessToken),
  hrManager: () => bearer(hrManager.accessToken),
  manager: () => bearer(manager.accessToken),
  employee: () => bearer(employee.accessToken),
};

const uniqueEmail = (prefix = 'user'): string =>
  `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@harviktech.com`;

describe('user management (§6 manage users / manage roles)', () => {
  beforeAll(async () => {
    await seedDatabase();
    admin = await loginAs(DEMO_ACCOUNTS.admin);
    hrManager = await loginAs(DEMO_ACCOUNTS.hrManager);
    manager = await loginAs(DEMO_ACCOUNTS.manager);
    employee = await loginAs(DEMO_ACCOUNTS.employee);
  });

  beforeEach(async () => {
    await flushRedis();
  });

  it('rejects unauthenticated access with 401', async () => {
    const list = await request(app).get('/api/v1/users');
    expect(list.status).toBe(401);

    const create = await request(app)
      .post('/api/v1/users')
      .send({ email: uniqueEmail('anon'), password: 'Passw0rd!', role: 'Employee' });
    expect(create.status).toBe(401);
  });

  it('forbids every user-management route for HR Manager, Manager and Employee (§6)', async () => {
    const victim = '000000000000000000000000';
    for (const as of [authAs.hrManager(), authAs.manager(), authAs.employee()]) {
      const list = await request(app).get('/api/v1/users').set(...as);
      expect(list.status).toBe(403);

      const read = await request(app).get(`/api/v1/users/${victim}`).set(...as);
      expect(read.status).toBe(403);

      const create = await request(app)
        .post('/api/v1/users')
        .set(...as)
        .send({ email: uniqueEmail('forbidden'), password: 'Passw0rd!', role: 'Employee' });
      expect(create.status).toBe(403);

      const update = await request(app)
        .patch(`/api/v1/users/${victim}`)
        .set(...as)
        .send({ role: 'Manager' });
      expect(update.status).toBe(403);

      const reset = await request(app)
        .post(`/api/v1/users/${victim}/password`)
        .set(...as)
        .send({ password: 'Passw0rd!' });
      expect(reset.status).toBe(403);
      expect(list.body.error?.code).toBe('FORBIDDEN');
    }

    // Nothing was created behind the deny wall.
    expect(await User.exists({ email: /forbidden/i })).toBeNull();
  });

  it('HR Admin lists users with pagination meta and never exposes credentials', async () => {
    const res = await request(app).get('/api/v1/users?page=1&limit=5').set(...authAs.admin());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(4);

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('refreshToken');
    expect(serialised).not.toContain('Passw0rd');

    // Page limit capped at 100 (§10).
    const capped = await request(app).get('/api/v1/users?limit=500').set(...authAs.admin());
    expect(capped.status).toBe(400);
  });

  it('filters the user list by role and free-text query', async () => {
    const byRole = await request(app).get('/api/v1/users?role=Employee').set(...authAs.admin());
    expect(byRole.status).toBe(200);
    for (const row of byRole.body.data) expect(row.role).toBe('Employee');

    const byQuery = await request(app).get('/api/v1/users?q=admin').set(...authAs.admin());
    expect(byQuery.status).toBe(200);
    expect(
      byQuery.body.data.some(
        (row: { email: string }) => row.email === DEMO_ACCOUNTS.admin,
      ),
    ).toBe(true);

    const noMatch = await request(app)
      .get('/api/v1/users?q=no-such-login-anywhere')
      .set(...authAs.admin());
    expect(noMatch.status).toBe(200);
    expect(noMatch.body.data).toHaveLength(0);
  });

  it('reads one user by id and 404s on unknown ids', async () => {
    const list = await request(app).get('/api/v1/users?limit=1').set(...authAs.admin());
    const first = list.body.data[0] as { id: string; email: string };

    const res = await request(app).get(`/api/v1/users/${first.id}`).set(...authAs.admin());
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(first.email);

    const unknown = await request(app)
      .get('/api/v1/users/000000000000000000000000')
      .set(...authAs.admin());
    expect(unknown.status).toBe(404);

    const malformed = await request(app).get('/api/v1/users/not-an-id').set(...authAs.admin());
    expect(malformed.status).toBe(404);
  });

  it('creates a login, rejects duplicates and weak passwords, and the login works', async () => {
    const email = uniqueEmail('created');
    const created = await request(app)
      .post('/api/v1/users')
      .set(...authAs.admin())
      .send({ email, password: 'Passw0rd!', role: 'Employee' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ email, role: 'Employee', isActive: true });
    expect(created.body.data.employee).toBeNull();
    expect(JSON.stringify(created.body)).not.toContain('password');

    const duplicate = await request(app)
      .post('/api/v1/users')
      .set(...authAs.admin())
      .send({ email: email.toUpperCase(), password: 'Passw0rd!', role: 'Employee' });
    expect(duplicate.status).toBe(409);

    const weak = await request(app)
      .post('/api/v1/users')
      .set(...authAs.admin())
      .send({ email: uniqueEmail('weak'), password: 'short', role: 'Employee' });
    expect(weak.status).toBe(400);

    const badRole = await request(app)
      .post('/api/v1/users')
      .set(...authAs.admin())
      .send({ email: uniqueEmail('badrole'), password: 'Passw0rd!', role: 'Superuser' });
    expect(badRole.status).toBe(400);

    const session = await login(email, 'Passw0rd!');
    expect(session.status).toBe(200);
  });

  it('links a login to an employee and refuses a second login for the same employee', async () => {
    const rahulId = await employeeIdByEmail(SEEDED.seniorEngineer);
    const email = uniqueEmail('linked');

    const linked = await request(app)
      .post('/api/v1/users')
      .set(...authAs.admin())
      .send({ email, password: 'Passw0rd!', role: 'Employee', employeeId: rahulId });
    expect(linked.status).toBe(201);
    expect(linked.body.data.employee).toMatchObject({ id: rahulId });

    const second = await request(app)
      .post('/api/v1/users')
      .set(...authAs.admin())
      .send({
        email: uniqueEmail('linked-twice'),
        password: 'Passw0rd!',
        role: 'Employee',
        employeeId: rahulId,
      });
    expect(second.status).toBe(409);

    const missingEmployee = await request(app)
      .post('/api/v1/users')
      .set(...authAs.admin())
      .send({
        email: uniqueEmail('ghost'),
        password: 'Passw0rd!',
        role: 'Employee',
        employeeId: '000000000000000000000000',
      });
    expect(missingEmployee.status).toBe(404);
  });

  it('changes role and activation, but never lets an account edit itself (§6)', async () => {
    const email = uniqueEmail('promotable');
    const created = await request(app)
      .post('/api/v1/users')
      .set(...authAs.admin())
      .send({ email, password: 'Passw0rd!', role: 'Employee' });
    const userId = created.body.data.id as string;

    const promoted = await request(app)
      .patch(`/api/v1/users/${userId}`)
      .set(...authAs.admin())
      .send({ role: 'Manager' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.role).toBe('Manager');
    expect(promoted.body.data.isActive).toBe(true);

    const disabled = await request(app)
      .patch(`/api/v1/users/${userId}`)
      .set(...authAs.admin())
      .send({ isActive: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.isActive).toBe(false);

    // A disabled login can no longer sign in (§6 isActive enforcement).
    const rejected = await login(email, 'Passw0rd!');
    expect([401, 403]).toContain(rejected.status);

    // Self-edit is refused so an admin can never lock themselves out.
    const selfRole = await request(app)
      .patch(`/api/v1/users/${admin.account.userId}`)
      .set(...authAs.admin())
      .send({ role: 'Employee' });
    expect(selfRole.status).toBe(422);

    const selfDisable = await request(app)
      .patch(`/api/v1/users/${admin.account.userId}`)
      .set(...authAs.admin())
      .send({ isActive: false });
    expect(selfDisable.status).toBe(422);

    const emptyPatch = await request(app)
      .patch(`/api/v1/users/${userId}`)
      .set(...authAs.admin())
      .send({});
    expect(emptyPatch.status).toBe(400);
  });

  it('service guards: only an HR Admin can grant HR Admin, and the last admin survives', async () => {
    // Direct service exercise of the guard that RBAC keeps unreachable over HTTP.
    await expect(
      createUser(
        { email: uniqueEmail('mint'), password: 'Passw0rd!', role: 'HR Admin' },
        { actorId: '0'.repeat(24), actorRole: 'HR Manager' },
      ),
    ).rejects.toThrow(/HR Admin/);

    const soleAdmin = await User.findOne({ role: 'HR Admin', isDeleted: false }).lean();
    const otherActor = await User.findOne({ role: 'Manager', isDeleted: false }).lean();
    expect(soleAdmin).not.toBeNull();
    expect(otherActor).not.toBeNull();

    await expect(
      updateUser(
        String(soleAdmin!._id),
        { isActive: false },
        { actorId: String(otherActor!._id), actorRole: 'Manager' },
      ),
    ).rejects.toThrow(/active HR Admin/);

    await expect(
      updateUser(
        String(soleAdmin!._id),
        { role: 'Employee' },
        { actorId: String(otherActor!._id), actorRole: 'Manager' },
      ),
    ).rejects.toThrow(/active HR Admin/);

    const stillAdmin = await User.findById(String(soleAdmin!._id)).lean();
    expect(stillAdmin?.isActive).toBe(true);
    expect(stillAdmin?.role).toBe('HR Admin');
  });

  it('admin password reset replaces credentials, revokes sessions and audits safely (§11)', async () => {
    const email = uniqueEmail('resettable');
    const created = await request(app)
      .post('/api/v1/users')
      .set(...authAs.admin())
      .send({ email, password: 'OldPass123', role: 'Employee' });
    const userId = created.body.data.id as string;

    const beforeSession = await login(email, 'OldPass123');
    expect(beforeSession.status).toBe(200);

    const reset = await request(app)
      .post(`/api/v1/users/${userId}/password`)
      .set(...authAs.admin())
      .send({ password: 'NewPass456' });
    expect(reset.status).toBe(200);
    expect(JSON.stringify(reset.body)).not.toContain('NewPass456');

    // Old password no longer works.
    const oldPassword = await login(email, 'OldPass123');
    expect(oldPassword.status).toBe(401);

    // The pre-reset refresh session was revoked.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', beforeSession.refreshCookie);
    expect([401, 403]).toContain(replay.status);

    // The new password works.
    const fresh = await login(email, 'NewPass456');
    expect(fresh.status).toBe(200);

    // Weak replacement is refused by schema.
    const weak = await request(app)
      .post(`/api/v1/users/${userId}/password`)
      .set(...authAs.admin())
      .send({ password: '12345' });
    expect(weak.status).toBe(400);
  });

  it('audits create, update and password reset without recording credentials (§6/§11)', async () => {
    // D-27: sanitizeFilter would $eq-wrap the $in without trustedFilter.
    await AuditLog.deleteMany({
      action: trustedFilter({ $in: ['user.create', 'user.update', 'user.password_reset'] }),
    });

    const email = uniqueEmail('audited');
    const created = await request(app)
      .post('/api/v1/users')
      .set(...authAs.admin())
      .send({ email, password: 'Passw0rd!', role: 'Employee' });
    const userId = created.body.data.id as string;

    await request(app)
      .patch(`/api/v1/users/${userId}`)
      .set(...authAs.admin())
      .send({ role: 'Manager' });

    await request(app)
      .post(`/api/v1/users/${userId}/password`)
      .set(...authAs.admin())
      .send({ password: 'RotatedPass9' });

    const entries = await AuditLog.find({
      action: trustedFilter({ $in: ['user.create', 'user.update', 'user.password_reset'] }),
    })
      .sort({ at: 1 })
      .lean()
      .exec();

    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['user.create', 'user.update', 'user.password_reset']),
    );
    expect(entries.every((e) => e.actorId != null)).toBe(true);

    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain('Passw0rd!');
    expect(serialised).not.toContain('RotatedPass9');
    expect(serialised).not.toContain('passwordHash');
  });
});
