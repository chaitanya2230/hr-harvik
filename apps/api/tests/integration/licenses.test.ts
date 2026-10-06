import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { License } from '../../src/modules/licenses/license.model';
import { AuditLog } from '../../src/modules/audit/audit.model';
import { decryptField } from '../../src/utils/crypto';
import { flushRedis } from '../setup/setup';
import {
  DEMO_ACCOUNTS,
  bearer,
  getApp,
  loginAs,
  seedDatabase,
  type Session,
} from '../support/helpers';
import { SEEDED, daysFromToday, employeeIdByEmail } from '../support/employee-fixtures';

/**
 * AGENTS.md §14 LICENSES acceptance cases.
 */

const app = getApp();

let admin: Session;
let hrManager: Session;
let manager: Session;
let employee: Session;

let licenseCounter = 0;
const uniqueSoftware = (prefix = 'TestSoft'): string => {
  licenseCounter += 1;
  return `${prefix} ${Date.now()}-${licenseCounter}`;
};

const baseCreateBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  softwareName: uniqueSoftware(),
  licenseType: 'Per-Seat',
  provider: 'TestVendor',
  maxSeats: 5,
  startDate: '2024-01-01',
  renewalDate: daysFromToday(300),
  ...overrides,
});

const authAs = {
  admin: () => bearer(admin.accessToken),
  hrManager: () => bearer(hrManager.accessToken),
  manager: () => bearer(manager.accessToken),
  employee: () => bearer(employee.accessToken),
};

async function createLicense(body: Record<string, unknown> = {}): Promise<{ id: string; licenseCode: string }> {
  const response = await request(app)
    .post('/api/v1/licenses')
    .set(...authAs.admin())
    .send(baseCreateBody(body));
  expect(response.status, `create failed: ${JSON.stringify(response.body)}`).toBe(201);
  return { id: response.body.data.id as string, licenseCode: response.body.data.licenseCode as string };
}

async function createRelievedEmployee(): Promise<string> {
  const email = `lic-relieved.${Date.now()}.${Math.random().toString(36).slice(2)}@harviktech.com`;
  const created = await request(app)
    .post('/api/v1/employees')
    .set(...authAs.admin())
    .send({
      firstName: 'LicRelieved',
      lastName: 'Test',
      email,
      employmentType: 'Full-Time',
      dateOfJoining: daysFromToday(-100),
    });
  const id = created.body.data.id as string;
  await request(app).post(`/api/v1/employees/${id}/status`).set(...authAs.admin()).send({ status: 'On Notice' });
  await request(app)
    .post(`/api/v1/employees/${id}/status`)
    .set(...authAs.admin())
    .send({ status: 'Relieved', reason: 'test' });
  return id;
}

describe('licenses (§8.9, §14)', () => {
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

  describe('create / edit', () => {
    it('creates a license with a generated LIC-#### code', async () => {
      const response = await request(app)
        .post('/api/v1/licenses')
        .set(...authAs.admin())
        .send(baseCreateBody());

      expect(response.status).toBe(201);
      expect(response.body.data.licenseCode).toMatch(/^LIC-\d{4,}$/);
      expect(response.body.data.status).toBe('Available');
      expect(response.body.data.usedSeats).toBe(0);
    });

    it('rejects invalid seat counts', async () => {
      const response = await request(app)
        .post('/api/v1/licenses')
        .set(...authAs.admin())
        .send(baseCreateBody({ maxSeats: 0 }));
      expect(response.status).toBe(400);
    });

    it('rejects a renewal date on or before the start date', async () => {
      const response = await request(app)
        .post('/api/v1/licenses')
        .set(...authAs.admin())
        .send(baseCreateBody({ startDate: '2024-06-01', renewalDate: '2024-06-01' }));
      expect(response.status).toBe(400);
    });

    it('accepts license types outside the §7 list (configurable without code changes)', async () => {
      const response = await request(app)
        .post('/api/v1/licenses')
        .set(...authAs.admin())
        .send(baseCreateBody({ licenseType: 'Concurrent-Floating' }));
      expect(response.status).toBe(201);
    });

    it('rejects shrinking maxSeats below seats in use', async () => {
      const { id } = await createLicense({ maxSeats: 2 });
      const rahul = await employeeIdByEmail(SEEDED.seniorEngineer);
      const sneha = await employeeIdByEmail(SEEDED.softwareEngineer);
      await request(app).post(`/api/v1/licenses/${id}/assign`).set(...authAs.admin()).send({ employeeId: rahul });
      await request(app).post(`/api/v1/licenses/${id}/assign`).set(...authAs.admin()).send({ employeeId: sneha });

      const response = await request(app)
        .patch(`/api/v1/licenses/${id}`)
        .set(...authAs.admin())
        .send({ maxSeats: 1 });
      expect(response.status).toBe(422);
    });

    it('rejects unauthenticated access with 401', async () => {
      expect((await request(app).get('/api/v1/licenses')).status).toBe(401);
    });

    it('rejects Manager and Employee inventory access with 403', async () => {
      for (const as of [authAs.manager(), authAs.employee()]) {
        expect((await request(app).get('/api/v1/licenses').set(...as)).status).toBe(403);
      }
    });
  });

  describe('assign / revoke', () => {
    it('assigning consumes a seat (usedSeats + availableSeats math)', async () => {
      const { id } = await createLicense({ maxSeats: 3 });
      const response = await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) });

      expect(response.status).toBe(201);

      const license = await request(app).get(`/api/v1/licenses/${id}`).set(...authAs.admin());
      expect(license.body.data.usedSeats).toBe(1);
      expect(license.body.data.availableSeats).toBe(2);
    });

    it('rejects assignment when no seats remain with 409', async () => {
      const { id } = await createLicense({ maxSeats: 1 });
      const first = await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) });
      expect(first.status).toBe(201);

      const full = await request(app).get(`/api/v1/licenses/${id}`).set(...authAs.admin());
      expect(full.body.data.status).toBe('Assigned');

      const second = await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.softwareEngineer) });
      expect(second.status).toBe(409);
    });

    it('rejects a duplicate active assignment with 409', async () => {
      const { id } = await createLicense({ maxSeats: 5 });
      const employeeId = await employeeIdByEmail(SEEDED.seniorEngineer);
      expect(
        (await request(app).post(`/api/v1/licenses/${id}/assign`).set(...authAs.admin()).send({ employeeId })).status,
      ).toBe(201);
      const again = await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId });
      expect(again.status).toBe(409);
    });

    it('allows exactly one winner in a last-seat race', async () => {
      const { id } = await createLicense({ maxSeats: 1 });
      const ids = await Promise.all(
        [SEEDED.seniorEngineer, SEEDED.softwareEngineer, SEEDED.contractor].map((email) =>
          employeeIdByEmail(email),
        ),
      );

      const results = await Promise.all(
        ids.map((employeeId) =>
          request(app).post(`/api/v1/licenses/${id}/assign`).set(...authAs.admin()).send({ employeeId }),
        ),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      for (const loser of results.filter((r) => r.status !== 201)) {
        expect(loser.status).toBe(409);
      }

      const license = await License.findById(id).lean().exec();
      expect(license?.usedSeats).toBe(1);
    });

    it('blocks assignment to expired, suspended and revoked licenses', async () => {
      const employeeId = await employeeIdByEmail(SEEDED.seniorEngineer);

      // Expired: past renewal date.
      const expired = await createLicense({ renewalDate: daysFromToday(-10) });
      expect(
        (
          await request(app)
            .post(`/api/v1/licenses/${expired.id}/assign`)
            .set(...authAs.admin())
            .send({ employeeId })
        ).status,
      ).toBe(422);

      // Suspended via the suspend operation.
      const suspended = await createLicense({});
      await request(app).post(`/api/v1/licenses/${suspended.id}/suspend`).set(...authAs.admin()).send({ suspend: true });
      expect(
        (
          await request(app)
            .post(`/api/v1/licenses/${suspended.id}/assign`)
            .set(...authAs.admin())
            .send({ employeeId })
        ).status,
      ).toBe(422);

      // Revoked via the license-level revoke.
      const revoked = await createLicense({});
      await request(app).post(`/api/v1/licenses/${revoked.id}/revoke`).set(...authAs.admin()).send({});
      expect(
        (
          await request(app)
            .post(`/api/v1/licenses/${revoked.id}/assign`)
            .set(...authAs.admin())
            .send({ employeeId })
        ).status,
      ).toBe(422);
    });

    it('rejects assignment to a Relieved employee', async () => {
      const { id } = await createLicense({});
      const response = await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await createRelievedEmployee() });
      expect(response.status).toBe(422);
    });

    it('revoking releases the seat and reopening flips a full license back', async () => {
      const { id } = await createLicense({ maxSeats: 1 });
      const employeeId = await employeeIdByEmail(SEEDED.seniorEngineer);
      const assigned = await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId });
      expect((await request(app).get(`/api/v1/licenses/${id}`).set(...authAs.admin())).body.data.status).toBe(
        'Assigned',
      );

      const revoked = await request(app)
        .post(`/api/v1/licenses/assignments/${assigned.body.data.id}/revoke`)
        .set(...authAs.admin())
        .send({ revocationNote: 'laptop collected' });
      expect(revoked.status).toBe(200);
      expect(revoked.body.data.status).toBe('Revoked');

      const license = await request(app).get(`/api/v1/licenses/${id}`).set(...authAs.admin());
      expect(license.body.data.usedSeats).toBe(0);
      expect(license.body.data.availableSeats).toBe(1);
      expect(license.body.data.status).toBe('Available');
    });

    it('rejects a duplicate revoke with 409', async () => {
      const { id } = await createLicense({});
      const assigned = await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) });

      expect(
        (
          await request(app)
            .post(`/api/v1/licenses/assignments/${assigned.body.data.id}/revoke`)
            .set(...authAs.admin())
            .send({})
        ).status,
      ).toBe(200);
      const again = await request(app)
        .post(`/api/v1/licenses/assignments/${assigned.body.data.id}/revoke`)
        .set(...authAs.admin())
        .send({});
      expect(again.status).toBe(409);
    });

    it('records an audit event on assign', async () => {
      const { id } = await createLicense({});
      await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) });

      const entry = await AuditLog.findOne({ action: 'license.assigned' }).sort({ at: -1 }).lean().exec();
      expect(entry?.entityType).toBe('LicenseAssignment');
    });
  });

  describe('renew / suspend / expire', () => {
    it('renewal recalculates an Expired license back to Available', async () => {
      const { id } = await createLicense({ renewalDate: daysFromToday(-30) });
      await request(app).post(`/api/v1/licenses/${id}/expire`).set(...authAs.admin()).send({});
      expect((await request(app).get(`/api/v1/licenses/${id}`).set(...authAs.admin())).body.data.status).toBe(
        'Expired',
      );

      const renewed = await request(app)
        .post(`/api/v1/licenses/${id}/renew`)
        .set(...authAs.admin())
        .send({ renewalDate: daysFromToday(365) });
      expect(renewed.status).toBe(200);
      expect(renewed.body.data.status).toBe('Available');
      expect(renewed.body.data.renewalDate).toBe(daysFromToday(365));
    });

    it('rejects a non-future renewal date', async () => {
      const { id } = await createLicense({});
      const response = await request(app)
        .post(`/api/v1/licenses/${id}/renew`)
        .set(...authAs.admin())
        .send({ renewalDate: daysFromToday(-1) });
      expect(response.status).toBe(422);
    });

    it('suspends and reactivates explicitly', async () => {
      const { id } = await createLicense({});
      const suspended = await request(app)
        .post(`/api/v1/licenses/${id}/suspend`)
        .set(...authAs.admin())
        .send({ suspend: true });
      expect(suspended.body.data.status).toBe('Suspended');

      const active = await request(app)
        .post(`/api/v1/licenses/${id}/suspend`)
        .set(...authAs.admin())
        .send({ suspend: false });
      expect(active.body.data.status).toBe('Available');
    });
  });

  describe('license keys', () => {
    it('never exposes key values in list or detail responses', async () => {
      const { id } = await createLicense({ licenseKey: 'super-secret-key-123' });

      const list = await request(app).get('/api/v1/licenses').set(...authAs.admin());
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toContain('super-secret-key-123');
      expect(JSON.stringify(list.body)).not.toContain('licenseKeyRef');

      const stored = await License.findById(id).select('+licenseKeyRef').lean().exec();
      expect(stored?.licenseKeyRef).toBeTruthy();
      expect(decryptField(stored?.licenseKeyRef as string)).toContain('super-secret-key-123');
    });

    it('reveals the key to HR Admin only, and audits the reveal', async () => {
      const { id } = await createLicense({ licenseKey: 'reveal-me-456' });

      const revealed = await request(app).get(`/api/v1/licenses/${id}/key`).set(...authAs.admin());
      expect(revealed.status).toBe(200);
      expect(revealed.body.data.licenseKey).toBe('reveal-me-456');

      const entry = await AuditLog.findOne({ action: 'license.key_revealed' })
        .sort({ at: -1 })
        .lean()
        .exec();
      expect(entry).toBeTruthy();
      expect(JSON.stringify(entry)).not.toContain('reveal-me-456');

      expect((await request(app).get(`/api/v1/licenses/${id}/key`).set(...authAs.hrManager())).status).toBe(403);
      expect((await request(app).get(`/api/v1/licenses/${id}/key`).set(...authAs.employee())).status).toBe(403);
    });

    it('returns 404 when no key is stored', async () => {
      const { id } = await createLicense({});
      expect((await request(app).get(`/api/v1/licenses/${id}/key`).set(...authAs.admin())).status).toBe(404);
    });
  });

  describe('utilization + self-service + delete', () => {
    it('reports utilization math', async () => {
      const { id } = await createLicense({ maxSeats: 10 });
      await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) });
      await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.softwareEngineer) });

      const utilization = await request(app)
        .get(`/api/v1/licenses/${id}/utilization`)
        .set(...authAs.admin());
      expect(utilization.status).toBe(200);
      expect(utilization.body.data).toMatchObject({
        maxSeats: 10,
        usedSeats: 2,
        availableSeats: 8,
        utilizationPct: 20,
        activeAssignments: 2,
      });
    });

    it('lets an employee see only their own licenses', async () => {
      const own = await request(app).get('/api/v1/licenses/assignments').set(...authAs.employee());
      expect(own.status).toBe(200);
      const selfId = await employeeIdByEmail(SEEDED.softwareEngineer);
      for (const row of own.body.data) {
        expect(row.employee.id).toBe(selfId);
      }

      const other = await employeeIdByEmail(SEEDED.seniorEngineer);
      expect(
        (await request(app).get(`/api/v1/licenses/assignments?employeeId=${other}`).set(...authAs.employee())).status,
      ).toBe(403);
    });

    it('prevents deletion of a license with assignment history, soft-deletes a fresh one', async () => {
      const { id } = await createLicense({});
      await request(app)
        .post(`/api/v1/licenses/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) });
      expect((await request(app).delete(`/api/v1/licenses/${id}`).set(...authAs.admin())).status).toBe(409);

      const fresh = await createLicense({});
      expect((await request(app).delete(`/api/v1/licenses/${fresh.id}`).set(...authAs.admin())).status).toBe(204);
      expect((await License.findById(fresh.id).lean().exec())?.isDeleted).toBe(true);
    });
  });
});
