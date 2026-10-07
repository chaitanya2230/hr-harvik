import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getApp, loginAs, bearer } from '../support/helpers';
import { runSeed } from '../../src/seed';
import { connectMongo, disconnectMongo } from '../../src/db/mongo';
import { Notification } from '../../src/modules/notifications/notification.model';
import { runScheduledReminders } from '../../src/modules/notifications/reminder.service';
import { createNotification } from '../../src/modules/notifications/notification.service';
import { LeaveType } from '../../src/modules/leave/leave-type.model';
import { addDaysIso, todayInTimeZone } from '../../src/utils/dates';
import { trustedFilter } from '../../src/utils/mongo';

describe('Notifications Integration Tests (NOT-01 .. NOT-12)', () => {
  let adminToken: string;
  let adminUserId: string;
  let managerToken: string;
  let managerUserId: string;
  let employeeToken: string;
  let employeeUserId: string;

  beforeAll(async () => {
    await connectMongo();
    await runSeed();

    const admin = await loginAs('admin@harviktech.com');
    adminToken = admin.accessToken;
    adminUserId = admin.account.userId;

    const manager = await loginAs('manager@harviktech.com');
    managerToken = manager.accessToken;
    managerUserId = manager.account.userId;

    const emp = await loginAs('employee@harviktech.com');
    employeeToken = emp.accessToken;
    employeeUserId = emp.account.userId;
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  // NOT-01: List notifications
  it('NOT-01: User can list their own notifications with pagination and metadata', async () => {
    // Create a notification for admin
    await createNotification({
      userId: adminUserId,
      type: 'general',
      title: 'Welcome to Harvik HR',
      body: 'Your HR admin dashboard is active.',
    });

    const res = await request(getApp())
      .get('/api/v1/notifications')
      .set(...bearer(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta.unreadCount).toBeGreaterThanOrEqual(1);
  });

  // NOT-02: Get unread count
  it('NOT-02: User can get their current unread count', async () => {
    const res = await request(getApp())
      .get('/api/v1/notifications/unread-count')
      .set(...bearer(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBeDefined();
    expect(typeof res.body.data.unreadCount).toBe('number');
  });

  // NOT-03: Mark single notification as read
  it('NOT-03: User can mark an individual notification as read', async () => {
    const notif = await createNotification({
      userId: adminUserId,
      type: 'general',
      title: 'Test Notification to Read',
      body: 'Will be marked read.',
    });
    expect(notif).toBeDefined();

    const res = await request(getApp())
      .patch(`/api/v1/notifications/${notif!._id}/read`)
      .set(...bearer(adminToken))
      .send({ read: true });

    expect(res.status).toBe(200);
    expect(res.body.data.readAt).not.toBeNull();
  });

  // NOT-04: User cannot read another user's notification
  it('NOT-04: User cannot access or mark another user notification as read (forbidden)', async () => {
    // Create notification owned by admin
    const adminNotif = await createNotification({
      userId: adminUserId,
      type: 'general',
      title: 'Admin only notification',
      body: 'Confidential.',
    });

    // Manager tries to mark admin's notification as read
    const res = await request(getApp())
      .patch(`/api/v1/notifications/${adminNotif!._id}/read`)
      .set(...bearer(managerToken))
      .send({ read: true });

    expect(res.status).toBe(403);
  });

  // NOT-05: Mark all notifications as read
  it('NOT-05: User can mark all their unread notifications as read at once', async () => {
    await createNotification({
      userId: employeeUserId,
      type: 'general',
      title: 'Emp Notice 1',
      body: 'Notice 1',
    });
    await createNotification({
      userId: employeeUserId,
      type: 'general',
      title: 'Emp Notice 2',
      body: 'Notice 2',
    });

    const res = await request(getApp())
      .post('/api/v1/notifications/mark-all-read')
      .set(...bearer(employeeToken));

    expect(res.status).toBe(200);
    expect(res.body.data.modifiedCount).toBeGreaterThanOrEqual(1);

    const countRes = await request(getApp())
      .get('/api/v1/notifications/unread-count')
      .set(...bearer(employeeToken));

    expect(countRes.body.data.unreadCount).toBe(0);
  });

  // NOT-06: Filter notifications by read status
  it('NOT-06: Can filter notifications by read=true or read=false', async () => {
    const unreadRes = await request(getApp())
      .get('/api/v1/notifications?read=false')
      .set(...bearer(adminToken));

    expect(unreadRes.status).toBe(200);
    for (const item of unreadRes.body.data) {
      expect(item.readAt).toBeNull();
    }
  });

  // NOT-07: Trigger scheduled reminders
  it('NOT-07: Running scheduled reminders generates reminder notifications', async () => {
    const result = await runScheduledReminders();
    expect(result).toBeDefined();
    expect(typeof result.totalCreated).toBe('number');
  });

  // NOT-08: Deduplication prevents duplicate notifications
  it('NOT-08: Repeated runs of scheduled reminders do not create duplicate notifications due to dedupeKey', async () => {
    // First run may create the day's reminders; the second immediate run
    // must be a no-op because every reminder carries a deterministic
    // dedupeKey that is already persisted.
    await runScheduledReminders();
    const run2 = await runScheduledReminders();

    // The second immediate run on the same date should create 0 new notifications
    expect(run2.totalCreated).toBe(0);
  });

  // NOT-09: Leave application triggers notification
  it('NOT-09: Applying for leave triggers an in-app notification', async () => {
    const leaveType = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });
    expect(leaveType).toBeDefined();

    const today = todayInTimeZone();
    const fromDate = addDaysIso(today, 60);
    const toDate = addDaysIso(today, 61);

    const applyRes = await request(getApp())
      .post('/api/v1/leave/requests')
      .set(...bearer(employeeToken))
      .send({
        leaveTypeId: leaveType!._id.toString(),
        fromDate,
        toDate,
        reason: 'Family vacation',
        halfDay: false,
      });

    expect(applyRes.status).toBe(201);
    const leaveId = applyRes.body.data.id;
    expect(leaveId).toBeDefined();

    // Check manager's notifications for leave request notification
    const notifs = await Notification.find({
      userId: managerUserId,
      type: 'leave_status',
    }).lean().exec();

    expect(notifs.length).toBeGreaterThan(0);
  });

  // NOT-10: Leave decision triggers notification to employee
  it('NOT-10: Approving leave triggers notification to applying employee', async () => {
    const leaveType = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false });
    const today = todayInTimeZone();
    const fromDate = addDaysIso(today, 70);
    const toDate = addDaysIso(today, 70);

    const applyRes = await request(getApp())
      .post('/api/v1/leave/requests')
      .set(...bearer(employeeToken))
      .send({
        leaveTypeId: leaveType!._id.toString(),
        fromDate,
        toDate,
        reason: 'Personal errand',
        halfDay: false,
      });

    expect(applyRes.status).toBe(201);
    const leaveId = applyRes.body.data.id;
    expect(leaveId).toBeDefined();

    // Admin approves it
    const approveRes = await request(getApp())
      .patch(`/api/v1/leave/requests/${leaveId}/review`)
      .set(...bearer(adminToken))
      .send({
        status: 'Approved',
        decisionNote: 'Enjoy your day',
      });

    expect(approveRes.status).toBe(200);

    // Check employee's notifications
    const empNotifs = await Notification.find({
      userId: employeeUserId,
      type: 'leave_status',
      title: /Approved/,
    }).lean().exec();

    expect(empNotifs.length).toBeGreaterThan(0);
  });

  // NOT-11: Manual trigger endpoint for HR Admin
  it('NOT-11: HR Admin can invoke trigger-reminders API endpoint', async () => {
    const res = await request(getApp())
      .post('/api/v1/notifications/trigger-reminders')
      .set(...bearer(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  // NOT-12: Unauthenticated notification request returns 401
  it('NOT-12: Unauthenticated notification requests return 401', async () => {
    const res = await request(getApp()).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  // NOT-13: Scheduled engine genuinely fires on matching fixtures (not vacuously zero)
  it('NOT-13: runScheduledReminders creates a joining reminder for a +3-day joiner, then dedupes on rerun', async () => {
    const joinDate = addDaysIso(todayInTimeZone(), 3);
    const createRes = await request(getApp())
      .post('/api/v1/employees')
      .set(...bearer(adminToken))
      .send({
        firstName: 'Soon',
        lastName: `Joining${Date.now()}`,
        email: `soon.joining.${Date.now()}@harviktech.com`,
        employmentType: 'Full-Time',
        dateOfJoining: joinDate,
      });
    expect(createRes.status).toBe(201);

    const run1 = await runScheduledReminders();
    expect(run1.joiningReminders).toBeGreaterThan(0);

    const stored = await Notification.find({
      type: 'joining_reminder',
      body: trustedFilter({ $regex: joinDate }),
    })
      .lean()
      .exec();
    expect(stored.length).toBeGreaterThan(0);

    const run2 = await runScheduledReminders();
    expect(run2.totalCreated).toBe(0);
  });
});
