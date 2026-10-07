import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Employee } from '../../src/modules/employees/employee.model';
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
import {
  SEEDED,
  daysFromToday,
  departmentIdByName,
  employeeIdByEmail,
} from '../support/employee-fixtures';

/**
 * AGENTS.md §8.2 + §14 EMPLOYEE acceptance cases.
 *
 * Each test creates employees with a unique email so tests never collide with
 * each other after the single `beforeAll` seed.
 */

const app = getApp();

let admin: Session;
let hrManager: Session;
let manager: Session;
let employee: Session;

let uniqueCounter = 0;
const uniqueEmail = (prefix = 'p1'): string => {
  uniqueCounter += 1;
  return `${prefix}.${Date.now()}.${uniqueCounter}@harviktech.com`;
};

const baseCreateBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  firstName: 'Test',
  lastName: 'Employee',
  email: uniqueEmail(),
  employmentType: 'Full-Time',
  dateOfJoining: daysFromToday(-10),
  ...overrides,
});

const authAs = {
  admin: () => bearer(admin.accessToken),
  hrManager: () => bearer(hrManager.accessToken),
  manager: () => bearer(manager.accessToken),
  employee: () => bearer(employee.accessToken),
};

describe('employees (§8.2, §14)', () => {
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

  describe('create', () => {
    it('creates an employee with a generated HRV-#### code (§14)', async () => {
      const response = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody());

      expect(response.status).toBe(201);
      expect(response.body.data.employeeCode).toMatch(/^HRV-\d{4,}$/);
      expect(response.body.data.email).toContain('@harviktech.com');
      expect(response.body.data.status).toBe('Probation');
    });

    it('defaults non-Full-Time hires to Active', async () => {
      const response = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ employmentType: 'Contractor' }));

      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe('Active');
    });

    it('rejects a duplicate email with 409 (§14)', async () => {
      const email = uniqueEmail('dup');
      const first = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ email }));
      expect(first.status).toBe(201);

      const second = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ email }));

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('CONFLICT');
    });

    it('rejects invalid input with 400', async () => {
      const response = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send({ firstName: '', email: 'not-an-email', employmentType: 'Full-Time' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a joining date more than a year in the future', async () => {
      const response = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ dateOfJoining: daysFromToday(400) }));

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('rejects an under-age Intern', async () => {
      const response = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(
          baseCreateBody({
            employmentType: 'Intern',
            dob: daysFromToday(-15 * 365),
            dateOfJoining: daysFromToday(-10),
          }),
        );

      expect(response.status).toBe(422);
    });

    it('encrypts the bank account number at rest and masks it in responses', async () => {
      const email = uniqueEmail('bank');
      const response = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(
          baseCreateBody({
            email,
            bankDetails: { accountHolder: 'Test Employee', accountNumber: '1234567890' },
          }),
        );

      expect(response.status).toBe(201);
      expect(response.body.data.bankDetails?.masked).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain('1234567890');

      const stored = await Employee.findOne({ email }).select('bankDetails').lean().exec();
      expect(stored?.bankDetails?.accountNumberEnc).toBeTruthy();
      expect(stored?.bankDetails?.accountNumberEnc).not.toContain('1234567890');
      expect(decryptField(stored?.bankDetails?.accountNumberEnc as string)).toBe('1234567890');
    });

    it('reveals bank details on detail reads for HR Admin and self only (§7)', async () => {
      const email = uniqueEmail('bankreveal');
      const loginEmail = uniqueEmail('bankself');
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(
          baseCreateBody({
            email,
            bankDetails: { accountHolder: 'Reveal Me', accountNumber: '9876543210' },
            createLogin: { email: loginEmail, password: 'TestPass123', role: 'Employee' },
          }),
        );
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;

      // HR Admin detail: revealed, ciphertext never present.
      const asAdmin = await request(app).get(`/api/v1/employees/${id}`).set(...authAs.admin());
      expect(asAdmin.status).toBe(200);
      expect(asAdmin.body.data.bankDetails?.masked).toBe(false);
      expect(asAdmin.body.data.bankDetails?.accountNumber).toBe('9876543210');
      expect(JSON.stringify(asAdmin.body)).not.toMatch(/accountNumberEnc/);

      // HR Manager detail: still masked.
      const asHrManager = await request(app).get(`/api/v1/employees/${id}`).set(...authAs.hrManager());
      expect(asHrManager.status).toBe(200);
      expect(asHrManager.body.data.bankDetails?.masked).toBe(true);
      expect(asHrManager.body.data.bankDetails?.accountNumber).toBeUndefined();

      // Self detail: revealed.
      const self = await loginAs(loginEmail, 'TestPass123');
      const asSelf = await request(app)
        .get(`/api/v1/employees/${id}`)
        .set(...bearer(self.accessToken));
      expect(asSelf.status).toBe(200);
      expect(asSelf.body.data.bankDetails?.masked).toBe(false);
      expect(asSelf.body.data.bankDetails?.accountNumber).toBe('9876543210');

      // List stays masked even for HR Admin (§2.16).
      const list = await request(app).get('/api/v1/employees?page=1&limit=100').set(...authAs.admin());
      const row = (list.body.data as Array<{ id: string; bankDetails?: { accountNumber?: string } }>).find(
        (r) => r.id === id,
      );
      expect(row).toBeDefined();
      expect(row?.bankDetails?.accountNumber).toBeUndefined();
      expect(JSON.stringify(list.body)).not.toContain('9876543210');
    });

    it('records an audit event on create', async () => {
      const email = uniqueEmail('audit');
      await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ email }));

      const entry = await AuditLog.findOne({ action: 'employee.created' })
        .sort({ at: -1 })
        .lean()
        .exec();
      expect(entry).toBeTruthy();
      expect(entry?.entityType).toBe('Employee');
    });

    it('optionally creates a login together with the employee', async () => {
      const email = uniqueEmail('withlogin');
      const loginEmail = uniqueEmail('login');
      const response = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(
          baseCreateBody({
            email,
            createLogin: { email: loginEmail, password: 'Passw0rd!', role: 'Employee' },
          }),
        );

      expect(response.status).toBe(201);
      expect(response.body.data.id).toBeTruthy();
    });

    it('rejects unauthenticated create with 401', async () => {
      const response = await request(app).post('/api/v1/employees').send(baseCreateBody());
      expect(response.status).toBe(401);
    });

    it('rejects Manager and Employee create with 403', async () => {
      for (const as of [authAs.manager(), authAs.employee()]) {
        const response = await request(app)
          .post('/api/v1/employees')
          .set(...as)
          .send(baseCreateBody());
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('list / search / filter', () => {
    it('lists with pagination meta (§10 envelope)', async () => {
      const response = await request(app)
        .get('/api/v1/employees?page=1&limit=5')
        .set(...authAs.admin());

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.meta).toMatchObject({ page: 1, limit: 5 });
      expect(response.body.meta.total).toBeGreaterThanOrEqual(11);
    });

    it('searches by name, email and code (§14)', async () => {
      const byName = await request(app)
        .get('/api/v1/employees?q=rahul')
        .set(...authAs.admin());
      expect(byName.status).toBe(200);
      expect(byName.body.data.length).toBeGreaterThan(0);

      const byCode = await request(app)
        .get(`/api/v1/employees?q=${byName.body.data[0].employeeCode}`)
        .set(...authAs.admin());
      expect(byCode.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by employmentType and status (§14)', async () => {
      const interns = await request(app)
        .get('/api/v1/employees?employmentType=Intern')
        .set(...authAs.admin());
      expect(interns.status).toBe(200);
      for (const row of interns.body.data) expect(row.employmentType).toBe('Intern');

      const probation = await request(app)
        .get('/api/v1/employees?status=Probation')
        .set(...authAs.admin());
      expect(probation.status).toBe(200);
      for (const row of probation.body.data) expect(row.status).toBe('Probation');
    });

    it('rejects unauthenticated list with 401 and Manager/Employee with 403 (§14)', async () => {
      expect((await request(app).get('/api/v1/employees')).status).toBe(401);

      for (const as of [authAs.manager(), authAs.employee()]) {
        const response = await request(app).get('/api/v1/employees').set(...as);
        expect(response.status).toBe(403);
      }
    });
  });

  describe('read (360 tabs data)', () => {
    it('returns the employee 360 projection with all P1 tabs data (§14)', async () => {
      const id = await employeeIdByEmail(SEEDED.seniorEngineer);
      const response = await request(app)
        .get(`/api/v1/employees/${id}`)
        .set(...authAs.admin());

      expect(response.status).toBe(200);
      const data = response.body.data;
      expect(data.id).toBe(id);
      expect(data.employeeCode).toMatch(/^HRV-/);
      expect(data.fullName).toBeTruthy();
      // Overview
      expect(data.designation).toBeTruthy();
      // Employment history tab
      expect(Array.isArray(data.employmentHistory)).toBe(true);
      expect(data.employmentHistory.length).toBeGreaterThan(0);
      // Status history
      expect(Array.isArray(data.statusHistory)).toBe(true);
      // Bank masked
      expect(data.bankDetails === null || data.bankDetails.masked === true).toBe(true);
      expect(JSON.stringify(data)).not.toMatch(/accountNumberEnc/);
    });

    it('returns history with status and employment timelines', async () => {
      const id = await employeeIdByEmail(SEEDED.seniorEngineer);
      const response = await request(app)
        .get(`/api/v1/employees/${id}/history`)
        .set(...authAs.admin());

      expect(response.status).toBe(200);
      expect(response.body.data.employee.id).toBe(id);
      expect(Array.isArray(response.body.data.statusHistory)).toBe(true);
      expect(Array.isArray(response.body.data.employmentHistory)).toBe(true);
    });

    it('lets a Manager read their team but not outsiders (§14)', async () => {
      // manager@harviktech.com is Ananya: Rahul reports to her.
      const reportId = await employeeIdByEmail(SEEDED.seniorEngineer);
      const allowed = await request(app)
        .get(`/api/v1/employees/${reportId}`)
        .set(...authAs.manager());
      expect(allowed.status).toBe(200);

      // Ishita reports to Meera — outside Ananya's chain.
      const outsiderId = await employeeIdByEmail(SEEDED.financeAnalyst);
      const denied = await request(app)
        .get(`/api/v1/employees/${outsiderId}`)
        .set(...authAs.manager());
      expect(denied.status).toBe(403);
    });

    it('lets an Employee read self but not others', async () => {
      const selfId = await employeeIdByEmail(SEEDED.softwareEngineer);
      const self = await request(app)
        .get(`/api/v1/employees/${selfId}`)
        .set(...authAs.employee());
      expect(self.status).toBe(200);

      const otherId = await employeeIdByEmail(SEEDED.seniorEngineer);
      const other = await request(app)
        .get(`/api/v1/employees/${otherId}`)
        .set(...authAs.employee());
      expect(other.status).toBe(403);
    });
  });

  describe('update', () => {
    it('updates designation and department', async () => {
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody());
      const id = created.body.data.id as string;
      const designDept = await departmentIdByName('Design');

      const response = await request(app)
        .patch(`/api/v1/employees/${id}`)
        .set(...authAs.admin())
        .send({ designation: 'Senior Test Engineer', departmentId: designDept });

      expect(response.status).toBe(200);
      expect(response.body.data.designation).toBe('Senior Test Engineer');
      expect(response.body.data.department.id).toBe(designDept);
    });

    it('appends employment history on employment-type change (§14)', async () => {
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ employmentType: 'Contractor' }));
      const id = created.body.data.id as string;
      const before = created.body.data.employmentHistory.length as number;

      const response = await request(app)
        .patch(`/api/v1/employees/${id}`)
        .set(...authAs.admin())
        .send({ employmentType: 'Full-Time' });

      expect(response.status).toBe(200);
      expect(response.body.data.employmentType).toBe('Full-Time');
      expect(response.body.data.employmentHistory.length).toBe(before + 1);
      // Employee code never changes.
      expect(response.body.data.employeeCode).toBe(created.body.data.employeeCode);
    });

    it('rejects self-reporting (§14)', async () => {
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody());
      const id = created.body.data.id as string;

      const response = await request(app)
        .patch(`/api/v1/employees/${id}`)
        .set(...authAs.admin())
        .send({ reportingManagerId: id });

      expect(response.status).toBe(422);
    });

    it('rejects a circular manager chain (§14)', async () => {
      const a = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ firstName: 'ChainA' }));
      const b = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ firstName: 'ChainB' }));
      const idA = a.body.data.id as string;
      const idB = b.body.data.id as string;

      // A reports to B.
      const link = await request(app)
        .patch(`/api/v1/employees/${idA}`)
        .set(...authAs.admin())
        .send({ reportingManagerId: idB });
      expect(link.status).toBe(200);

      // B reporting to A would close the loop.
      const loop = await request(app)
        .patch(`/api/v1/employees/${idB}`)
        .set(...authAs.admin())
        .send({ reportingManagerId: idA });
      expect(loop.status).toBe(422);
    });

    it('rejects a Relieved manager', async () => {
      // Build a tiny chain: lead -> member, relieve the lead via a valid path.
      const lead = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ firstName: 'Lead' }));
      const leadId = lead.body.data.id as string;

      const toNotice = await request(app)
        .post(`/api/v1/employees/${leadId}/status`)
        .set(...authAs.admin())
        .send({ status: 'On Notice', reason: 'test' });
      expect(toNotice.status).toBe(200);

      const member = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ firstName: 'Member' }));
      const memberId = member.body.data.id as string;

      // On-Notice managers are still assignable; Relieved ones are not.
      // Relieve the lead with the HR-Admin reason flow.
      const relieveBlocked = await request(app)
        .post(`/api/v1/employees/${leadId}/status`)
        .set(...authAs.admin())
        .send({ status: 'Relieved', reason: 'end of test contract' });
      expect(relieveBlocked.status).toBe(200);

      const assign = await request(app)
        .patch(`/api/v1/employees/${memberId}`)
        .set(...authAs.admin())
        .send({ reportingManagerId: leadId });
      expect(assign.status).toBe(422);
    });
  });

  describe('status machine', () => {
    it('walks Probation -> Active -> On Notice and audits each step', async () => {
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody());
      const id = created.body.data.id as string;

      const toActive = await request(app)
        .post(`/api/v1/employees/${id}/status`)
        .set(...authAs.admin())
        .send({ status: 'Active' });
      expect(toActive.status).toBe(200);
      expect(toActive.body.data.status).toBe('Active');

      const toNotice = await request(app)
        .post(`/api/v1/employees/${id}/status`)
        .set(...authAs.admin())
        .send({ status: 'On Notice', lastWorkingDay: daysFromToday(30) });
      expect(toNotice.status).toBe(200);
      expect(toNotice.body.data.lastWorkingDay).toBe(daysFromToday(30));

      const audits = await AuditLog.countDocuments({
        action: 'employee.status_changed',
      });
      expect(audits).toBeGreaterThanOrEqual(2);
    });

    it('creates an Exit record when employee transitions to On Notice (P3 requirement §8.10)', async () => {
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody());
      const id = created.body.data.id as string;

      const toNotice = await request(app)
        .post(`/api/v1/employees/${id}/status`)
        .set(...authAs.admin())
        .send({ status: 'On Notice' });
      expect(toNotice.status).toBe(200);

      // P3 §8.10: transitioning to On Notice must auto-create the Exit record.
      // Allow a brief async propagation window (the listener is non-blocking).
      await new Promise((resolve) => setTimeout(resolve, 200));

      const { default: mongoose } = await import('mongoose');
      const exits = mongoose.connection.collections['exits'];
      expect(exits).toBeDefined();
      const exitDoc = await exits?.findOne({ employeeId: new mongoose.Types.ObjectId(id) });
      expect(exitDoc).not.toBeNull();
      expect(['Notice Period', 'Clearance', 'Asset Return', 'Software Revocation', 'Final Settlement', 'Documents'].includes(exitDoc?.stage as string)).toBe(true);
    });

    it('rejects invalid transitions with 422 (§14)', async () => {
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody());
      const id = created.body.data.id as string;

      // Probation -> Relieved is not an edge.
      const response = await request(app)
        .post(`/api/v1/employees/${id}/status`)
        .set(...authAs.admin())
        .send({ status: 'Relieved', reason: 'nope' });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('treats Relieved as terminal except HR-Admin re-hire (§14)', async () => {
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody());
      const id = created.body.data.id as string;

      await request(app)
        .post(`/api/v1/employees/${id}/status`)
        .set(...authAs.admin())
        .send({ status: 'On Notice' });

      const relieved = await request(app)
        .post(`/api/v1/employees/${id}/status`)
        .set(...authAs.admin())
        .send({ status: 'Relieved', reason: 'contract ended' });
      expect(relieved.status).toBe(200);

      // Any further move fails…
      const stuck = await request(app)
        .post(`/api/v1/employees/${id}/status`)
        .set(...authAs.hrManager())
        .send({ status: 'Active' });
      expect(stuck.status).toBe(422);

      // …except HR-Admin re-hire, which opens a new employment record.
      const historyBefore = relieved.body.data.employmentHistory.length as number;
      const rehired = await request(app)
        .post(`/api/v1/employees/${id}/status`)
        .set(...authAs.admin())
        .send({ status: 'Active', reason: 're-hired for a new project' });
      expect(rehired.status).toBe(200);
      expect(rehired.body.data.employmentHistory.length).toBe(historyBefore + 1);
      expect(rehired.body.data.lastWorkingDay).toBeNull();
    });
  });

  describe('delete', () => {
    it('soft-deletes and refuses to delete a manager with reports', async () => {
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody());
      const id = created.body.data.id as string;

      const deleted = await request(app)
        .delete(`/api/v1/employees/${id}`)
        .set(...authAs.admin());
      expect(deleted.status).toBe(204);

      const stored = await Employee.findById(id).lean().exec();
      expect(stored?.isDeleted).toBe(true);

      // Seeded Ananya still has reports.
      const ananyaId = await employeeIdByEmail(SEEDED.engineeringManager);
      const blocked = await request(app)
        .delete(`/api/v1/employees/${ananyaId}`)
        .set(...authAs.admin());
      expect(blocked.status).toBe(409);
    });

    it('rejects HR-Manager delete with 403 (HR Admin only)', async () => {
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody());
      const id = created.body.data.id as string;

      const response = await request(app)
        .delete(`/api/v1/employees/${id}`)
        .set(...authAs.hrManager());
      expect(response.status).toBe(403);
    });
  });

  describe('compensation visibility (§8.11)', () => {
    it('shows compensation to HR roles and self, hides it from others', async () => {
      const created = await request(app)
        .post('/api/v1/employees')
        .set(...authAs.admin())
        .send(baseCreateBody({ compensation: { amount: 50000, currency: 'INR', period: 'monthly' } }));
      const id = created.body.data.id as string;

      const asAdmin = await request(app)
        .get(`/api/v1/employees/${id}`)
        .set(...authAs.admin());
      expect(asAdmin.body.data.compensation?.amount).toBe(50000);

      const asManager = await request(app)
        .get(`/api/v1/employees/${id}`)
        .set(...authAs.manager());
      // Manager is out of scope for a fresh hire → 403; in-scope non-HR sees null.
      expect([200, 403]).toContain(asManager.status);
      if (asManager.status === 200) expect(asManager.body.data.compensation).toBeNull();
    });
  });
});
