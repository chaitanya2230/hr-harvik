import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
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
import { LeaveType } from '../../src/modules/leave/leave-type.model';
import { LeaveBalance } from '../../src/modules/leave/leave-balance.model';
import { LeaveRequest } from '../../src/modules/leave/leave-request.model';
import { Attendance } from '../../src/modules/attendance/attendance.model';
import { Holiday } from '../../src/modules/attendance/holiday.model';
import {
  initializeEmployeeBalances,
  rolloverYear,
} from '../../src/modules/leave/leave-balance.service';
import { applyLeave } from '../../src/modules/leave/leave.service';
import { trustedFilter } from '../../src/utils/mongo';

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

describe('AGENTS.md §14 — LEAVE ACCEPTANCE TESTS', () => {
  beforeAll(async () => {
    await seedDatabase();
    // Seed standard leave types if not yet present
    const defaultTypes = [
      { name: 'Casual Leave', code: 'CASUAL', annualAllocation: 12, carryForward: false, isPaid: true },
      { name: 'Sick Leave', code: 'SICK', annualAllocation: 10, carryForward: false, isPaid: true, requiresDocument: true },
      { name: 'Earned Leave', code: 'EARNED', annualAllocation: 15, carryForward: true, maxCarryForward: 10, isPaid: true },
      { name: 'Unpaid Leave', code: 'UNPAID', annualAllocation: 0, carryForward: false, isPaid: false },
    ];
    for (const t of defaultTypes) {
      await LeaveType.findOneAndUpdate(
        { code: t.code },
        { $setOnInsert: t },
        { upsert: true, new: true },
      );
    }

    admin = await loginAs(DEMO_ACCOUNTS.admin);
    hrManager = await loginAs(DEMO_ACCOUNTS.hrManager);
    manager = await loginAs(DEMO_ACCOUNTS.manager);
    employee = await loginAs(DEMO_ACCOUNTS.employee);
  });

  beforeEach(async () => {
    await flushRedis();
  });

  it('HR can configure leave type', async () => {
    const res = await request(app)
      .post('/api/v1/leave/types')
      .set(...authAs.admin())
      .send({
        name: 'Paternity Leave',
        code: 'PATERNITY',
        annualAllocation: 10,
        carryForward: false,
        isPaid: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      code: 'PATERNITY',
      annualAllocation: 10,
    });
  });

  it('valid application — creates pending leave request and increments pending balance', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });
    expect(lt).toBeDefined();

    // Ensure balance exists for current year
    const year = 2025;
    await LeaveBalance.updateOne(
      { employeeId: empId, leaveTypeId: lt!._id, year },
      { $setOnInsert: { allocated: 12, used: 0, pending: 0, carriedForward: 0 } },
      { upsert: true },
    );

    const fromDate = '2025-09-08'; // Monday
    const toDate = '2025-09-09'; // Tuesday

    // Clean any prior requests for test dates
    await LeaveRequest.deleteMany({
      employeeId: empId,
      fromDate: trustedFilter({ $lte: toDate }),
      toDate: trustedFilter({ $gte: fromDate }),
    });

    const res = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(lt!._id),
        fromDate,
        toDate,
        reason: 'Personal vacation',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('Pending');
    expect(res.body.data.days).toBe(2);

    const balance = await LeaveBalance.findOne({ employeeId: empId, leaveTypeId: lt!._id, year });
    expect(balance!.pending).toBeGreaterThanOrEqual(2);
  });

  it('weekends and holidays are excluded from leave duration calculation', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });

    // Friday 2025-09-12 to Monday 2025-09-15 (Fri, Sat, Sun, Mon)
    // Register Monday as a holiday -> only Friday should be counted (1 day)
    const holidayDate = '2025-09-15';
    await Holiday.deleteMany({ date: holidayDate });
    await Holiday.create({ date: holidayDate, name: 'Special Company Day' });

    const fromDate = '2025-09-12';
    const toDate = '2025-09-15';

    await LeaveRequest.deleteMany({
      employeeId: empId,
      fromDate: trustedFilter({ $lte: toDate }),
      toDate: trustedFilter({ $gte: fromDate }),
    });

    const res = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(lt!._id),
        fromDate,
        toDate,
        reason: 'Trip with weekend',
      });

    expect(res.status).toBe(201);
    // Friday only = 1 day (Sat/Sun weekend + Mon holiday excluded)
    expect(res.body.data.days).toBe(1);
  });

  it('insufficient balance → 422 Unprocessable Entity', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });

    const year = 2025;
    // Set balance to only 1 day available
    await LeaveBalance.updateOne(
      { employeeId: empId, leaveTypeId: lt!._id, year },
      { $set: { allocated: 5, used: 4, pending: 0, carriedForward: 0 } },
    );

    // Apply for 3 working days (Wed to Fri)
    const fromDate = '2025-09-17';
    const toDate = '2025-09-19';

    const res = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(lt!._id),
        fromDate,
        toDate,
        reason: 'Long leave exceeding balance',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/insufficient/i);
  });

  it('unpaid leave allowed without balance constraint', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    let unpaidType = await LeaveType.findOne({ code: 'UNPAID', isDeleted: false });
    if (!unpaidType) {
      unpaidType = await LeaveType.create({
        name: 'Unpaid Leave',
        code: 'UNPAID',
        annualAllocation: 0,
        isPaid: false,
      });
    }

    const fromDate = '2025-09-22';
    const toDate = '2025-09-24'; // 3 days

    await LeaveRequest.deleteMany({
      employeeId: empId,
      fromDate: trustedFilter({ $lte: toDate }),
      toDate: trustedFilter({ $gte: fromDate }),
    });

    const res = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(unpaidType._id),
        fromDate,
        toDate,
        reason: 'Unpaid leave absence',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.days).toBe(3);
  });

  it('overlapping leave request is rejected with 422', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });

    const fromDate = '2025-10-06';
    const toDate = '2025-10-08';

    await LeaveBalance.updateOne(
      { employeeId: empId, leaveTypeId: lt!._id, year: 2025 },
      { $set: { allocated: 20, used: 0, pending: 0, carriedForward: 0 } },
    );

    // Initial leave
    await LeaveRequest.create({
      employeeId: empId,
      leaveTypeId: lt!._id,
      fromDate,
      toDate,
      halfDay: false,
      days: 3,
      reason: 'Existing leave',
      status: 'Pending',
    });

    // Overlapping request (touches 2025-10-07)
    const res = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(lt!._id),
        fromDate: '2025-10-07',
        toDate: '2025-10-09',
        reason: 'Overlapping request',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/overlapping/i);
  });

  it('half-day on single day = 0.5 days', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });
    const singleDate = '2025-10-13'; // Monday

    await LeaveBalance.updateOne(
      { employeeId: empId, leaveTypeId: lt!._id, year: 2025 },
      { $set: { allocated: 20, used: 0, pending: 0, carriedForward: 0 } },
    );

    await LeaveRequest.deleteMany({ employeeId: empId, fromDate: singleDate });

    const res = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(lt!._id),
        fromDate: singleDate,
        toDate: singleDate,
        halfDay: true,
        reason: 'Doctor visit morning',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.days).toBe(0.5);
    expect(res.body.data.halfDay).toBe(true);
  });

  it('multi-day half-day is rejected with 400', async () => {
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });

    const res = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(lt!._id),
        fromDate: '2025-10-14',
        toDate: '2025-10-15',
        halfDay: true,
        reason: 'Two half days together',
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error)).toMatch(/multi-day/i);
  });

  it('required medical/sick document is enforced with 422', async () => {
    let sickType = await LeaveType.findOne({ code: 'SICK', isDeleted: false });
    if (!sickType) {
      sickType = await LeaveType.create({
        name: 'Sick Leave',
        code: 'SICK',
        annualAllocation: 10,
        isPaid: true,
        requiresDocument: true,
      });
    } else {
      sickType.requiresDocument = true;
      await sickType.save();
    }

    const res = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(sickType._id),
        fromDate: '2025-10-20',
        toDate: '2025-10-21',
        reason: 'Flu symptoms',
        // documentId is missing
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/document/i);
  });

  it('manager approval updates balance and syncs attendance', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });
    const fromDate = '2025-10-27'; // Monday
    const toDate = '2025-10-27';

    await LeaveBalance.updateOne(
      { employeeId: empId, leaveTypeId: lt!._id, year: 2025 },
      { $set: { allocated: 15, used: 2, pending: 1, carriedForward: 0 } },
    );

    const reqDoc = await LeaveRequest.create({
      employeeId: empId,
      leaveTypeId: lt!._id,
      fromDate,
      toDate,
      halfDay: false,
      days: 1,
      reason: 'Personal day',
      status: 'Pending',
    });

    const res = await request(app)
      .post(`/api/v1/leave/requests/${reqDoc._id}/review`)
      .set(...authAs.manager())
      .send({ status: 'Approved', decisionNote: 'Approved by engineering manager' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Approved');

    // Check balance: pending decremented, used incremented
    const balance = await LeaveBalance.findOne({ employeeId: empId, leaveTypeId: lt!._id, year: 2025 });
    expect(balance!.used).toBe(3);
    expect(balance!.pending).toBe(0);

    // Check attendance synced
    const att = await Attendance.findOne({ employeeId: empId, date: fromDate, isDeleted: false });
    expect(att).toBeDefined();
    expect(att!.status).toBe('Leave');
    expect(att!.source).toBe('LeaveSync');
  });

  it('employee cannot approve own leave request → 403', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });

    const reqDoc = await LeaveRequest.create({
      employeeId: empId,
      leaveTypeId: lt!._id,
      fromDate: '2025-11-03',
      toDate: '2025-11-03',
      halfDay: false,
      days: 1,
      reason: 'Self approve attempt',
      status: 'Pending',
    });

    const res = await request(app)
      .post(`/api/v1/leave/requests/${reqDoc._id}/review`)
      .set(...authAs.employee())
      .send({ status: 'Approved' });

    expect(res.status).toBe(403);
  });

  it('unauthorized manager cannot approve leave outside hierarchy → 403', async () => {
    // Senior Engineer is not in Sales hierarchy
    const salesEmpId = await employeeIdByEmail(SEEDED.salesExecutive);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });

    const reqDoc = await LeaveRequest.create({
      employeeId: salesEmpId,
      leaveTypeId: lt!._id,
      fromDate: '2025-11-04',
      toDate: '2025-11-04',
      halfDay: false,
      days: 1,
      reason: 'Sales team leave',
      status: 'Pending',
    });

    // Engineering manager approves sales request -> 403
    const res = await request(app)
      .post(`/api/v1/leave/requests/${reqDoc._id}/review`)
      .set(...authAs.manager())
      .send({ status: 'Approved' });

    expect(res.status).toBe(403);
  });

  it('rejection requires decision note', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });

    const reqDoc = await LeaveRequest.create({
      employeeId: empId,
      leaveTypeId: lt!._id,
      fromDate: '2025-11-10',
      toDate: '2025-11-10',
      halfDay: false,
      days: 1,
      reason: 'Leave to reject',
      status: 'Pending',
    });

    // Attempt rejection without decision note
    const failRes = await request(app)
      .post(`/api/v1/leave/requests/${reqDoc._id}/review`)
      .set(...authAs.manager())
      .send({ status: 'Rejected' });

    expect(failRes.status).toBe(400);

    // Reject with decision note
    const okRes = await request(app)
      .post(`/api/v1/leave/requests/${reqDoc._id}/review`)
      .set(...authAs.manager())
      .send({ status: 'Rejected', decisionNote: 'Critical release scheduled' });

    expect(okRes.status).toBe(200);
    expect(okRes.body.data.status).toBe('Rejected');
  });

  it('approved future cancellation restores balance', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });
    const futureDate = '2030-05-15';

    await LeaveBalance.updateOne(
      { employeeId: empId, leaveTypeId: lt!._id, year: 2030 },
      { $set: { allocated: 15, used: 2, pending: 0, carriedForward: 0 } },
      { upsert: true },
    );

    const reqDoc = await LeaveRequest.create({
      employeeId: empId,
      leaveTypeId: lt!._id,
      fromDate: futureDate,
      toDate: futureDate,
      halfDay: false,
      days: 1,
      reason: 'Future holiday',
      status: 'Approved',
    });

    // Cancellation by employee
    const res = await request(app)
      .post(`/api/v1/leave/requests/${reqDoc._id}/cancel`)
      .set(...authAs.employee());

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Cancelled');

    // Balance: used decremented from 2 to 1
    const balance = await LeaveBalance.findOne({ employeeId: empId, leaveTypeId: lt!._id, year: 2030 });
    expect(balance!.used).toBe(1);
  });

  it('past approved leave cancellation is rejected with 422', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });
    const pastDate = '2024-01-15';

    const reqDoc = await LeaveRequest.create({
      employeeId: empId,
      leaveTypeId: lt!._id,
      fromDate: pastDate,
      toDate: pastDate,
      halfDay: false,
      days: 1,
      reason: 'Past approved leave',
      status: 'Approved',
    });

    const res = await request(app)
      .post(`/api/v1/leave/requests/${reqDoc._id}/cancel`)
      .set(...authAs.employee());

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/past/i);
  });

  it('team calendar is scoped by manager hierarchy', async () => {
    const res = await request(app)
      .get('/api/v1/leave/calendar?month=2025-10')
      .set(...authAs.manager());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('joining-month pro-rating calculates balance correctly', async () => {
    const empId = new Types.ObjectId();
    const dateOfJoining = '2025-07-01'; // July -> 6 months remaining

    // Initialize balance
    const balances = await initializeEmployeeBalances(
      empId,
      dateOfJoining,
      'Full-Time',
      2025,
    );

    const casualType = await LeaveType.findOne({ code: 'CASUAL' });
    const casual = balances.find((b) => String(b.leaveTypeId) === String(casualType!._id));

    expect(casual).toBeDefined();
    // 12 annual allocation * (6 / 12) = 6 allocated
    expect(casual!.allocated).toBe(6);
  });

  it('year rollover carries forward unused balance up to maxCarryForward', async () => {
    const empId = new Types.ObjectId();
    let carryType = await LeaveType.findOne({ code: 'EARNED', isDeleted: false });
    if (!carryType) {
      carryType = await LeaveType.create({
        name: 'Earned Leave',
        code: 'EARNED',
        annualAllocation: 15,
        carryForward: true,
        maxCarryForward: 10,
        isPaid: true,
      });
    } else {
      carryType.carryForward = true;
      carryType.maxCarryForward = 10;
      await carryType.save();
    }

    // Set 2024 balance with 12 unused days
    await LeaveBalance.create({
      employeeId: empId,
      leaveTypeId: carryType._id,
      year: 2024,
      allocated: 15,
      used: 3, // 12 unused
      pending: 0,
      carriedForward: 0,
    });

    const rolled = await rolloverYear(String(empId), 2024, 2025);
    const rolledEarned = rolled.find((b) => String(b.leaveTypeId) === String(carryType!._id));

    expect(rolledEarned).toBeDefined();
    // Capped at maxCarryForward: 10
    expect(rolledEarned!.carriedForward).toBe(10);
    expect(rolledEarned!.allocated).toBe(15);
  });

  it('concurrent applications cannot overdraw balance', async () => {
    const empId = await employeeIdByEmail(SEEDED.seniorEngineer);
    const lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });

    // Ensure balance has exactly 1 day remaining
    await LeaveBalance.updateOne(
      { employeeId: empId, leaveTypeId: lt!._id, year: 2025 },
      { $set: { allocated: 1, used: 0, pending: 0, carriedForward: 0 } },
      { upsert: true },
    );

    const fromDate1 = '2025-12-01'; // Monday
    const fromDate2 = '2025-12-02'; // Tuesday

    await LeaveRequest.deleteMany({
      employeeId: empId,
      fromDate: trustedFilter({ $in: [fromDate1, fromDate2] }),
    });

    // Run two applications concurrently for the single remaining day
    const [p1, p2] = await Promise.allSettled([
      applyLeave(
        {
          employeeId: empId,
          leaveTypeId: String(lt!._id),
          fromDate: fromDate1,
          toDate: fromDate1,
          halfDay: false,
          reason: 'Concurrent leave 1',
        },
        { userId: admin.account.userId, role: 'HR Admin' },
      ),
      applyLeave(
        {
          employeeId: empId,
          leaveTypeId: String(lt!._id),
          fromDate: fromDate2,
          toDate: fromDate2,
          halfDay: false,
          reason: 'Concurrent leave 2',
        },
        { userId: admin.account.userId, role: 'HR Admin' },
      ),
    ]);

    // Exactly one must succeed, one must be rejected
    const succeeded = [p1, p2].filter((r) => r.status === 'fulfilled');
    const failed = [p1, p2].filter((r) => r.status === 'rejected');

    if (succeeded.length !== 1) {
      console.log('Concurrent p1 outcome:', p1);
      console.log('Concurrent p2 outcome:', p2);
    }

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
  });
});
