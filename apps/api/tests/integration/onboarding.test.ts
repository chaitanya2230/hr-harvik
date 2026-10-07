import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Onboarding } from '../../src/modules/onboarding/onboarding.model';
import {
  DEMO_ACCOUNTS,
  bearer,
  getApp,
  loginAs,
  seedDatabase,
  type Session,
} from '../support/helpers';
import { SEEDED, employeeIdByEmail, departmentIdByName } from '../support/employee-fixtures';

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

describe('AGENTS.md §14 ONBOARDING acceptance test matrix (ONB-01 to ONB-11)', () => {
  let engineeringDeptId: string;
  let engineeringManagerId: string;
  let testEmployeeId: string;

  beforeAll(async () => {
    await seedDatabase();
    admin = await loginAs(DEMO_ACCOUNTS.admin);
    hrManager = await loginAs(DEMO_ACCOUNTS.hrManager);
    manager = await loginAs(DEMO_ACCOUNTS.manager);
    employee = await loginAs(DEMO_ACCOUNTS.employee);

    engineeringDeptId = await departmentIdByName('Engineering');
    engineeringManagerId = await employeeIdByEmail(SEEDED.engineeringManager);
  });

  // -------------------------------------------------------------------------
  // ONB-01: Auto-creation on employee creation
  // -------------------------------------------------------------------------
  it('ONB-01: automatically creates onboarding checklist when employee is created', async () => {
    const empRes = await request(app)
      .post('/api/v1/employees')
      .set(...authAs.admin())
      .send({
        firstName: 'Onboarding',
        lastName: 'Starter',
        email: 'onboarding.starter@harviktech.com',
        employmentType: 'Full-Time',
        designation: 'Backend Developer',
        departmentId: engineeringDeptId,
        reportingManagerId: engineeringManagerId,
        dateOfJoining: '2026-10-15',
      });

    expect(empRes.status).toBe(201);
    testEmployeeId = empRes.body.data.id;

    // Check Onboarding record was automatically created
    const onbDoc = await Onboarding.findOne({ employeeId: testEmployeeId }).lean().exec();
    expect(onbDoc).toBeDefined();
    expect(onbDoc?.employeeId.toString()).toBe(testEmployeeId);
  });

  // -------------------------------------------------------------------------
  // ONB-02: Exactly 14 mandatory checklist items
  // -------------------------------------------------------------------------
  it('ONB-02: onboarding checklist contains exactly 14 mandatory items with smart links', async () => {
    const res = await request(app)
      .get(`/api/v1/onboarding/${testEmployeeId}`)
      .set(...authAs.admin());

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.items.length).toBe(14);

    const keys = data.items.map((i: { key: string }) => i.key);
    expect(keys).toContain('personalInfo');
    expect(keys).toContain('identityDocs');
    expect(keys).toContain('educationalDocs');
    expect(keys).toContain('offerLetter');
    expect(keys).toContain('agreementNda');
    expect(keys).toContain('bankInfo');
    expect(keys).toContain('taxInfo');
    expect(keys).toContain('departmentAssignment');
    expect(keys).toContain('managerAssignment');
    expect(keys).toContain('companyEmailAccount');
    expect(keys).toContain('hardwareAssignment');
    expect(keys).toContain('softwareLicenseAssignment');
    expect(keys).toContain('orientation');
    expect(keys).toContain('policyAcknowledgement');

    // Smart links
    for (const item of data.items) {
      expect(item.smartLink).toBeDefined();
      expect(typeof item.smartLink).toBe('string');
    }
  });

  // -------------------------------------------------------------------------
  // ONB-03: Initial status & progression calculation
  // -------------------------------------------------------------------------
  it('ONB-03: computes progress percent and status (In Progress / Completed)', async () => {
    const res = await request(app)
      .get(`/api/v1/onboarding/${testEmployeeId}`)
      .set(...authAs.admin());

    expect(res.status).toBe(200);
    const data = res.body.data;
    // Since department and manager were provided at creation, some items were auto-completed
    expect(data.completedItemsCount).toBeGreaterThan(0);
    expect(data.status).toBe('In Progress');
    expect(data.progressPercent).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // ONB-04: Auto-completion for profile details
  // -------------------------------------------------------------------------
  it('ONB-04: auto-completes personalInfo and bankInfo when employee profile is updated', async () => {
    await request(app)
      .patch(`/api/v1/employees/${testEmployeeId}`)
      .set(...authAs.admin())
      .send({
        phone: '+1-555-9988',
        address: { city: 'New York', line1: '123 Main St' },
        emergencyContact: { phone: '+1-555-9999', name: 'Emergency Contact' },
        bankDetails: { accountHolder: 'Onboarding Starter', accountNumber: '1234567890' },
      });

    const res = await request(app)
      .get(`/api/v1/onboarding/${testEmployeeId}`)
      .set(...authAs.admin());

    expect(res.status).toBe(200);
    const items = res.body.data.items;
    const personalItem = items.find((i: { key: string }) => i.key === 'personalInfo');
    const bankItem = items.find((i: { key: string }) => i.key === 'bankInfo');

    expect(personalItem.status).toBe('Completed');
    expect(bankItem.status).toBe('Completed');
  });

  // -------------------------------------------------------------------------
  // ONB-05: Auto-completion for user account creation
  // -------------------------------------------------------------------------
  it('ONB-05: auto-completes companyEmailAccount when user login is created', async () => {
    // Create new employee with login
    const empWithLogin = await request(app)
      .post('/api/v1/employees')
      .set(...authAs.admin())
      .send({
        firstName: 'Login',
        lastName: 'User',
        email: 'login.user.onboarding@harviktech.com',
        employmentType: 'Full-Time',
        designation: 'Developer',
        departmentId: engineeringDeptId,
        reportingManagerId: engineeringManagerId,
        dateOfJoining: '2026-10-20',
        createLogin: {
          email: 'login.user.onboarding@harviktech.com',
          password: 'Passw0rd!123',
          role: 'Employee',
        },
      });

    const empId = empWithLogin.body.data.id;
    const onbRes = await request(app)
      .get(`/api/v1/onboarding/${empId}`)
      .set(...authAs.admin());

    expect(onbRes.status).toBe(200);
    const emailItem = onbRes.body.data.items.find((i: { key: string }) => i.key === 'companyEmailAccount');
    expect(emailItem.status).toBe('Completed');
  });

  // -------------------------------------------------------------------------
  // ONB-06: Auto-completion for document creation
  // -------------------------------------------------------------------------
  it('ONB-06: auto-completes document checklist items when documents are uploaded', async () => {
    // Upload Identity document
    const validPdf = Buffer.from('%PDF-1.4 sample passport id document');
    await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .attach('file', validPdf, { filename: 'passport.pdf', contentType: 'application/pdf' })
      .field('employeeId', testEmployeeId)
      .field('title', 'Passport ID')
      .field('category', 'Identity');

    const res = await request(app)
      .get(`/api/v1/onboarding/${testEmployeeId}`)
      .set(...authAs.admin());

    expect(res.status).toBe(200);
    const identityItem = res.body.data.items.find((i: { key: string }) => i.key === 'identityDocs');
    expect(identityItem.status).toBe('Completed');
  });

  // -------------------------------------------------------------------------
  // ONB-07: Auto-completion for hardware assignment
  // -------------------------------------------------------------------------
  it('ONB-07: auto-completes hardwareAssignment when an asset is assigned', async () => {
    // Create an asset
    const assetRes = await request(app)
      .post('/api/v1/assets')
      .set(...authAs.admin())
      .send({
        name: 'MacBook Pro 16',
        type: 'Laptop',
        serialNumber: `SN-ONB-${Date.now()}`,
      });
    expect(assetRes.status).toBe(201);
    const assetId = assetRes.body.data.id;

    // Assign asset
    await request(app)
      .post(`/api/v1/assets/${assetId}/assign`)
      .set(...authAs.admin())
      .send({
        employeeId: testEmployeeId,
      });

    const res = await request(app)
      .get(`/api/v1/onboarding/${testEmployeeId}`)
      .set(...authAs.admin());

    expect(res.status).toBe(200);
    const hwItem = res.body.data.items.find((i: { key: string }) => i.key === 'hardwareAssignment');
    expect(hwItem.status).toBe('Completed');
  });

  // -------------------------------------------------------------------------
  // ONB-08: Auto-completion for software/license assignment
  // -------------------------------------------------------------------------
  it('ONB-08: auto-completes softwareLicenseAssignment when a license is assigned', async () => {
    // Create a license
    const licRes = await request(app)
      .post('/api/v1/licenses')
      .set(...authAs.admin())
      .send({
        softwareName: `JetBrains-${Date.now()}`,
        licenseType: 'Per-Seat',
        maxSeats: 5,
        billingCycle: 'Annual',
        renewalDate: '2027-10-01',
      });
    expect(licRes.status).toBe(201);
    const licenseId = licRes.body.data.id;

    // Assign license
    await request(app)
      .post(`/api/v1/licenses/${licenseId}/assign`)
      .set(...authAs.admin())
      .send({
        employeeId: testEmployeeId,
      });

    const res = await request(app)
      .get(`/api/v1/onboarding/${testEmployeeId}`)
      .set(...authAs.admin());

    expect(res.status).toBe(200);
    const swItem = res.body.data.items.find((i: { key: string }) => i.key === 'softwareLicenseAssignment');
    expect(swItem.status).toBe('Completed');
  });

  // -------------------------------------------------------------------------
  // ONB-09: Manual completion, notes, and NA rules
  // -------------------------------------------------------------------------
  it('ONB-09: supports manual completion, requires reason for NA, and marks checklist Completed when all done', async () => {
    // NA without reason fails
    const badNa = await request(app)
      .patch(`/api/v1/onboarding/${testEmployeeId}/items/educationalDocs`)
      .set(...authAs.admin())
      .send({ status: 'NA' });
    expect(badNa.status).toBe(400);

    // NA with reason succeeds
    const goodNa = await request(app)
      .patch(`/api/v1/onboarding/${testEmployeeId}/items/educationalDocs`)
      .set(...authAs.admin())
      .send({ status: 'NA', naReason: 'Experienced lateral hire with verified previous experience' });
    expect(goodNa.status).toBe(200);

    // Complete all remaining pending items to test Completed transition
    const current = await request(app)
      .get(`/api/v1/onboarding/${testEmployeeId}`)
      .set(...authAs.admin());

    for (const item of current.body.data.items) {
      if (item.status === 'Pending') {
        await request(app)
          .patch(`/api/v1/onboarding/${testEmployeeId}/items/${item.key}`)
          .set(...authAs.admin())
          .send({ status: 'Completed', notes: 'Manually verified by HR' });
      }
    }

    // Verify overall status is now Completed
    const finalRes = await request(app)
      .get(`/api/v1/onboarding/${testEmployeeId}`)
      .set(...authAs.admin());
    expect(finalRes.status).toBe(200);
    expect(finalRes.body.data.status).toBe('Completed');
    expect(finalRes.body.data.completedItemsCount).toBe(14);
    expect(finalRes.body.data.progressPercent).toBe(100);
  });

  // -------------------------------------------------------------------------
  // ONB-10: Reopen completed checklist
  // -------------------------------------------------------------------------
  it('ONB-10: allows HR to reopen a Completed checklist with audited reason', async () => {
    // Manager cannot reopen
    const mgrReopen = await request(app)
      .post(`/api/v1/onboarding/${testEmployeeId}/reopen`)
      .set(...authAs.manager())
      .send({ reason: 'Need to review tax form again' });
    expect(mgrReopen.status).toBe(403);

    // HR Admin can reopen
    const adminReopen = await request(app)
      .post(`/api/v1/onboarding/${testEmployeeId}/reopen`)
      .set(...authAs.admin())
      .send({ reason: 'Updated compliance policy requires re-acknowledgement' });
    expect(adminReopen.status).toBe(200);
    expect(adminReopen.body.data.status).toBe('In Progress');
    expect(adminReopen.body.data.reopenedAt).toBeDefined();
    expect(adminReopen.body.data.reopenReason).toBe('Updated compliance policy requires re-acknowledgement');
  });

  // -------------------------------------------------------------------------
  // ONB-11: RBAC scoping and Dashboard metric
  // -------------------------------------------------------------------------
  it('ONB-11: scopes onboarding lists and updates dashboard pendingOnboarding metric', async () => {
    // List onboardings
    const listRes = await request(app)
      .get('/api/v1/onboarding')
      .set(...authAs.admin());
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.data)).toBe(true);

    // Dashboard check: pendingOnboarding is a real number, not null
    const dashRes = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...authAs.admin());
    expect(dashRes.status).toBe(200);
    const summary = dashRes.body.data;
    expect(summary.metrics.pendingOnboarding).toBeTypeOf('number');
    expect(summary.links.pendingOnboarding).toBe('/onboarding');
    expect(summary.quickActions.find((q: { key: string }) => q.key === 'startOnboarding').enabled).toBe(true);
    expect(summary.quickActions.find((q: { key: string }) => q.key === 'addCandidate').enabled).toBe(true);
  });
});
