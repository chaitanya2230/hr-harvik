import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { User } from '../../src/modules/users/user.model';
import { AuditLog } from '../../src/modules/audit/audit.model';
import { DEMO_PASSWORD } from '../../src/modules/auth/auth.schema';
import { flushRedis } from '../setup/setup';
import { DEMO_ACCOUNTS, bearer, getApp, login, loginAs, seedDatabase } from '../support/helpers';

/**
 * AGENTS.md §14 — AUTH / RBAC acceptance cases.
 *
 * §14 "employee cannot access /employees" and "manager only sees team" need the
 * P1 employees module; those are covered in
 * tests/integration/rbac-api.test.ts (middleware) and in P1 (endpoints).
 */
describe('authentication', () => {
  beforeAll(async () => {
    await seedDatabase();
  });

  beforeEach(async () => {
    await flushRedis();
  });

  describe('login', () => {
    it('lets all four demo roles sign in (§14)', async () => {
      const expected: Array<[string, string]> = [
        [DEMO_ACCOUNTS.admin, 'HR Admin'],
        [DEMO_ACCOUNTS.hrManager, 'HR Manager'],
        [DEMO_ACCOUNTS.manager, 'Manager'],
        [DEMO_ACCOUNTS.employee, 'Employee'],
      ];

      for (const [email, role] of expected) {
        const result = await login(email);

        expect(result.status, `login failed for ${email}`).toBe(200);
        expect(result.body.data?.account.role).toBe(role);
        expect(result.body.data?.accessToken).toEqual(expect.any(String));
      }
    });

    it('records lastLoginAt', async () => {
      await login(DEMO_ACCOUNTS.admin);

      const user = await User.findOne({ email: DEMO_ACCOUNTS.admin }).exec();

      expect(user?.lastLoginAt).toBeInstanceOf(Date);
    });

    it('returns the refresh token only as an httpOnly cookie, never in the body', async () => {
      const response = await request(getApp())
        .post('/api/v1/auth/login')
        .send({ email: DEMO_ACCOUNTS.admin, password: DEMO_PASSWORD });

      const setCookie = response.headers['set-cookie'] as unknown as string[];

      expect(setCookie[0]).toContain('hr_refresh_token=');
      expect(setCookie[0]).toContain('HttpOnly');
      expect(JSON.stringify(response.body)).not.toContain('refreshToken');
    });

    it('rejects an invalid password with 401 (§14)', async () => {
      const result = await login(DEMO_ACCOUNTS.admin, 'WrongPassword1');

      expect(result.status).toBe(401);
      expect(result.body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns an identical message for unknown email (no user enumeration)', async () => {
      const unknown = await login('nobody@harviktech.com');
      const wrongPassword = await login(DEMO_ACCOUNTS.admin, 'WrongPassword1');

      expect(unknown.status).toBe(wrongPassword.status);
      expect(unknown.body.error?.message).toBe(wrongPassword.body.error?.message);
    });

    it('normalises the email case', async () => {
      const result = await login('ADMIN@HARVIKTECH.COM');

      expect(result.status).toBe(200);
    });

    it('validates the request body', async () => {
      const bad = await request(getApp()).post('/api/v1/auth/login').send({ email: 'nope' });

      expect(bad.status).toBe(400);
      expect(bad.body.error?.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(bad.body.error?.details)).toBe(true);
    });

    it('refuses a disabled account', async () => {
      await User.updateOne({ email: DEMO_ACCOUNTS.employee }, { $set: { isActive: false } });

      const result = await login(DEMO_ACCOUNTS.employee);

      expect(result.status).toBe(403);
      expect(result.body.error?.code).toBe('FORBIDDEN');

      await User.updateOne({ email: DEMO_ACCOUNTS.employee }, { $set: { isActive: true } });
    });
  });

  describe('access token', () => {
    it('authenticates /me', async () => {
      const session = await loginAs(DEMO_ACCOUNTS.hrManager);

      const response = await request(getApp())
        .get('/api/v1/auth/me')
        .set(...bearer(session.accessToken));

      expect(response.status).toBe(200);
      expect(response.body.data.role).toBe('HR Manager');
      expect(response.body.data.email).toBe(DEMO_ACCOUNTS.hrManager);
    });

    it('exposes the permission list so the UI can hide what it may not do', async () => {
      const session = await loginAs(DEMO_ACCOUNTS.employee);

      const response = await request(getApp())
        .get('/api/v1/auth/me')
        .set(...bearer(session.accessToken));

      expect(response.body.data.permissions).toEqual([]);
    });

    it('never exposes the password hash', async () => {
      const session = await loginAs(DEMO_ACCOUNTS.admin);

      const response = await request(getApp())
        .get('/api/v1/auth/me')
        .set(...bearer(session.accessToken));

      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(response.body.data).not.toHaveProperty('password');
    });

    it('rejects a missing token with 401 (§14)', async () => {
      const response = await request(getApp()).get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error?.code).toBe('UNAUTHORIZED');
    });

    it('rejects a malformed or forged token with 401', async () => {
      for (const token of ['not-a-jwt', 'a.b.c', `${'x'.repeat(20)}.y.z`]) {
        const response = await request(getApp())
          .get('/api/v1/auth/me')
          .set(...bearer(token));

        expect(response.status).toBe(401);
      }
    });

    it('rejects a token signed with the wrong secret', async () => {
      const jwt = await import('jsonwebtoken');
      const forged = jwt.default.sign(
        { role: 'HR Admin', employeeId: null, typ: 'access' },
        'attacker-secret-that-is-long-enough-to-be-accepted-01',
        { subject: '507f1f77bcf86cd799439011', expiresIn: '15m' },
      );

      const response = await request(getApp())
        .get('/api/v1/auth/me')
        .set(...bearer(forged));

      expect(response.status).toBe(401);
    });

    it('stops honouring a token as soon as the login is disabled (§8.10)', async () => {
      const session = await loginAs(DEMO_ACCOUNTS.manager);

      const before = await request(getApp())
        .get('/api/v1/auth/me')
        .set(...bearer(session.accessToken));
      expect(before.status).toBe(200);

      await User.updateOne({ email: DEMO_ACCOUNTS.manager }, { $set: { isActive: false } });

      const after = await request(getApp())
        .get('/api/v1/auth/me')
        .set(...bearer(session.accessToken));
      expect(after.status).toBe(401);

      await User.updateOne({ email: DEMO_ACCOUNTS.manager }, { $set: { isActive: true } });
    });
  });

  describe('refresh token rotation (§6)', () => {
    it('issues a new pair and rejects the previous refresh token', async () => {
      const first = await login(DEMO_ACCOUNTS.admin);
      expect(first.status).toBe(200);

      const refreshed = await request(getApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', first.refreshCookie)
        .send({});

      expect(refreshed.status).toBe(200);
      expect(refreshed.body.data.accessToken).toEqual(expect.any(String));

      const replay = await request(getApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', first.refreshCookie)
        .send({});

      expect(replay.status).toBe(401);
    });

    it('stores only a hash of the refresh token (§6)', async () => {
      const result = await login(DEMO_ACCOUNTS.hrManager);
      const rawToken = result.refreshCookie.split('=')[1] ?? '';

      const user = await User.findOne({ email: DEMO_ACCOUNTS.hrManager })
        .select('+refreshTokenHash +refreshTokenExpiresAt')
        .exec();

      expect(user?.refreshTokenHash).toEqual(expect.any(String));
      expect(user?.refreshTokenHash).not.toBe(rawToken);
      expect(user?.refreshTokenHash).not.toContain(rawToken);
      expect(user?.refreshTokenExpiresAt).toBeInstanceOf(Date);
    });

    it('rejects a refresh with no session', async () => {
      const response = await request(getApp()).post('/api/v1/auth/refresh').send({});

      expect(response.status).toBe(401);
    });

    it('rejects a random refresh token', async () => {
      const response = await request(getApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'hr_refresh_token=completely-made-up-token-value')
        .send({});

      expect(response.status).toBe(401);
    });
  });

  describe('logout (§14 "logout invalidates refresh session")', () => {
    it('invalidates the refresh token so it cannot be replayed', async () => {
      const session = await loginAs(DEMO_ACCOUNTS.admin);

      const logout = await request(getApp())
        .post('/api/v1/auth/logout')
        .set('Cookie', session.refreshCookie)
        .send({});

      expect(logout.status).toBe(204);

      const replay = await request(getApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', session.refreshCookie)
        .send({});

      expect(replay.status).toBe(401);
    });

    it('clears the refresh cookie', async () => {
      const session = await loginAs(DEMO_ACCOUNTS.hrManager);

      const response = await request(getApp())
        .post('/api/v1/auth/logout')
        .set('Cookie', session.refreshCookie)
        .send({});

      const setCookie = (response.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(setCookie.join(';')).toContain('hr_refresh_token=;');
    });

    it('is safe to call without a session', async () => {
      const response = await request(getApp()).post('/api/v1/auth/logout').send({});

      expect(response.status).toBe(204);
    });
  });

  describe('change password', () => {
    it('enforces the §6 password policy', async () => {
      const session = await loginAs(DEMO_ACCOUNTS.employee);

      for (const weak of ['short1', 'nodigitshere', '12345678']) {
        const response = await request(getApp())
          .post('/api/v1/auth/change-password')
          .set(...bearer(session.accessToken))
          .send({ currentPassword: DEMO_PASSWORD, newPassword: weak });

        expect(response.status, `expected ${weak} to be rejected`).toBe(400);
      }
    });

    it('changes the password and invalidates the current session', async () => {
      const session = await loginAs(DEMO_ACCOUNTS.employee);

      const changed = await request(getApp())
        .post('/api/v1/auth/change-password')
        .set(...bearer(session.accessToken))
        .send({ currentPassword: DEMO_PASSWORD, newPassword: 'N3wPassword!' });

      expect(changed.status).toBe(200);

      // Old refresh token no longer works.
      const replay = await request(getApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', session.refreshCookie)
        .send({});
      expect(replay.status).toBe(401);

      // Old password no longer works.
      const oldPassword = await login(DEMO_ACCOUNTS.employee, DEMO_PASSWORD);
      expect(oldPassword.status).toBe(401);

      const newPassword = await login(DEMO_ACCOUNTS.employee, 'N3wPassword!');
      expect(newPassword.status).toBe(200);

      // Restore so the rest of the suite is unaffected.
      const admin = await loginAs(DEMO_ACCOUNTS.admin);
      await request(getApp())
        .post('/api/v1/auth/change-password')
        .set(...bearer(admin.accessToken))
        .send({});

      // Reset the employee password directly to the documented demo value.
      const { hashPassword } = await import('../../src/modules/auth/auth.service');
      await User.updateOne(
        { email: DEMO_ACCOUNTS.employee },
        { $set: { passwordHash: await hashPassword(DEMO_PASSWORD) } },
      );
    });

    it('rejects an incorrect current password', async () => {
      const session = await loginAs(DEMO_ACCOUNTS.hrManager);

      const response = await request(getApp())
        .post('/api/v1/auth/change-password')
        .set(...bearer(session.accessToken))
        .send({ currentPassword: 'NotMyPassword1', newPassword: 'N3wPassword!' });

      expect(response.status).toBe(401);
    });
  });

  describe('audit trail (§6)', () => {
    it('records sign-in, sign-out and refresh events', async () => {
      await AuditLog.deleteMany({});
      await flushRedis();

      const session = await loginAs(DEMO_ACCOUNTS.admin);

      const refreshed = await request(getApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', session.refreshCookie)
        .send({});

      expect(refreshed.status).toBe(200);

      // §6 rotation: logout must present the *rotated* cookie. The pre-refresh
      // token is already denylisted, so reusing it would be a no-op here.
      const rotated = refreshed.headers['set-cookie'];
      const rotatedRaw = Array.isArray(rotated) ? rotated.join('; ') : (rotated ?? '');

      const loggedOut = await request(getApp())
        .post('/api/v1/auth/logout')
        .set('Cookie', rotatedRaw.split(';')[0] ?? '')
        .send({});

      expect(loggedOut.status).toBe(204);

      const actions = (await AuditLog.find({ entityType: 'User' }).lean().exec()).map(
        (entry) => entry.action,
      );

      expect(actions).toContain('auth.login');
      expect(actions).toContain('auth.refresh');
      expect(actions).toContain('auth.logout');
    });

    it('records failed sign-ins', async () => {
      await AuditLog.deleteMany({});

      await login(DEMO_ACCOUNTS.admin, 'DefinitelyWrong1');

      const entry = await AuditLog.findOne({ action: 'auth.login.failed' }).lean().exec();

      expect(entry).not.toBeNull();
      expect(entry?.at).toBeInstanceOf(Date);
    });

    it('never stores credentials in the audit trail (§2.16)', async () => {
      await AuditLog.deleteMany({});

      await loginAs(DEMO_ACCOUNTS.hrManager);

      const serialised = JSON.stringify(await AuditLog.find({}).lean().exec());

      expect(serialised).not.toContain(DEMO_PASSWORD);
      expect(serialised).not.toContain('passwordHash');
      expect(serialised).not.toContain('$2b$');
    });
  });
});