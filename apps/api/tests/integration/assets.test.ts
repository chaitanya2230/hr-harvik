import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Asset, AssetAssignment } from '../../src/modules/assets/asset.model';
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
import { SEEDED, daysFromToday, employeeIdByEmail } from '../support/employee-fixtures';

/**
 * AGENTS.md §14 ASSETS acceptance cases.
 *
 * Unique serials per test keep the file order-independent after the single
 * `beforeAll` seed.
 */

const app = getApp();

let admin: Session;
let hrManager: Session;
let manager: Session;
let employee: Session;

let serialCounter = 0;
const uniqueSerial = (prefix = 'SN-TEST'): string => {
  serialCounter += 1;
  return `${prefix}-${Date.now()}-${serialCounter}`;
};

const baseCreateBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Test Laptop',
  type: 'Laptop',
  brand: 'TestBrand',
  serialNumber: uniqueSerial(),
  purchaseDate: '2024-01-15',
  purchaseCost: 80000,
  ...overrides,
});

const authAs = {
  admin: () => bearer(admin.accessToken),
  hrManager: () => bearer(hrManager.accessToken),
  manager: () => bearer(manager.accessToken),
  employee: () => bearer(employee.accessToken),
};

async function createAsset(body: Record<string, unknown> = {}): Promise<{ id: string; assetCode: string }> {
  const response = await request(app)
    .post('/api/v1/assets')
    .set(...authAs.admin())
    .send(baseCreateBody(body));
  expect(response.status, `create failed: ${JSON.stringify(response.body)}`).toBe(201);
  return { id: response.body.data.id as string, assetCode: response.body.data.assetCode as string };
}

/** Create an employee and relieve them through the valid status path. */
async function createRelievedEmployee(): Promise<string> {
  const email = `relieved.${Date.now()}.${Math.random().toString(36).slice(2)}@harviktech.com`;
  const created = await request(app)
    .post('/api/v1/employees')
    .set(...authAs.admin())
    .send({
      firstName: 'Relieved',
      lastName: 'Test',
      email,
      employmentType: 'Full-Time',
      dateOfJoining: daysFromToday(-100),
    });
  const id = created.body.data.id as string;
  await request(app).post(`/api/v1/employees/${id}/status`).set(...authAs.admin()).send({ status: 'On Notice' });
  const relieved = await request(app)
    .post(`/api/v1/employees/${id}/status`)
    .set(...authAs.admin())
    .send({ status: 'Relieved', reason: 'test contract ended' });
  expect(relieved.status).toBe(200);
  return id;
}

describe('assets (§8.8, §14)', () => {
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
    it('creates an asset with a generated AST-#### code', async () => {
      const response = await request(app)
        .post('/api/v1/assets')
        .set(...authAs.admin())
        .send(baseCreateBody());

      expect(response.status).toBe(201);
      expect(response.body.data.assetCode).toMatch(/^AST-\d{4,}$/);
      expect(response.body.data.status).toBe('Available');
    });

    it('rejects a duplicate serial number', async () => {
      const serial = uniqueSerial('DUP');
      const first = await request(app)
        .post('/api/v1/assets')
        .set(...authAs.admin())
        .send(baseCreateBody({ serialNumber: serial }));
      expect(first.status).toBe(201);

      const second = await request(app)
        .post('/api/v1/assets')
        .set(...authAs.admin())
        .send(baseCreateBody({ serialNumber: serial }));
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('CONFLICT');
    });

    it('rejects a negative purchase cost', async () => {
      const response = await request(app)
        .post('/api/v1/assets')
        .set(...authAs.admin())
        .send(baseCreateBody({ purchaseCost: -50 }));
      expect(response.status).toBe(400);
    });

    it('accepts asset types outside the §7 list without code changes (configurable types)', async () => {
      const response = await request(app)
        .post('/api/v1/assets')
        .set(...authAs.admin())
        .send(baseCreateBody({ type: 'Tablet' }));
      expect(response.status).toBe(201);
      expect(response.body.data.type).toBe('Tablet');
    });

    it('edits descriptive fields and keeps the code stable', async () => {
      const { id, assetCode } = await createAsset();
      const response = await request(app)
        .patch(`/api/v1/assets/${id}`)
        .set(...authAs.admin())
        .send({ name: 'Renamed Laptop', condition: 'Good' });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Renamed Laptop');
      expect(response.body.data.assetCode).toBe(assetCode);
    });

    it('rejects unauthenticated access with 401', async () => {
      expect((await request(app).get('/api/v1/assets')).status).toBe(401);
      expect((await request(app).post('/api/v1/assets').send(baseCreateBody())).status).toBe(401);
    });

    it('rejects Manager and Employee inventory access with 403', async () => {
      for (const as of [authAs.manager(), authAs.employee()]) {
        expect((await request(app).get('/api/v1/assets').set(...as)).status).toBe(403);
        expect(
          (await request(app).post('/api/v1/assets').set(...as).send(baseCreateBody())).status,
        ).toBe(403);
      }
    });

    it('lets HR Manager manage the inventory', async () => {
      const response = await request(app)
        .post('/api/v1/assets')
        .set(...authAs.hrManager())
        .send(baseCreateBody());
      expect(response.status).toBe(201);
    });
  });

  describe('list / search / filter', () => {
    it('lists seeded assets with pagination meta', async () => {
      const response = await request(app)
        .get('/api/v1/assets?page=1&limit=10')
        .set(...authAs.admin());

      expect(response.status).toBe(200);
      expect(response.body.meta).toMatchObject({ page: 1, limit: 10 });
      expect(response.body.meta.total).toBeGreaterThanOrEqual(30);
    });

    it('searches and filters by type and status', async () => {
      const search = await request(app)
        .get('/api/v1/assets?q=MacBook')
        .set(...authAs.admin());
      expect(search.status).toBe(200);
      expect(search.body.data.length).toBeGreaterThan(0);

      const laptops = await request(app)
        .get('/api/v1/assets?type=Laptop')
        .set(...authAs.admin());
      for (const row of laptops.body.data) expect(row.type).toBe('Laptop');

      const available = await request(app)
        .get('/api/v1/assets?status=Available')
        .set(...authAs.admin());
      for (const row of available.body.data) expect(row.status).toBe('Available');
    });
  });

  describe('assign / return', () => {
    it('assigns an asset and flips it to Assigned', async () => {
      const { id } = await createAsset();
      const employeeId = await employeeIdByEmail(SEEDED.seniorEngineer);

      const response = await request(app)
        .post(`/api/v1/assets/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId });

      expect(response.status).toBe(201);
      expect(response.body.data.employee.id).toBe(employeeId);

      const asset = await request(app).get(`/api/v1/assets/${id}`).set(...authAs.admin());
      expect(asset.body.data.status).toBe('Assigned');
      expect(asset.body.data.activeAssignment.employee.id).toBe(employeeId);
    });

    it('rejects assigning an already-assigned asset', async () => {
      const { id } = await createAsset();
      const first = await employeeIdByEmail(SEEDED.seniorEngineer);
      const second = await employeeIdByEmail(SEEDED.softwareEngineer);

      const ok = await request(app)
        .post(`/api/v1/assets/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: first });
      expect(ok.status).toBe(201);

      const again = await request(app)
        .post(`/api/v1/assets/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: second });
      expect([409, 422]).toContain(again.status);
    });

    it('rejects assigning Lost / Damaged / Retired / Under Repair assets', async () => {
      for (const serial of ['SN-OMB-026', 'SN-CDM-027', 'SN-RTP-028', 'SN-LLM-029']) {
        const found = await Asset.findOne({ serialNumber: serial }).select('_id').lean().exec();
        const response = await request(app)
          .post(`/api/v1/assets/${found?._id}/assign`)
          .set(...authAs.admin())
          .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) });
        expect(response.status, serial).toBe(422);
      }
    });

    it('rejects assigning to a Relieved employee', async () => {
      const { id } = await createAsset();
      const relievedId = await createRelievedEmployee();

      const response = await request(app)
        .post(`/api/v1/assets/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: relievedId });
      expect(response.status).toBe(422);
    });

    it('allows exactly one winner in a concurrent assignment race', async () => {
      const { id } = await createAsset();
      const candidates = [
        SEEDED.seniorEngineer,
        SEEDED.softwareEngineer,
        SEEDED.contractor,
        SEEDED.productDesigner,
        SEEDED.financeAnalyst,
      ];
      const ids = await Promise.all(candidates.map((email) => employeeIdByEmail(email)));

      const results = await Promise.all(
        ids.map((employeeId) =>
          request(app).post(`/api/v1/assets/${id}/assign`).set(...authAs.admin()).send({ employeeId }),
        ),
      );

      const winners = results.filter((r) => r.status === 201);
      expect(winners).toHaveLength(1);
      for (const loser of results.filter((r) => r.status !== 201)) {
        expect([409, 422]).toContain(loser.status);
      }

      const activeCount = await AssetAssignment.countDocuments({
        assetId: id,
        actualReturnDate: null,
      }).exec();
      expect(activeCount).toBe(1);
    });

    it('returns an asset and rests it at Returned, then repair walks it to Available', async () => {
      const { id } = await createAsset();
      const employeeId = await employeeIdByEmail(SEEDED.seniorEngineer);
      await request(app)
        .post(`/api/v1/assets/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId });

      const returned = await request(app)
        .post(`/api/v1/assets/${id}/return`)
        .set(...authAs.admin())
        .send({ conditionAtReturn: 'Good' });
      expect(returned.status).toBe(200);
      expect(returned.body.data.actualReturnDate).toBeTruthy();

      const asset = await request(app).get(`/api/v1/assets/${id}`).set(...authAs.admin());
      expect(asset.body.data.status).toBe('Returned');
      expect(asset.body.data.activeAssignment).toBeNull();

      const available = await request(app)
        .post(`/api/v1/assets/${id}/repair`)
        .set(...authAs.admin())
        .send({ status: 'Available' });
      expect(available.status).toBe(200);
      expect(available.body.data.status).toBe('Available');
    });

    it('rejects returning an asset with no active assignment', async () => {
      const { id } = await createAsset();
      const response = await request(app)
        .post(`/api/v1/assets/${id}/return`)
        .set(...authAs.admin())
        .send({});
      expect(response.status).toBe(422);
    });

    it('records an audit event on assign', async () => {
      const { id } = await createAsset();
      await request(app)
        .post(`/api/v1/assets/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) });

      const entry = await AuditLog.findOne({ action: 'asset.assigned' }).sort({ at: -1 }).lean().exec();
      expect(entry).toBeTruthy();
      expect(entry?.entityType).toBe('AssetAssignment');
    });
  });

  describe('repair / retire', () => {
    it('repair blocks assignment until the asset is Available again', async () => {
      const { id } = await createAsset();

      const underRepair = await request(app)
        .post(`/api/v1/assets/${id}/repair`)
        .set(...authAs.admin())
        .send({ status: 'Under Repair', notes: 'fan replacement' });
      expect(underRepair.status).toBe(200);

      const blocked = await request(app)
        .post(`/api/v1/assets/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) });
      expect(blocked.status).toBe(422);
    });

    it('rejects an invalid repair target', async () => {
      const { id } = await createAsset();
      const response = await request(app)
        .post(`/api/v1/assets/${id}/repair`)
        .set(...authAs.admin())
        .send({ status: 'Assigned' });
      expect(response.status).toBe(400);
    });

    it('treats Retired as terminal', async () => {
      const { id } = await createAsset();
      const retired = await request(app)
        .post(`/api/v1/assets/${id}/retire`)
        .set(...authAs.admin())
        .send({ reason: 'end of life' });
      expect(retired.status).toBe(200);
      expect(retired.body.data.status).toBe('Retired');

      expect(
        (
          await request(app)
            .post(`/api/v1/assets/${id}/assign`)
            .set(...authAs.admin())
            .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) })
        ).status,
      ).toBe(422);
      expect(
        (await request(app).post(`/api/v1/assets/${id}/repair`).set(...authAs.admin()).send({ status: 'Available' }))
          .status,
      ).toBe(422);
      expect(
        (await request(app).post(`/api/v1/assets/${id}/retire`).set(...authAs.admin()).send({})).status,
      ).toBe(422);
    });
  });

  describe('delete', () => {
    it('prevents deletion of an asset with assignment history', async () => {
      const { id } = await createAsset();
      await request(app)
        .post(`/api/v1/assets/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId: await employeeIdByEmail(SEEDED.seniorEngineer) });

      const response = await request(app).delete(`/api/v1/assets/${id}`).set(...authAs.admin());
      expect(response.status).toBe(409);
    });

    it('soft-deletes an asset with no history', async () => {
      const { id } = await createAsset();
      const response = await request(app).delete(`/api/v1/assets/${id}`).set(...authAs.admin());
      expect(response.status).toBe(204);

      const stored = await Asset.findById(id).lean().exec();
      expect(stored?.isDeleted).toBe(true);
    });

    it('rejects HR-Manager deletion only if forbidden — HR Manager may delete assets', async () => {
      const { id } = await createAsset();
      const response = await request(app).delete(`/api/v1/assets/${id}`).set(...authAs.hrManager());
      // §6 restricts employee deletion only; asset deletion is an HR operation.
      expect(response.status).toBe(204);
    });
  });

  describe('overdue + self-service', () => {
    it('filters overdue assignments', async () => {
      const { id } = await createAsset();
      const employeeId = await employeeIdByEmail(SEEDED.seniorEngineer);
      await request(app)
        .post(`/api/v1/assets/${id}/assign`)
        .set(...authAs.admin())
        .send({ employeeId, expectedReturnDate: daysFromToday(-5) });

      const overdue = await request(app)
        .get('/api/v1/assets/assignments?overdue=true')
        .set(...authAs.admin());
      expect(overdue.status).toBe(200);
      expect(overdue.body.data.map((a: { id: string }) => a.asset.id)).toContain(id);

      const notOverdue = await request(app)
        .get('/api/v1/assets/assignments?overdue=false')
        .set(...authAs.admin());
      expect(notOverdue.body.data.map((a: { id: string }) => a.asset.id)).not.toContain(id);

      const overdueAssets = await request(app)
        .get('/api/v1/assets?overdue=true')
        .set(...authAs.admin());
      expect(overdueAssets.body.data.map((a: { id: string }) => a.id)).toContain(id);
    });

    it('scopes the assignment ledger: HR all, Manager team, Employee own', async () => {
      const hrAll = await request(app).get('/api/v1/assets/assignments').set(...authAs.admin());
      expect(hrAll.status).toBe(200);
      expect(hrAll.body.meta.total).toBeGreaterThan(0);

      const own = await request(app).get('/api/v1/assets/assignments').set(...authAs.employee());
      expect(own.status).toBe(200);
      const selfId = await employeeIdByEmail(SEEDED.softwareEngineer);
      for (const row of own.body.data) {
        expect(row.employee.id).toBe(selfId);
      }

      // Employee asking for someone else's ledger is refused.
      const other = await employeeIdByEmail(SEEDED.seniorEngineer);
      const refused = await request(app)
        .get(`/api/v1/assets/assignments?employeeId=${other}`)
        .set(...authAs.employee());
      expect(refused.status).toBe(403);
    });
  });
});
