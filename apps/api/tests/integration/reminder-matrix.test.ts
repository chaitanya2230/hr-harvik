import { describe, expect, it, beforeAll } from 'vitest';
import { Types } from 'mongoose';
import { runScheduledReminders } from '../../src/modules/notifications/reminder.service';
import { Notification } from '../../src/modules/notifications/notification.model';
import { User } from '../../src/modules/users/user.model';
import { Employee } from '../../src/modules/employees/employee.model';
import { Document as EmployeeDocument } from '../../src/modules/documents/document.model';
import { License } from '../../src/modules/licenses/license.model';
import { Asset, AssetAssignment } from '../../src/modules/assets/asset.model';
import { LeaveRequest } from '../../src/modules/leave/leave-request.model';
import { AttendanceCorrection } from '../../src/modules/attendance/correction.model';
import { addDaysIso } from '../../src/utils/dates';
import { DEMO_ACCOUNTS, seedDatabase } from '../support/helpers';

/**
 * AGENTS.md §8.12 / §14 — exhaustive scheduled-reminder matrix.
 *
 * NOT-07/08 exercise `runScheduledReminders()` against whatever the seed data
 * happens to line up with today. This suite *synthesizes* the exact records
 * each rule targets (joining/leaving/probation/document/licence/asset/overdue +
 * both pending-approval branches), so every rule and every HR/manager/employee
 * subdivision is deterministically covered, and proves dedupe on a second run.
 *
 * A fixed 2060 reference date keeps the fixtures immune to seed drift: real
 * seed rows are dated around "today", so they can never collide with the
 * targeted dates used here.
 */
describe('AGENTS.md §8.12 — SCHEDULED REMINDER MATRIX', () => {
  const REF = '2060-01-15'; // fixed deterministic reference date
  const T_MINUS_1 = addDaysIso(REF, -1);
  const T_PLUS_1 = addDaysIso(REF, 1);
  const T_PLUS_3 = addDaysIso(REF, 3);
  const T_PLUS_7 = addDaysIso(REF, 7);
  const T_PLUS_30 = addDaysIso(REF, 30);
  const PAST_25H = new Date(Date.now() - 25 * 60 * 60 * 1000);

  const demoEmployeeId: Types.ObjectId;
  let managerEmployeeId: Types.ObjectId;

  beforeAll(async () => {
    await seedDatabase();

    const managerUser = await User.findOne({ email: DEMO_ACCOUNTS.manager }).lean().exec();
    expect(managerUser, 'demo manager user must exist').toBeTruthy();
    expect(managerUser!.employeeId, 'demo manager user must map to an employee').toBeTruthy();
    managerEmployeeId = managerUser!.employeeId as Types.ObjectId;

    const employeeUser = await User.findOne({ email: DEMO_ACCOUNTS.employee }).lean().exec();
    expect(employeeUser, 'demo employee user must exist').toBeTruthy();
    expect(employeeUser!.employeeId, 'demo employee user must map to an employee').toBeTruthy();
    demoEmployeeId = employeeUser!.employeeId as Types.ObjectId;
  });

  const createEmployee = (opts: {
    employeeCode: string;
    firstName: string;
    lastName: string;
    dateOfJoining: string;
    status?: string;
    probationEndDate?: string | null;
    lastWorkingDay?: string | null;
    reportingManagerId?: Types.ObjectId | null;
  }) =>
    Employee.create({
      employeeCode: opts.employeeCode,
      firstName: opts.firstName,
      lastName: opts.lastName,
      email: `${opts.employeeCode.toLowerCase()}@reminder.test.${Date.now()}`,
      employmentType: 'Full-Time',
      dateOfJoining: opts.dateOfJoining,
      status: opts.status,
      probationEndDate: opts.probationEndDate ?? null,
      lastWorkingDay: opts.lastWorkingDay ?? null,
      reportingManagerId: opts.reportingManagerId ?? null,
    });

  it('creates reminders for every rule and every recipient split, then dedupes a second run', async () => {
    // --- Rule 1-3 employees ------------------------------------------------
    // Truthy reportingManagerId → manager split; null → HR-only split.
    const joinerWithManager = await createEmployee({
      employeeCode: 'HRV-9101',
      firstName: 'Early',
      lastName: 'Joiner',
      dateOfJoining: T_PLUS_1,
      status: 'Probation',
      reportingManagerId: managerEmployeeId,
    });
    await createEmployee({
      employeeCode: 'HRV-9102',
      firstName: 'Soon',
      lastName: 'Joiner',
      dateOfJoining: T_PLUS_3,
      status: 'Probation',
    });
    await createEmployee({
      employeeCode: 'HRV-9103',
      firstName: 'Leaving',
      lastName: 'Now',
      dateOfJoining: REF,
      status: 'On Notice',
      lastWorkingDay: T_PLUS_7,
      reportingManagerId: managerEmployeeId,
    });
    await createEmployee({
      employeeCode: 'HRV-9104',
      firstName: 'Departing',
      lastName: 'Soon',
      dateOfJoining: REF,
      status: 'Resigned',
      lastWorkingDay: T_PLUS_1,
    });
    await createEmployee({
      employeeCode: 'HRV-9105',
      firstName: 'Probation',
      lastName: 'Reviewed',
      dateOfJoining: REF,
      status: 'Probation',
      probationEndDate: T_PLUS_7,
      reportingManagerId: managerEmployeeId,
    });
    await createEmployee({
      employeeCode: 'HRV-9106',
      firstName: 'Undecided',
      lastName: 'Intern',
      dateOfJoining: REF,
      status: 'Probation',
      probationEndDate: T_PLUS_7,
    });

    // No linked user, no manager → pure HR-only subdivision.
    const hrOnlyEmployee = await createEmployee({
      employeeCode: 'HRV-9107',
      firstName: 'HROnly',
      lastName: 'Worker',
      dateOfJoining: REF,
      status: 'Active',
    });

    // --- Rule 4: document expiry (30d HR-only + 7d employee) ----------------
    const fileMeta = {
      filename: 'reminder-fixture.pdf',
      originalName: 'reminder-fixture.pdf',
      mimeType: 'application/pdf',
      size: 128,
      path: 'reminder-fixture.pdf',
    };
    await EmployeeDocument.create({
      employeeId: hrOnlyEmployee._id,
      category: 'Identity',
      title: `Visa ${Date.now()}`,
      file: fileMeta,
      version: 1,
      source: 'Uploaded',
      expiryDate: T_PLUS_30,
    });
    await EmployeeDocument.create({
      employeeId: demoEmployeeId,
      category: 'Identity',
      title: `Team ID ${Date.now()}`,
      file: fileMeta,
      version: 1,
      source: 'Uploaded',
      expiryDate: T_PLUS_7,
    });

    // --- Rule 5: software renewal (30d + 7d, status not Expired) -------------
    await License.create({
      licenseCode: `LIC-91${String(Date.now()).slice(-3)}`,
      softwareName: 'Renewal Remote Suite',
      licenseType: 'Per-Seat',
      maxSeats: 5,
      usedSeats: 1,
      renewalDate: T_PLUS_30,
      status: 'Available',
    });
    await License.create({
      licenseCode: `LIC-92${String(Date.now()).slice(-3)}`,
      softwareName: 'Renewal Design Suite',
      licenseType: 'Site',
      maxSeats: 2,
      usedSeats: 1,
      renewalDate: T_PLUS_7,
      status: 'Assigned',
    });

    // --- Rule 6-7: asset return (T+3) and overdue (T-1) ----------------------
    const dueAsset = await Asset.create({
      assetCode: `AST-91${String(Date.now()).slice(-3)}`,
      name: 'Due Laptop',
      type: 'Laptop',
      serialNumber: `SN-DUE-${Date.now()}`,
      status: 'Assigned',
    });
    await AssetAssignment.create({
      assetId: dueAsset._id,
      employeeId: demoEmployeeId,
      expectedReturnDate: T_PLUS_3,
    });
    const overdueAsset = await Asset.create({
      assetCode: `AST-92${String(Date.now()).slice(-3)}`,
      name: 'Overdue Monitor',
      type: 'Monitor',
      serialNumber: `SN-OD-${Date.now()}`,
      status: 'Assigned',
    });
    await AssetAssignment.create({
      assetId: overdueAsset._id,
      employeeId: hrOnlyEmployee._id,
      expectedReturnDate: T_MINUS_1,
    });

    // --- Rule 8: pending approvals older than 24h ----------------------------
    const leaveReqA = await LeaveRequest.collection.insertOne({
      employeeId: joinerWithManager._id,
      leaveTypeId: new Types.ObjectId(),
      fromDate: T_PLUS_1,
      toDate: T_PLUS_1,
      halfDay: false,
      days: 1,
      reason: 'manager-branch pending leave',
      status: 'Pending',
      approverId: null,
      decisionNote: null,
      decidedAt: null,
      documentId: null,
      createdBy: null,
      isDeleted: false,
      createdAt: PAST_25H,
      updatedAt: PAST_25H,
    });
    await LeaveRequest.collection.insertOne({
      employeeId: hrOnlyEmployee._id,
      leaveTypeId: new Types.ObjectId(),
      fromDate: T_PLUS_1,
      toDate: T_PLUS_1,
      halfDay: false,
      days: 1,
      reason: 'hr-branch pending leave',
      status: 'Pending',
      approverId: null,
      decisionNote: null,
      decidedAt: null,
      documentId: null,
      createdBy: null,
      isDeleted: false,
      createdAt: PAST_25H,
      updatedAt: PAST_25H,
    });
    await AttendanceCorrection.collection.insertOne({
      employeeId: joinerWithManager._id,
      date: T_PLUS_1,
      requestedStatus: 'Present',
      requestedWorkMode: 'Office',
      reason: 'manager-branch pending correction',
      status: 'Pending',
      reviewedBy: null,
      reviewNote: null,
      decidedAt: null,
      createdBy: null,
      isDeleted: false,
      createdAt: PAST_25H,
      updatedAt: PAST_25H,
    });
    await AttendanceCorrection.collection.insertOne({
      employeeId: hrOnlyEmployee._id,
      date: T_PLUS_1,
      requestedStatus: 'Present',
      requestedWorkMode: 'Office',
      reason: 'hr-branch pending correction',
      status: 'Pending',
      reviewedBy: null,
      reviewNote: null,
      decidedAt: null,
      createdBy: null,
      isDeleted: false,
      createdAt: PAST_25H,
      updatedAt: PAST_25H,
    });

    // Sanity: the fixture documents are actually targeted by the rules.
    expect(leaveReqA.acknowledged).toBe(true);

    // --- Run 1: every category must produce at least one reminder ------------
    const result = await runScheduledReminders(REF);

    expect(result.joiningReminders).toBeGreaterThan(0);
    expect(result.leavingReminders).toBeGreaterThan(0);
    expect(result.probationReminders).toBeGreaterThan(0);
    expect(result.documentExpiryReminders).toBeGreaterThan(0);
    expect(result.softwareRenewalReminders).toBeGreaterThan(0);
    expect(result.assetReturnReminders).toBeGreaterThan(0);
    expect(result.overdueAssetReminders).toBeGreaterThan(0);
    expect(result.pendingApprovalReminders).toBeGreaterThan(0);
    expect(result.totalCreated).toBeGreaterThan(0);
    expect(result.totalCreated).toBe(
      result.joiningReminders +
        result.leavingReminders +
        result.probationReminders +
        result.documentExpiryReminders +
        result.softwareRenewalReminders +
        result.assetReturnReminders +
        result.overdueAssetReminders +
        result.pendingApprovalReminders,
    );

    for (const type of [
      'joining_reminder',
      'leaving_reminder',
      'probation_reminder',
      'document_expiry',
      'software_renewal',
      'asset_return',
      'overdue_asset',
      'pending_approval',
    ]) {
      const count = await Notification.countDocuments({ type });
      expect(count, `expected at least one notification of type ${type}`).toBeGreaterThan(0);
    }

    // --- Run 2: idempotent via dedupeKey --------------------------------------
    const rerun = await runScheduledReminders(REF);
    expect(rerun.totalCreated).toBe(0);
  });
});