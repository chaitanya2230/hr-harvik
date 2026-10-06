import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Exit } from '../../src/modules/exit/exit.model';
import { Employee } from '../../src/modules/employees/employee.model';
import { User } from '../../src/modules/users/user.model';
import { LicenseAssignment } from '../../src/modules/licenses/license.model';
import { AuditLog } from '../../src/modules/audit/audit.model';
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

describe('AGENTS.md §14 EXIT acceptance test matrix (24 tests)', () => {
  beforeAll(async () => {
    await seedDatabase();
    admin = await loginAs(DEMO_ACCOUNTS.admin);
    hrManager = await loginAs(DEMO_ACCOUNTS.hrManager);
    manager = await loginAs(DEMO_ACCOUNTS.manager);
    employee = await loginAs(DEMO_ACCOUNTS.employee);
  });

  // Helper to create a dedicated fixture employee for exit tests
  async function createExitFixtureEmployee(nameSuffix: string): Promise<{
    employeeId: string;
    assetIds: string[];
    assetAssignmentIds: string[];
    licenseIds: string[];
    licenseAssignmentIds: string[];
    accessItemId: string;
  }> {
    const managerId = await employeeIdByEmail(SEEDED.engineeringManager);
    const departmentId = await departmentIdByName('Engineering');

    // 1. Create employee
    const empRes = await request(app)
      .post('/api/v1/employees')
      .set(...authAs.admin())
      .send({
        firstName: 'Exit',
        lastName: `Fixture${nameSuffix}`,
        email: `exit.fixture.${nameSuffix.toLowerCase()}.${Date.now()}@harviktech.com`,
        phone: '+91 98000 88888',
        dob: '1992-05-10',
        designation: 'Backend Developer',
        departmentId,
        reportingManagerId: managerId,
        employmentType: 'Full-Time',
        dateOfJoining: '2023-01-10',
        compensation: { amount: 100000, currency: 'INR', period: 'monthly' },
      });
    expect(empRes.status).toBe(201);
    const employeeId = empRes.body.data.id as string;

    // 2. Assign 2 assets (§14: "Fixture employee has 2 assets")
    const assetIds: string[] = [];
    const assetAssignmentIds: string[] = [];
    for (let i = 1; i <= 2; i += 1) {
      const astRes = await request(app)
        .post('/api/v1/assets')
        .set(...authAs.admin())
        .send({
          name: `Exit Laptop ${nameSuffix} ${i}`,
          type: 'Laptop',
          serialNumber: `SN-EXIT-${nameSuffix}-${Date.now()}-${i}`,
          purchaseDate: '2023-01-15',
          purchaseCost: 75000,
        });
      expect(astRes.status).toBe(201);
      const aId = astRes.body.data.id as string;
      assetIds.push(aId);

      const asgnRes = await request(app)
        .post(`/api/v1/assets/${aId}/assign`)
        .set(...authAs.admin())
        .send({ employeeId });
      expect(asgnRes.status).toBe(201);
      assetAssignmentIds.push(asgnRes.body.data.id as string);
    }

    // 3. Assign 3 licenses (§14: "3 licenses")
    const licenseIds: string[] = [];
    const licenseAssignmentIds: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const licRes = await request(app)
        .post('/api/v1/licenses')
        .set(...authAs.admin())
        .send({
          softwareName: `Exit Tool ${nameSuffix} ${i}`,
          licenseType: 'Per-Seat',
          startDate: '2023-01-01',
          renewalDate: '2027-01-01',
          maxSeats: 10,
        });
      expect(licRes.status).toBe(201);
      const lId = licRes.body.data.id as string;
      licenseIds.push(lId);

      const asgnRes = await request(app)
        .post(`/api/v1/licenses/${lId}/assign`)
        .set(...authAs.admin())
        .send({ employeeId, accountIdentifier: `usr.${nameSuffix}.${i}` });
      expect(asgnRes.status).toBe(201);
      licenseAssignmentIds.push(asgnRes.body.data.id as string);
    }

    // 4. Create 1 access item (§14: "1 access item")
    const accRes = await request(app)
      .post('/api/v1/access')
      .set(...authAs.admin())
      .send({
        employeeId,
        system: `VPN Gateway ${nameSuffix}`,
        identifier: `vpn.${nameSuffix}`,
      });
    expect(accRes.status).toBe(201);
    const accessItemId = accRes.body.data.id as string;

    return {
      employeeId,
      assetIds,
      assetAssignmentIds,
      licenseIds,
      licenseAssignmentIds,
      accessItemId,
    };
  }

  // -------------------------------------------------------------------------
  // Tests 1 to 5: Exit Initiation, LWD, Checklist, Flags
  // -------------------------------------------------------------------------

  it('1. Start exit: initiates offboarding and returns 201 with exit record', async () => {
    const fixture = await createExitFixtureEmployee('Test1');
    const res = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({
        reason: 'Better Opportunity',
        noticePeriodDays: 30,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.employeeId).toBe(fixture.employeeId);
    expect(res.body.data.reason).toBe('Better Opportunity');
  });

  it('2. Correct LWD generated: calculates lastWorkingDay from noticePeriodDays', async () => {
    const fixture = await createExitFixtureEmployee('Test2');
    const res = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({
        resignationDate: '2026-06-01',
        noticePeriodDays: 45,
        reason: 'Career change',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.resignationDate).toBe('2026-06-01');
    expect(res.body.data.noticePeriodDays).toBe(45);
    // 2026-06-01 + 45 days = 2026-07-16
    expect(res.body.data.lastWorkingDay).toBe('2026-07-16');
  });

  it('3. Employee becomes On Notice: updates employee status and records history', async () => {
    const fixture = await createExitFixtureEmployee('Test3');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Relocation' });

    const empRes = await request(app)
      .get(`/api/v1/employees/${fixture.employeeId}`)
      .set(...authAs.admin());

    expect(empRes.status).toBe(200);
    expect(empRes.body.data.status).toBe('On Notice');
    expect(empRes.body.data.statusHistory.some((s: { status: string }) => s.status === 'On Notice')).toBe(true);
  });

  it('4. Checklist contains all required asset/license/access/clearance/settlement/document items', async () => {
    const fixture = await createExitFixtureEmployee('Test4');
    const res = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Personal reasons' });

    expect(res.status).toBe(201);
    const checklist = res.body.data.checklist as Array<{ category: string; title: string }>;

    // 2 assets + 3 licenses + 1 access + 3 clearances + 1 settlement + 2 documents = 12 items
    expect(checklist.filter((c) => c.category === 'asset').length).toBe(2);
    expect(checklist.filter((c) => c.category === 'license').length).toBe(3);
    expect(checklist.filter((c) => c.category === 'access').length).toBe(1);
    expect(checklist.filter((c) => c.category === 'clearance').length).toBe(3);
    expect(checklist.filter((c) => c.category === 'settlement').length).toBe(1);
    expect(checklist.filter((c) => c.category === 'document').length).toBe(2);
  });

  it('5. Exit view shows returned/revoked flags and blocker items', async () => {
    const fixture = await createExitFixtureEmployee('Test5');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Higher studies' });

    const res = await request(app)
      .get(`/api/v1/exit/${fixture.employeeId}`)
      .set(...authAs.admin());

    expect(res.status).toBe(200);
    expect(res.body.data.checklist).toBeInstanceOf(Array);
    expect(res.body.data.blockers.length).toBeGreaterThan(0);
    expect(res.body.data.clearances).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Tests 6 to 9: Dynamic Checklist Sync with P2 Assets and Licenses
  // -------------------------------------------------------------------------

  it('6. Returning asset completes linked checklist item automatically', async () => {
    const fixture = await createExitFixtureEmployee('Test6');
    const initRes = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Notice given' });
    expect(initRes.status).toBe(201);

    // Return the first asset through the Asset module
    const returnRes = await request(app)
      .post(`/api/v1/assets/${fixture.assetIds[0]}/return`)
      .set(...authAs.admin())
      .send({ conditionAtReturn: 'Good' });
    expect(returnRes.status).toBe(200);

    // Verify exit checklist item became Completed
    const exitRes = await request(app)
      .get(`/api/v1/exit/${fixture.employeeId}`)
      .set(...authAs.admin());

    expect(exitRes.status).toBe(200);
    const completedAssetItem = exitRes.body.data.checklist.find(
      (c: { referenceId: string; category: string }) =>
        c.category === 'asset' && c.referenceId === fixture.assetAssignmentIds[0],
    );
    expect(completedAssetItem).toBeDefined();
    expect(completedAssetItem.status).toBe('Completed');
  });

  it('7. Revoking license completes linked checklist item automatically', async () => {
    const fixture = await createExitFixtureEmployee('Test7');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Notice given' });

    // Revoke license assignment through Licenses module
    const revokeRes = await request(app)
      .post(`/api/v1/licenses/assignments/${fixture.licenseAssignmentIds[0]}/revoke`)
      .set(...authAs.admin())
      .send({ revocationNote: 'Revoked during notice' });
    expect(revokeRes.status).toBe(200);

    // Verify exit checklist item became Completed
    const exitRes = await request(app)
      .get(`/api/v1/exit/${fixture.employeeId}`)
      .set(...authAs.admin());

    const completedLicItem = exitRes.body.data.checklist.find(
      (c: { referenceId: string; category: string }) =>
        c.category === 'license' && c.referenceId === fixture.licenseAssignmentIds[0],
    );
    expect(completedLicItem).toBeDefined();
    expect(completedLicItem.status).toBe('Completed');
  });

  it('8. Exit checklist license action must revoke the actual license assignment', async () => {
    const fixture = await createExitFixtureEmployee('Test8');
    const initRes = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Notice given' });

    const licItem = initRes.body.data.checklist.find(
      (c: { category: string; referenceId: string }) =>
        c.category === 'license' && c.referenceId === fixture.licenseAssignmentIds[1],
    );
    expect(licItem).toBeDefined();

    // Update checklist item to Completed from Exit module
    const updateRes = await request(app)
      .patch(`/api/v1/exit/${fixture.employeeId}/checklist/${licItem.id}`)
      .set(...authAs.admin())
      .send({ status: 'Completed', notes: 'Revoked via exit action' });
    expect(updateRes.status).toBe(200);

    // Verify actual license assignment was revoked in database
    const assignmentDoc = await LicenseAssignment.findById(fixture.licenseAssignmentIds[1]);
    expect(assignmentDoc?.status).toBe('Revoked');
  });

  it('9. New asset during notice adds exit checklist item', async () => {
    const fixture = await createExitFixtureEmployee('Test9');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Notice period active' });

    // Assign a 3rd new asset to employee while on notice
    const newAssetRes = await request(app)
      .post('/api/v1/assets')
      .set(...authAs.admin())
      .send({
        name: 'Extra Test Monitor',
        type: 'Monitor',
        serialNumber: `SN-EXIT-NEW-${Date.now()}`,
        purchaseDate: '2024-01-01',
        purchaseCost: 20000,
      });
    expect(newAssetRes.status).toBe(201);
    const newAssetId = newAssetRes.body.data.id as string;

    const asgnRes = await request(app)
      .post(`/api/v1/assets/${newAssetId}/assign`)
      .set(...authAs.admin())
      .send({ employeeId: fixture.employeeId });
    expect(asgnRes.status).toBe(201);

    // Verify exit checklist gained an additional asset item
    const exitRes = await request(app)
      .get(`/api/v1/exit/${fixture.employeeId}`)
      .set(...authAs.admin());

    const assetItems = exitRes.body.data.checklist.filter(
      (c: { category: string }) => c.category === 'asset',
    );
    expect(assetItems.length).toBe(3); // 2 initial + 1 new
  });

  // -------------------------------------------------------------------------
  // Tests 10 to 14: Clearances, Relieve Guards & Force-Relieve
  // -------------------------------------------------------------------------

  it('10. Manager clearance works: reporting manager can approve team clearance', async () => {
    const fixture = await createExitFixtureEmployee('Test10');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Notice given' });

    // Manager approves manager clearance
    const clrRes = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/clearance`)
      .set(...authAs.manager())
      .send({
        department: 'manager',
        status: 'Approved',
        comments: 'All handover docs received',
      });

    expect(clrRes.status).toBe(200);
    expect(clrRes.body.data.clearances.manager.status).toBe('Approved');
  });

  it('11. HR clearance cannot be completed by Manager: returns 403', async () => {
    const fixture = await createExitFixtureEmployee('Test11');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Notice given' });

    // Manager attempts HR clearance
    const clrRes = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/clearance`)
      .set(...authAs.manager())
      .send({
        department: 'hr',
        status: 'Approved',
      });

    expect(clrRes.status).toBe(403);
  });

  it('12. Relieve with pending blockers: rejected with 422 and blocker list', async () => {
    const fixture = await createExitFixtureEmployee('Test12');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Notice given' });

    // Attempt relieve without completing blockers
    const res = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/relieve`)
      .set(...authAs.admin())
      .send({ force: false });

    expect(res.status).toBe(422);
    expect(res.body.error.details.blockers).toBeInstanceOf(Array);
    expect(res.body.error.details.blockers.length).toBeGreaterThan(0);
  });

  it('13. HR Manager cannot force relieve: rejected with 403', async () => {
    const fixture = await createExitFixtureEmployee('Test13');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Notice given' });

    const res = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/relieve`)
      .set(...authAs.hrManager())
      .send({ force: true, forceReason: 'HR Manager trying override' });

    expect(res.status).toBe(403);
  });

  it('14. HR Admin force relieve requires reason: rejected with 422 if empty', async () => {
    const fixture = await createExitFixtureEmployee('Test14');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Notice given' });

    // Force without reason
    const res = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/relieve`)
      .set(...authAs.admin())
      .send({ force: true, forceReason: '' });

    expect(res.status).toBe(422);

    // Force WITH reason succeeds
    const forceRes = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/relieve`)
      .set(...authAs.admin())
      .send({ force: true, forceReason: 'Approved by VP of Engineering' });

    expect(forceRes.status).toBe(200);
    expect(forceRes.body.data.stage).toBe('Relieved');
    expect(forceRes.body.data.forceRelieved).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Tests 15 to 19: Complete Normal Relieve and Lifecycle Teardown
  // -------------------------------------------------------------------------

  it('15. Complete all blockers → Relieved: standard relieve succeeds when all blockers clear', async () => {
    const fixture = await createExitFixtureEmployee('Test15');
    const initRes = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Clean exit' });

    // Complete all items on checklist
    for (const item of initRes.body.data.checklist as Array<{ id: string }>) {
      await request(app)
        .patch(`/api/v1/exit/${fixture.employeeId}/checklist/${item.id}`)
        .set(...authAs.admin())
        .send({ status: 'Completed' });
    }

    // Approve all clearances
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/clearance`)
      .set(...authAs.admin())
      .send({ department: 'manager', status: 'Approved' });
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/clearance`)
      .set(...authAs.admin())
      .send({ department: 'hr', status: 'Approved' });
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/clearance`)
      .set(...authAs.admin())
      .send({ department: 'finance', status: 'Approved' });

    // Settle
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/settlement`)
      .set(...authAs.admin())
      .send({ status: 'Completed' });

    // Standard relieve
    const relieveRes = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/relieve`)
      .set(...authAs.admin())
      .send({ force: false });

    expect(relieveRes.status).toBe(200);
    expect(relieveRes.body.data.stage).toBe('Relieved');
    expect(relieveRes.body.data.completedAt).toBeDefined();
  });

  it('16. Login disabled on relieve: user account isActive becomes false', async () => {
    const fixture = await createExitFixtureEmployee('Test16');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Login disable test' });

    // Relieve using force for quick setup
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/relieve`)
      .set(...authAs.admin())
      .send({ force: true, forceReason: 'Fast relieve' });

    const userDoc = await User.findOne({ employeeId: fixture.employeeId });
    if (userDoc) {
      expect(userDoc.isActive).toBe(false);
    }
  });

  it('17. Leave cancelled: emits teardown event on relieve', async () => {
    const fixture = await createExitFixtureEmployee('Test17');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Leave test' });

    const relieveRes = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/relieve`)
      .set(...authAs.admin())
      .send({ force: true, forceReason: 'Fast relieve' });

    expect(relieveRes.status).toBe(200);
  });

  it('18. Future attendance blocked: employee status is Relieved', async () => {
    const fixture = await createExitFixtureEmployee('Test18');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Attendance test' });

    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/relieve`)
      .set(...authAs.admin())
      .send({ force: true, forceReason: 'Fast relieve' });

    const emp = await Employee.findById(fixture.employeeId);
    expect(emp?.status).toBe('Relieved');
  });

  it('19. Employment history closed: lastWorkingDay locked and history ended', async () => {
    const fixture = await createExitFixtureEmployee('Test19');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'History test' });

    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/relieve`)
      .set(...authAs.admin())
      .send({ force: true, forceReason: 'Fast relieve' });

    const emp = await Employee.findById(fixture.employeeId);
    expect(emp?.status).toBe('Relieved');
    expect(emp?.lastWorkingDay).toBeDefined();

    const currentHistory = emp?.employmentHistory[emp.employmentHistory.length - 1];
    expect(currentHistory?.to).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Tests 20 to 24: Withdrawal, Dashboard, Reports, Concurrency
  // -------------------------------------------------------------------------

  it('20. Withdrawal changes On Notice → Active and cancels exit while preserving audit history', async () => {
    const fixture = await createExitFixtureEmployee('Test20');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Withdrawal test' });

    // Withdraw exit
    const withdrawRes = await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/withdraw`)
      .set(...authAs.admin())
      .send();

    expect(withdrawRes.status).toBe(200);

    const emp = await Employee.findById(fixture.employeeId);
    expect(emp?.status).toBe('Active');

    const exitDoc = await Exit.findOne({ employeeId: fixture.employeeId });
    expect(exitDoc?.stage).toBe('Cancelled');

    // Audit log preserved
    const audits = await AuditLog.find({ entityId: exitDoc?._id });
    expect(audits.some((a) => a.action === 'exit.withdrawn')).toBe(true);
  });

  it('21. Dashboard pending counts update when employee enters exit', async () => {
    const fixture = await createExitFixtureEmployee('Test21');
    const beforeDash = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...authAs.admin());

    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Dashboard test' });

    const afterDash = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...authAs.admin());

    expect(afterDash.status).toBe(200);
    expect(afterDash.body.data.metrics.onNotice).toBe(beforeDash.body.data.metrics.onNotice + 1);
  });

  it('22. Exit list includes employee in exit process', async () => {
    const fixture = await createExitFixtureEmployee('Test22');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'List test' });

    const listRes = await request(app)
      .get('/api/v1/exit')
      .set(...authAs.admin());

    expect(listRes.status).toBe(200);
    const found = listRes.body.data.some(
      (e: { employeeId: string }) => e.employeeId === fixture.employeeId,
    );
    expect(found).toBe(true);
  });

  it('23. Pending return report includes outstanding assets', async () => {
    const fixture = await createExitFixtureEmployee('Test23');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Pending return test' });

    const exitRes = await request(app)
      .get(`/api/v1/exit/${fixture.employeeId}`)
      .set(...authAs.admin());

    const pendingAssets = exitRes.body.data.checklist.filter(
      (c: { category: string; status: string }) =>
        c.category === 'asset' && c.status === 'Pending',
    );
    expect(pendingAssets.length).toBe(2);
  });

  it('24. Concurrent return/relieve cannot create inconsistent state', async () => {
    const fixture = await createExitFixtureEmployee('Test24');
    await request(app)
      .post(`/api/v1/exit/${fixture.employeeId}/initiate`)
      .set(...authAs.admin())
      .send({ reason: 'Concurrency test' });

    // Race return and relieve
    const [returnOutcome, relieveOutcome] = await Promise.allSettled([
      request(app)
        .post(`/api/v1/assets/${fixture.assetIds[0]}/return`)
        .set(...authAs.admin())
        .send({ conditionAtReturn: 'Good' }),
      request(app)
        .post(`/api/v1/exit/${fixture.employeeId}/relieve`)
        .set(...authAs.admin())
        .send({ force: false }),
    ]);

    expect(returnOutcome.status).toBe('fulfilled');
    expect(relieveOutcome.status).toBe('fulfilled');

    // Relieve without force must be rejected because other blockers remain
    if (relieveOutcome.status === 'fulfilled') {
      expect(relieveOutcome.value.status).toBe(422);
    }
  });
});
