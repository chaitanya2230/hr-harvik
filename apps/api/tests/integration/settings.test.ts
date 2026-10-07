import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { flushRedis } from '../setup/setup';
import {
  DEMO_ACCOUNTS,
  bearer,
  getApp,
  loginAs,
  seedDatabase,
  type Session,
} from '../support/helpers';
import { SystemSettings } from '../../src/modules/settings/settings.model';
import { resetSettingsCache } from '../../src/modules/settings/settings.service';
import { AuditLog } from '../../src/modules/audit/audit.model';

/**
 * AGENTS.md §6 "HR Admin → system settings", §8.2 "age >= 18 unless
 * configurable" + probation default, §9 `/settings` route, §14 foundation.
 *
 * The settings row is global, so every test starts from a clean slate
 * (no row → `.env` defaults) and the state is dropped again afterwards to
 * keep later suites (e.g. `employees.test` asserting the Probation default)
 * deterministic — `runSeed` intentionally does not wipe runtime settings.
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

const uniqueEmail = (prefix = 'settings'): string =>
  `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@harviktech.com`;

async function restoreSettingsDefaults(): Promise<void> {
  await SystemSettings.deleteMany({});
  resetSettingsCache();
}

describe('system settings (§6 manage settings, §8.2, §9)', () => {
  beforeAll(async () => {
    await restoreSettingsDefaults();
    await seedDatabase();
    admin = await loginAs(DEMO_ACCOUNTS.admin);
    hrManager = await loginAs(DEMO_ACCOUNTS.hrManager);
    manager = await loginAs(DEMO_ACCOUNTS.manager);
    employee = await loginAs(DEMO_ACCOUNTS.employee);
  });

  beforeEach(async () => {
    await flushRedis();
  });

  afterEach(async () => {
    await restoreSettingsDefaults();
  });

  it('rejects unauthenticated reads and writes with 401', async () => {
    const read = await request(app).get('/api/v1/settings');
    expect(read.status).toBe(401);

    const write = await request(app).patch('/api/v1/settings').send({ companyName: 'Nope' });
    expect(write.status).toBe(401);
  });

  it('exposes the documented defaults to every signed-in role (§9 /settings)', async () => {
    for (const as of [authAs.admin(), authAs.hrManager(), authAs.manager(), authAs.employee()]) {
      const res = await request(app).get('/api/v1/settings').set(...as);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        minAgeIntern: 16,
        minAgeOther: 18,
        probationDefault: true,
      });
      expect(typeof res.body.data.companyName).toBe('string');
      expect(typeof res.body.data.timezone).toBe('string');
    }
  });

  it('forbids writes for HR Manager, Manager and Employee with 403 (§6)', async () => {
    for (const as of [authAs.hrManager(), authAs.manager(), authAs.employee()]) {
      const res = await request(app)
        .patch('/api/v1/settings')
        .set(...as)
        .send({ companyName: 'Should not persist' });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    }

    const row = await SystemSettings.findOne({ key: 'system' }).lean();
    expect(row).toBeNull();
  });

  it('HR Admin can update settings; the change reads back immediately and is audited', async () => {
    const update = await request(app)
      .patch('/api/v1/settings')
      .set(...authAs.admin())
      .send({
        companyName: 'Harvik Test Industries',
        timezone: 'Asia/Tokyo',
        minAgeIntern: 17,
        minAgeOther: 19,
        probationDefault: false,
      });
    expect(update.status).toBe(200);
    expect(update.body.data).toMatchObject({
      companyName: 'Harvik Test Industries',
      timezone: 'Asia/Tokyo',
      minAgeIntern: 17,
      minAgeOther: 19,
      probationDefault: false,
    });

    // Read-back uses the cached row — the write must refresh it.
    const reread = await request(app).get('/api/v1/settings').set(...authAs.admin());
    expect(reread.status).toBe(200);
    expect(reread.body.data.companyName).toBe('Harvik Test Industries');

    const audit = await AuditLog.findOne({ action: 'settings.update' })
      .sort({ at: -1 })
      .lean()
      .exec();
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe('Settings');
    // The singleton row has no Mongo id, so `entityId` is null by audit-schema
    // design (`toObjectIdOrNull`); the diff itself lives in before/after.
    expect(audit?.entityId).toBeNull();
    expect((audit?.after as { companyName?: string } | null)?.companyName).toBe(
      'Harvik Test Industries',
    );
  });

  it('validates the payload: unknown fields, empty patches and bad timezones → 400', async () => {
    const unknownField = await request(app)
      .patch('/api/v1/settings')
      .set(...authAs.admin())
      .send({ secrets: 'never' });
    expect(unknownField.status).toBe(400);

    const empty = await request(app)
      .patch('/api/v1/settings')
      .set(...authAs.admin())
      .send({});
    expect(empty.status).toBe(400);

    const badTz = await request(app)
      .patch('/api/v1/settings')
      .set(...authAs.admin())
      .send({ timezone: 'Mars/Olympus_Mons' });
    expect(badTz.status).toBe(400);

    const badAge = await request(app)
      .patch('/api/v1/settings')
      .set(...authAs.admin())
      .send({ minAgeOther: 4 });
    expect(badAge.status).toBe(400);
  });

  it('drives employee creation rules: configurable min age and probation default (§8.2)', async () => {
    const update = await request(app)
      .patch('/api/v1/settings')
      .set(...authAs.admin())
      .send({ minAgeIntern: 30, probationDefault: false });
    expect(update.status).toBe(200);

    // A 16-year-old intern now falls below the configured minimum.
    const underAge = await request(app)
      .post('/api/v1/employees')
      .set(...authAs.admin())
      .send({
        firstName: 'Junior',
        lastName: 'Intern',
        email: uniqueEmail('underage'),
        employmentType: 'Intern',
        dateOfJoining: `${new Date().toISOString().slice(0, 10)}`,
        dob: '2010-01-01',
      });
    expect(underAge.status).toBe(422);

    // probationDefault=false → a Full-Time hire starts Active, not Probation.
    const fullTime = await request(app)
      .post('/api/v1/employees')
      .set(...authAs.admin())
      .send({
        firstName: 'Fresh',
        lastName: 'Hire',
        email: uniqueEmail('probation-off'),
        employmentType: 'Full-Time',
        dateOfJoining: `${new Date().toISOString().slice(0, 10)}`,
      });
    expect(fullTime.status).toBe(201);
    expect(fullTime.body.data.status).toBe('Active');
  });

  it('falls back to env defaults again once the row is removed', async () => {
    await restoreSettingsDefaults();
    const res = await request(app).get('/api/v1/settings').set(...authAs.employee());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ minAgeIntern: 16, probationDefault: true });
  });
});
