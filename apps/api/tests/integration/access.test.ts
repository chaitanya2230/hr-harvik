import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AuditLog } from '../../src/modules/audit/audit.model';
import { flushRedis } from '../setup/setup';
import {
  DEMO_ACCOUNTS,
  bearer,
  getApp,
  loginAs,
  seedDatabase,
  type Session,
} from '../support/helpers';
import { SEEDED, employeeIdByEmail } from '../support/employee-fixtures';

/**
 * AGENTS.md §7 Access Items acceptance (§14 LICENSES "access item creation").
 *
 * External accounts are manual records only — this suite proves the tracking,
 * never any external side effect.
 */

const app = getApp();

let admin: Session;
let manager: Session;
let employee: Session;

const authAs = {
  admin: () => bearer(admin.accessToken),
  manager: () => bearer(manager.accessToken),
  employee: () => bearer(employee.accessToken),
};

describe('access items (§7)', () => {
  beforeAll(async () => {
    await seedDatabase();
    admin = await loginAs(DEMO_ACCOUNTS.admin);
    manager = await loginAs(DEMO_ACCOUNTS.manager);
    employee = await loginAs(DEMO_ACCOUNTS.employee);
  });

  beforeEach(async () => {
    await flushRedis();
  });

  it('creates an access item for HR roles', async () => {
    const response = await request(app)
      .post('/api/v1/access')
      .set(...authAs.admin())
      .send({
        employeeId: await employeeIdByEmail(SEEDED.seniorEngineer),
        system: 'GitHub org',
        identifier: 'octo-rahul',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.system).toBe('GitHub org');
    expect(response.body.data.status).toBe('Active');
  });

  it('rejects creation for an unknown employee or a bad license link', async () => {
    const unknown = await request(app)
      .post('/api/v1/access')
      .set(...authAs.admin())
      .send({ employeeId: '000000000000000000000000', system: 'VPN' });
    expect(unknown.status).toBe(422);

    const badLink = await request(app)
      .post('/api/v1/access')
      .set(...authAs.admin())
      .send({
        employeeId: await employeeIdByEmail(SEEDED.seniorEngineer),
        system: 'Slack',
        linkedLicenseAssignmentId: '000000000000000000000000',
      });
    expect(badLink.status).toBe(409);
  });

  it('scopes reads: HR all, Employee own, outsiders refused', async () => {
    const all = await request(app).get('/api/v1/access').set(...authAs.admin());
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(4);

    const own = await request(app).get('/api/v1/access').set(...authAs.employee());
    expect(own.status).toBe(200);
    const selfId = await employeeIdByEmail(SEEDED.softwareEngineer);
    for (const row of own.body.data) {
      expect(row.employee.id).toBe(selfId);
    }

    const other = await employeeIdByEmail(SEEDED.seniorEngineer);
    expect(
      (await request(app).get(`/api/v1/access?employeeId=${other}`).set(...authAs.employee())).status,
    ).toBe(403);
  });

  it('revokes and rejects a duplicate revoke with 409', async () => {
    const created = await request(app)
      .post('/api/v1/access')
      .set(...authAs.admin())
      .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer), system: 'Test VPN' });

    expect(
      (await request(app).post(`/api/v1/access/${created.body.data.id}/revoke`).set(...authAs.admin())).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v1/access/${created.body.data.id}/revoke`)
          .set(...authAs.admin())
      ).status,
    ).toBe(409);
  });

  it('rejects unauthenticated access with 401 and Employee writes with 403', async () => {
    expect((await request(app).get('/api/v1/access')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/access')
          .set(...authAs.employee())
          .send({ employeeId: await employeeIdByEmail(SEEDED.softwareEngineer), system: 'VPN' })
      ).status,
    ).toBe(403);
  });

  it('records an audit event on revoke', async () => {
    const created = await request(app)
      .post('/api/v1/access')
      .set(...authAs.admin())
      .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer), system: 'Audit VPN' });
    await request(app).post(`/api/v1/access/${created.body.data.id}/revoke`).set(...authAs.admin());

    const entry = await AuditLog.findOne({ action: 'access.revoked' }).sort({ at: -1 }).lean().exec();
    expect(entry?.entityType).toBe('AccessItem');
  });
});
