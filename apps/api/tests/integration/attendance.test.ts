import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { SEEDED, employeeIdByEmail } from '../support/employee-fixtures';
import { Attendance } from '../../src/modules/attendance/attendance.model';
import { AttendanceCorrection } from '../../src/modules/attendance/correction.model';
import { Holiday } from '../../src/modules/attendance/holiday.model';
import { LeaveRequest } from '../../src/modules/leave/leave-request.model';
import { LeaveType } from '../../src/modules/leave/leave-type.model';
import { Employee } from '../../src/modules/employees/employee.model';
import { runNightlyAttendanceJob } from '../../src/modules/attendance/attendance.service';
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

describe('AGENTS.md §14 — ATTENDANCE', () => {
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

  it('create valid attendance — creates Present attendance with Office workMode', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const date = '2025-06-02'; // Monday in the past

    // Clean any existing entry for test isolation
    await Attendance.deleteMany({ employeeId: empId, date });

    const res = await request(app)
      .post('/api/v1/attendance')
      .set(...authAs.hrManager())
      .send({
        employeeId: empId,
        date,
        status: 'Present',
        workMode: 'Office',
        checkIn: '09:00',
        checkOut: '18:00',
        note: 'Normal day',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      date,
      status: 'Present',
      workMode: 'Office',
    });
  });

  it('duplicate date → 409 Conflict', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const date = '2025-06-03';

    await Attendance.deleteMany({ employeeId: empId, date });

    // First creation
    const res1 = await request(app)
      .post('/api/v1/attendance')
      .set(...authAs.hrManager())
      .send({
        employeeId: empId,
        date,
        status: 'Present',
        workMode: 'WFH',
      });
    expect(res1.status).toBe(201);

    // Duplicate creation
    const res2 = await request(app)
      .post('/api/v1/attendance')
      .set(...authAs.hrManager())
      .send({
        employeeId: empId,
        date,
        status: 'Present',
      });
    expect(res2.status).toBe(409);
  });

  it('future date → 422 Unprocessable Entity', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const futureDate = '2030-01-01';

    const res = await request(app)
      .post('/api/v1/attendance')
      .set(...authAs.hrManager())
      .send({
        employeeId: empId,
        date: futureDate,
        status: 'Present',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/future/i);
  });

  it('WFH on Absent → rejected with 422', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const date = '2025-06-04';

    const res = await request(app)
      .post('/api/v1/attendance')
      .set(...authAs.hrManager())
      .send({
        employeeId: empId,
        date,
        status: 'Absent',
        workMode: 'WFH',
      });

    expect(res.status).toBe(422);
  });

  it('Relieved employee cannot receive attendance after last working day → 422', async () => {
    const empId = await employeeIdByEmail(SEEDED.contractor);
    const original = await Employee.findById(empId);
    await Employee.updateOne(
      { _id: empId },
      { $set: { status: 'Relieved', lastWorkingDay: '2025-05-31' } },
    );

    const afterLwd = '2025-06-01'; // 1 day after LWD

    const res = await request(app)
      .post('/api/v1/attendance')
      .set(...authAs.admin())
      .send({
        employeeId: empId,
        date: afterLwd,
        status: 'Present',
      });

    // Restore original status
    await Employee.updateOne({ _id: empId }, { $set: { status: original?.status } });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Relieved employee cannot receive attendance/i);
  });

  it('correction request — employee can request attendance correction', async () => {
    const date = '2025-06-05';

    const res = await request(app)
      .post('/api/v1/attendance/corrections')
      .set(...authAs.employee())
      .send({
        date,
        requestedStatus: 'Present',
        requestedWorkMode: 'WFH',
        reason: 'Forgot to check in from home',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      date,
      requestedStatus: 'Present',
      requestedWorkMode: 'WFH',
      status: 'Pending',
    });
  });

  it('employee cannot approve own correction → 403', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const date = '2025-06-06';

    const correction = await AttendanceCorrection.create({
      employeeId: empId,
      date,
      requestedStatus: 'Present',
      reason: 'Need approval',
      status: 'Pending',
    });

    const res = await request(app)
      .post(`/api/v1/attendance/corrections/${correction._id}/review`)
      .set(...authAs.employee())
      .send({ status: 'Approved' });

    expect(res.status).toBe(403);
  });

  it('manager can approve team member correction', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const date = '2025-06-09';

    await Attendance.deleteMany({ employeeId: empId, date });

    const correction = await AttendanceCorrection.create({
      employeeId: empId,
      date,
      requestedStatus: 'Present',
      requestedWorkMode: 'Office',
      reason: 'Forgot punch',
      status: 'Pending',
    });

    const res = await request(app)
      .post(`/api/v1/attendance/corrections/${correction._id}/review`)
      .set(...authAs.manager())
      .send({ status: 'Approved', reviewNote: 'Approved by manager' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Approved');

    // Attendance record should now exist with source Correction
    const att = await Attendance.findOne({ employeeId: empId, date, isDeleted: false });
    expect(att).toBeDefined();
    expect(att!.status).toBe('Present');
    expect(att!.source).toBe('Correction');
  });

  it('HR can correct attendance directly', async () => {
    const empId = await employeeIdByEmail(SEEDED.seniorEngineer);
    const date = '2025-06-10';

    await Attendance.deleteMany({ employeeId: empId, date });

    const res = await request(app)
      .post('/api/v1/attendance')
      .set(...authAs.hrManager())
      .send({
        employeeId: empId,
        date,
        status: 'Half Day',
        workMode: 'Office',
        note: 'HR recorded half-day',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('Half Day');
  });

  it('nightly holiday job — marks Holiday for employees', async () => {
    const holidayDate = '2025-08-15'; // Independence Day in past

    await Holiday.deleteMany({ date: holidayDate });
    await Holiday.create({ date: holidayDate, name: 'Independence Day' });

    await Attendance.deleteMany({ date: holidayDate });

    const result = await runNightlyAttendanceJob(holidayDate);
    expect(result.holidays).toBeGreaterThan(0);

    const holidayRecords = await Attendance.find({ date: holidayDate, status: 'Holiday' });
    expect(holidayRecords.length).toBeGreaterThanOrEqual(1);
    expect(holidayRecords[0].note).toBe('Independence Day');
  });

  it('nightly leave job — marks Leave for approved leave', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const leaveDate = '2025-07-07'; // Monday

    await Attendance.deleteMany({ date: leaveDate });

    // Seed a leave type
    let lt = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });
    if (!lt) {
      lt = await LeaveType.create({
        name: 'Casual Leave',
        code: 'CASUAL',
        annualAllocation: 12,
        isPaid: true,
      });
    }

    // Create an approved leave request covering leaveDate
    await LeaveRequest.create({
      employeeId: empId,
      leaveTypeId: lt._id,
      fromDate: leaveDate,
      toDate: leaveDate,
      halfDay: false,
      days: 1,
      reason: 'Personal',
      status: 'Approved',
    });

    const result = await runNightlyAttendanceJob(leaveDate);
    expect(result.leaves).toBeGreaterThan(0);

    const leaveAtt = await Attendance.findOne({ employeeId: empId, date: leaveDate });
    expect(leaveAtt).toBeDefined();
    expect(leaveAtt!.status).toBe('Leave');
    expect(leaveAtt!.source).toBe('LeaveSync');
  });

  it('nightly weekend job — does NOT mark Absent on weekends', async () => {
    const weekendDate = '2025-07-12'; // Saturday

    await Attendance.deleteMany({ date: weekendDate });

    const result = await runNightlyAttendanceJob(weekendDate);
    expect(result.absents).toBe(0);

    const weekendAbsents = await Attendance.find({ date: weekendDate, status: 'Absent' });
    expect(weekendAbsents.length).toBe(0);
  });

  it('nightly absent job — marks unrecorded working days as Absent', async () => {
    const weekday = '2025-07-15'; // Tuesday

    await Attendance.deleteMany({ date: weekday });
    await Holiday.deleteMany({ date: weekday });
    await LeaveRequest.deleteMany({
      fromDate: trustedFilter({ $lte: weekday }),
      toDate: trustedFilter({ $gte: weekday }),
    });

    const result = await runNightlyAttendanceJob(weekday);
    expect(result.absents).toBeGreaterThan(0);

    const absentRecords = await Attendance.find({ date: weekday, status: 'Absent' });
    expect(absentRecords.length).toBeGreaterThan(0);
  });

  it('nightly job is idempotent on reruns', async () => {
    const weekday = '2025-07-16'; // Wednesday

    await Attendance.deleteMany({ date: weekday });
    await Holiday.deleteMany({ date: weekday });

    const firstRun = await runNightlyAttendanceJob(weekday);
    expect(firstRun.created).toBeGreaterThan(0);

    const countAfterFirst = await Attendance.countDocuments({ date: weekday });

    // Second run
    const secondRun = await runNightlyAttendanceJob(weekday);
    expect(secondRun.created).toBe(0);
    expect(secondRun.skipped).toBeGreaterThanOrEqual(firstRun.created);

    const countAfterSecond = await Attendance.countDocuments({ date: weekday });
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('monthly grid — returns matrix of employee attendance', async () => {
    const res = await request(app)
      .get('/api/v1/attendance/monthly?month=2025-07')
      .set(...authAs.hrManager());

    expect(res.status).toBe(200);
    expect(res.body.data.yearMonth).toBe('2025-07');
    expect(Array.isArray(res.body.data.records)).toBe(true);
  });

  it('concurrent correction reviews — the same Pending correction is decided exactly once', async () => {
    const empId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const date = '2025-06-11';

    await Attendance.deleteMany({ employeeId: empId, date });
    await AttendanceCorrection.deleteMany({ employeeId: empId, date });

    const correction = await AttendanceCorrection.create({
      employeeId: empId,
      date,
      requestedStatus: 'Present',
      requestedWorkMode: 'Office',
      reason: 'Concurrent review race target',
      status: 'Pending',
    });
    const correctionId = String(correction._id);

    const { reviewAttendanceCorrection } = await import(
      '../../src/modules/attendance/attendance.service'
    );
    const reviewer = {
      userId: manager.account.userId,
      role: 'Manager' as const,
      employeeId: manager.account.employeeId,
    };
    const attempts = await Promise.allSettled(
      [1, 2, 3].map(() =>
        reviewAttendanceCorrection(correctionId, { status: 'Approved' as const }, reviewer),
      ),
    );

    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(2);

    // Exactly one attendance record exists despite three concurrent approvals.
    const records = await Attendance.find({ employeeId: empId, date }).lean();
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('Present');
  });
});
