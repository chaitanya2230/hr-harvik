import { Types } from 'mongoose';
import { Employee } from '../employees/employee.model';
import { Document as EmployeeDocument } from '../documents/document.model';
import { License } from '../licenses/license.model';
import { Asset, AssetAssignment } from '../assets/asset.model';
import { LeaveRequest } from '../leave/leave-request.model';
import { AttendanceCorrection } from '../attendance/correction.model';
import { User } from '../users/user.model';
import { createNotification } from './notification.service';
import { todayInTimeZone, addDaysIso } from '../../utils/dates';
import { logger } from '../../utils/logger';
import { trustedFilter } from '../../utils/mongo';

export interface ReminderRunResult {
  joiningReminders: number;
  leavingReminders: number;
  probationReminders: number;
  documentExpiryReminders: number;
  softwareRenewalReminders: number;
  assetReturnReminders: number;
  overdueAssetReminders: number;
  pendingApprovalReminders: number;
  totalCreated: number;
}

export async function getHrUsers(): Promise<Array<{ _id: Types.ObjectId; email: string; role: string }>> {
  return await User.find({
    role: trustedFilter({ $in: ['HR Admin', 'HR Manager'] }),
    isActive: true,
  })
    .select('_id email role')
    .lean()
    .exec();
}

export async function getUserForEmployee(
  employeeId: string | Types.ObjectId,
): Promise<{ _id: Types.ObjectId; email: string } | null> {
  const empObjectId = typeof employeeId === 'string' ? new Types.ObjectId(employeeId) : employeeId;
  return await User.findOne({ employeeId: empObjectId, isActive: true })
    .select('_id email')
    .lean()
    .exec();
}

/**
 * AGENTS.md §8.12 — Scheduled reminders runner.
 * Evaluates all 7 scheduled rules with idempotent deduplication via dedupeKey.
 */
export async function runScheduledReminders(referenceDate?: string): Promise<ReminderRunResult> {
  const today = referenceDate || todayInTimeZone();
  const hrUsers = await getHrUsers();

  let joiningCount = 0;
  let leavingCount = 0;
  let probationCount = 0;
  let docExpiryCount = 0;
  let licRenewalCount = 0;
  let assetReturnCount = 0;
  let overdueAssetCount = 0;
  let pendingApprovalCount = 0;
  let totalCreated = 0;

  // 1. Employee Joining: 3 and 1 day before
  const joiningTargets = [
    { days: 3, targetDate: addDaysIso(today, 3) },
    { days: 1, targetDate: addDaysIso(today, 1) },
  ];

  for (const { days, targetDate } of joiningTargets) {
    const upcomingJoiners = await Employee.find({
      dateOfJoining: targetDate,
      isDeleted: false,
    }).lean().exec();

    for (const emp of upcomingJoiners) {
      const dedupeBase = `joining:${emp._id}:${days}:${targetDate}`;
      // Notify HR
      for (const hr of hrUsers) {
        const res = await createNotification({
          userId: hr._id,
          type: 'joining_reminder',
          title: `Upcoming Joiner: ${emp.firstName} ${emp.lastName}`,
          body: `${emp.firstName} ${emp.lastName} is scheduled to join in ${days} day(s) on ${targetDate}.`,
          link: `/employees/${emp._id}`,
          dueAt: new Date(targetDate),
          dedupeKey: `${dedupeBase}:hr:${hr._id}`,
          sendEmailAlert: true,
        });
        if (res) {
          joiningCount += 1;
          totalCreated += 1;
        }
      }

      // Notify reporting manager if present
      if (emp.reportingManagerId) {
        const managerUser = await getUserForEmployee(emp.reportingManagerId);
        if (managerUser) {
          const res = await createNotification({
            userId: managerUser._id,
            type: 'joining_reminder',
            title: `Team Member Joining: ${emp.firstName} ${emp.lastName}`,
            body: `${emp.firstName} ${emp.lastName} will join your team in ${days} day(s) on ${targetDate}.`,
            link: `/employees/${emp._id}`,
            dueAt: new Date(targetDate),
            dedupeKey: `${dedupeBase}:mgr:${managerUser._id}`,
            sendEmailAlert: true,
          });
          if (res) {
            joiningCount += 1;
            totalCreated += 1;
          }
        }
      }
    }
  }

  // 2. Employee Leaving: 7 and 1 day before
  const leavingTargets = [
    { days: 7, targetDate: addDaysIso(today, 7) },
    { days: 1, targetDate: addDaysIso(today, 1) },
  ];

  for (const { days, targetDate } of leavingTargets) {
    const leavingEmployees = await Employee.find({
      status: trustedFilter({ $in: ['On Notice', 'Resigned'] }),
      lastWorkingDay: targetDate,
      isDeleted: false,
    }).lean().exec();

    for (const emp of leavingEmployees) {
      const dedupeBase = `leaving:${emp._id}:${days}:${targetDate}`;
      for (const hr of hrUsers) {
        const res = await createNotification({
          userId: hr._id,
          type: 'leaving_reminder',
          title: `Exit Reminder: ${emp.firstName} ${emp.lastName}`,
          body: `${emp.firstName} ${emp.lastName}'s last working day is in ${days} day(s) (${targetDate}). Verify exit checklist.`,
          link: `/exit`,
          dueAt: new Date(targetDate),
          dedupeKey: `${dedupeBase}:hr:${hr._id}`,
          sendEmailAlert: true,
        });
        if (res) {
          leavingCount += 1;
          totalCreated += 1;
        }
      }

      if (emp.reportingManagerId) {
        const managerUser = await getUserForEmployee(emp.reportingManagerId);
        if (managerUser) {
          const res = await createNotification({
            userId: managerUser._id,
            type: 'leaving_reminder',
            title: `Exit Reminder: ${emp.firstName} ${emp.lastName}`,
            body: `${emp.firstName} ${emp.lastName}'s last working day is in ${days} day(s) (${targetDate}). Complete manager clearance.`,
            link: `/exit`,
            dueAt: new Date(targetDate),
            dedupeKey: `${dedupeBase}:mgr:${managerUser._id}`,
            sendEmailAlert: true,
          });
          if (res) {
            leavingCount += 1;
            totalCreated += 1;
          }
        }
      }
    }
  }

  // 3. Probation Completion: 7 days before
  const probationTargetDate = addDaysIso(today, 7);
  const probationEmployees = await Employee.find({
    status: 'Probation',
    probationEndDate: probationTargetDate,
    isDeleted: false,
  }).lean().exec();

  for (const emp of probationEmployees) {
    const dedupeBase = `probation:${emp._id}:${probationTargetDate}`;
    for (const hr of hrUsers) {
      const res = await createNotification({
        userId: hr._id,
        type: 'probation_reminder',
        title: `Probation Ending: ${emp.firstName} ${emp.lastName}`,
        body: `${emp.firstName} ${emp.lastName}'s probation ends in 7 days (${probationTargetDate}). Review performance.`,
        link: `/employees/${emp._id}`,
        dueAt: new Date(probationTargetDate),
        dedupeKey: `${dedupeBase}:hr:${hr._id}`,
        sendEmailAlert: true,
      });
      if (res) {
        probationCount += 1;
        totalCreated += 1;
      }
    }

    if (emp.reportingManagerId) {
      const managerUser = await getUserForEmployee(emp.reportingManagerId);
      if (managerUser) {
        const res = await createNotification({
          userId: managerUser._id,
          type: 'probation_reminder',
          title: `Probation Ending: ${emp.firstName} ${emp.lastName}`,
          body: `${emp.firstName} ${emp.lastName}'s probation ends in 7 days (${probationTargetDate}). Provide evaluation.`,
          link: `/employees/${emp._id}`,
          dueAt: new Date(probationTargetDate),
          dedupeKey: `${dedupeBase}:mgr:${managerUser._id}`,
          sendEmailAlert: true,
        });
        if (res) {
          probationCount += 1;
          totalCreated += 1;
        }
      }
    }
  }

  // 4. Document Expiry: 30 and 7 days before
  const docExpiryTargets = [
    { days: 30, targetDate: addDaysIso(today, 30) },
    { days: 7, targetDate: addDaysIso(today, 7) },
  ];

  for (const { days, targetDate } of docExpiryTargets) {
    const expiringDocs = await EmployeeDocument.find({
      expiryDate: targetDate,
      isDeleted: false,
    }).lean().exec();

    for (const doc of expiringDocs) {
      const dedupeBase = `doc-expiry:${doc._id}:${days}:${targetDate}`;
      // Notify HR
      for (const hr of hrUsers) {
        const res = await createNotification({
          userId: hr._id,
          type: 'document_expiry',
          title: `Document Expiry: ${doc.title}`,
          body: `Document "${doc.title}" expires in ${days} days (${targetDate}).`,
          link: `/documents`,
          dueAt: new Date(targetDate),
          dedupeKey: `${dedupeBase}:hr:${hr._id}`,
          sendEmailAlert: false,
        });
        if (res) {
          docExpiryCount += 1;
          totalCreated += 1;
        }
      }

      // Notify the employee
      const empUser = await getUserForEmployee(doc.employeeId);
      if (empUser) {
        const res = await createNotification({
          userId: empUser._id,
          type: 'document_expiry',
          title: `Document Expiring: ${doc.title}`,
          body: `Your document "${doc.title}" expires in ${days} days (${targetDate}). Please upload renewal.`,
          link: `/documents`,
          dueAt: new Date(targetDate),
          dedupeKey: `${dedupeBase}:emp:${empUser._id}`,
          sendEmailAlert: true,
        });
        if (res) {
          docExpiryCount += 1;
          totalCreated += 1;
        }
      }
    }
  }

  // 5. Software Renewal: 30 and 7 days before
  const licRenewalTargets = [
    { days: 30, targetDate: addDaysIso(today, 30) },
    { days: 7, targetDate: addDaysIso(today, 7) },
  ];

  for (const { days, targetDate } of licRenewalTargets) {
    const expiringLicenses = await License.find({
      renewalDate: targetDate,
      status: trustedFilter({ $ne: 'Expired' }),
      isDeleted: false,
    }).lean().exec();

    for (const lic of expiringLicenses) {
      const dedupeBase = `lic-renewal:${lic._id}:${days}:${targetDate}`;
      for (const hr of hrUsers) {
        const res = await createNotification({
          userId: hr._id,
          type: 'software_renewal',
          title: `License Renewal Due: ${lic.softwareName}`,
          body: `License for ${lic.softwareName} is due for renewal in ${days} days (${targetDate}).`,
          link: `/licenses`,
          dueAt: new Date(targetDate),
          dedupeKey: `${dedupeBase}:hr:${hr._id}`,
          sendEmailAlert: true,
        });
        if (res) {
          licRenewalCount += 1;
          totalCreated += 1;
        }
      }
    }
  }

  // 6. Asset Return: 3 days before expected return date
  const assetReturnTargetDate = addDaysIso(today, 3);
  const upcomingAssetReturns = await AssetAssignment.find({
    expectedReturnDate: assetReturnTargetDate,
    actualReturnDate: null,
    isDeleted: false,
  }).lean().exec();

  for (const assignment of upcomingAssetReturns) {
    const asset = await Asset.findById(assignment.assetId).select('name assetCode').lean().exec();
    const assetName = asset ? `${asset.name} (${asset.assetCode})` : 'Assigned Asset';
    const dedupeBase = `asset-return:${assignment._id}:${assetReturnTargetDate}`;

    for (const hr of hrUsers) {
      const res = await createNotification({
        userId: hr._id,
        type: 'asset_return',
        title: `Asset Return Expected: ${assetName}`,
        body: `Asset ${assetName} is expected to be returned in 3 days (${assetReturnTargetDate}).`,
        link: `/assets`,
        dueAt: new Date(assetReturnTargetDate),
        dedupeKey: `${dedupeBase}:hr:${hr._id}`,
        sendEmailAlert: false,
      });
      if (res) {
        assetReturnCount += 1;
        totalCreated += 1;
      }
    }

    const empUser = await getUserForEmployee(assignment.employeeId);
    if (empUser) {
      const res = await createNotification({
        userId: empUser._id,
        type: 'asset_return',
        title: `Asset Return Due: ${assetName}`,
        body: `Your assigned asset ${assetName} is due for return in 3 days (${assetReturnTargetDate}).`,
        link: `/assets`,
        dueAt: new Date(assetReturnTargetDate),
        dedupeKey: `${dedupeBase}:emp:${empUser._id}`,
        sendEmailAlert: true,
      });
      if (res) {
        assetReturnCount += 1;
        totalCreated += 1;
      }
    }
  }

  // 7. Overdue Asset: Daily when overdue (expectedReturnDate < today)
  const overdueAssignments = await AssetAssignment.find({
    expectedReturnDate: trustedFilter({ $lt: today }),
    actualReturnDate: null,
    isDeleted: false,
  }).lean().exec();

  for (const assignment of overdueAssignments) {
    const asset = await Asset.findById(assignment.assetId).select('name assetCode').lean().exec();
    const assetName = asset ? `${asset.name} (${asset.assetCode})` : 'Assigned Asset';
    const dedupeBase = `asset-overdue:${assignment._id}:${today}`;

    for (const hr of hrUsers) {
      const res = await createNotification({
        userId: hr._id,
        type: 'overdue_asset',
        title: `Overdue Asset: ${assetName}`,
        body: `Asset ${assetName} is overdue for return since ${assignment.expectedReturnDate}.`,
        link: `/assets`,
        dedupeKey: `${dedupeBase}:hr:${hr._id}`,
        sendEmailAlert: true,
      });
      if (res) {
        overdueAssetCount += 1;
        totalCreated += 1;
      }
    }

    const empUser = await getUserForEmployee(assignment.employeeId);
    if (empUser) {
      const res = await createNotification({
        userId: empUser._id,
        type: 'overdue_asset',
        title: `Overdue Asset Notice: ${assetName}`,
        body: `Your assigned asset ${assetName} was due on ${assignment.expectedReturnDate} and is currently overdue.`,
        link: `/assets`,
        dedupeKey: `${dedupeBase}:emp:${empUser._id}`,
        sendEmailAlert: true,
      });
      if (res) {
        overdueAssetCount += 1;
        totalCreated += 1;
      }
    }
  }

  // 8. Pending Approval > 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // A. Pending leave requests > 24h
  const pendingLeaves = await LeaveRequest.find({
    status: 'Pending',
    createdAt: trustedFilter({ $lt: twentyFourHoursAgo }),
    isDeleted: false,
  }).lean().exec();

  for (const leave of pendingLeaves) {
    const emp = await Employee.findById(leave.employeeId).select('firstName lastName reportingManagerId').lean().exec();
    const empName = emp ? `${emp.firstName} ${emp.lastName}` : 'An employee';
    const dedupeKey = `pending-approval:leave:${leave._id}:${today}`;

    if (emp?.reportingManagerId) {
      const managerUser = await getUserForEmployee(emp.reportingManagerId);
      if (managerUser) {
        const res = await createNotification({
          userId: managerUser._id,
          type: 'pending_approval',
          title: `Pending Leave Approval: ${empName}`,
          body: `A leave request from ${empName} has been pending for over 24 hours.`,
          link: `/leave`,
          dedupeKey: `${dedupeKey}:mgr:${managerUser._id}`,
          sendEmailAlert: true,
        });
        if (res) {
          pendingApprovalCount += 1;
          totalCreated += 1;
        }
      }
    } else {
      for (const hr of hrUsers) {
        const res = await createNotification({
          userId: hr._id,
          type: 'pending_approval',
          title: `Pending Leave Approval: ${empName}`,
          body: `A leave request from ${empName} has been pending for over 24 hours.`,
          link: `/leave`,
          dedupeKey: `${dedupeKey}:hr:${hr._id}`,
          sendEmailAlert: false,
        });
        if (res) {
          pendingApprovalCount += 1;
          totalCreated += 1;
        }
      }
    }
  }

  // B. Pending attendance corrections > 24h
  const pendingCorrections = await AttendanceCorrection.find({
    status: 'Pending',
    createdAt: trustedFilter({ $lt: twentyFourHoursAgo }),
    isDeleted: false,
  }).lean().exec();

  for (const correction of pendingCorrections) {
    const emp = await Employee.findById(correction.employeeId).select('firstName lastName reportingManagerId').lean().exec();
    const empName = emp ? `${emp.firstName} ${emp.lastName}` : 'An employee';
    const dedupeKey = `pending-approval:corr:${correction._id}:${today}`;

    if (emp?.reportingManagerId) {
      const managerUser = await getUserForEmployee(emp.reportingManagerId);
      if (managerUser) {
        const res = await createNotification({
          userId: managerUser._id,
          type: 'pending_approval',
          title: `Pending Attendance Correction: ${empName}`,
          body: `An attendance correction for ${correction.date} from ${empName} has been pending for over 24 hours.`,
          link: `/attendance`,
          dedupeKey: `${dedupeKey}:mgr:${managerUser._id}`,
          sendEmailAlert: true,
        });
        if (res) {
          pendingApprovalCount += 1;
          totalCreated += 1;
        }
      }
    } else {
      for (const hr of hrUsers) {
        const res = await createNotification({
          userId: hr._id,
          type: 'pending_approval',
          title: `Pending Attendance Correction: ${empName}`,
          body: `An attendance correction for ${correction.date} from ${empName} has been pending for over 24 hours.`,
          link: `/attendance`,
          dedupeKey: `${dedupeKey}:hr:${hr._id}`,
          sendEmailAlert: false,
        });
        if (res) {
          pendingApprovalCount += 1;
          totalCreated += 1;
        }
      }
    }
  }

  logger.info(
    {
      today,
      joiningCount,
      leavingCount,
      probationCount,
      docExpiryCount,
      licRenewalCount,
      assetReturnCount,
      overdueAssetCount,
      pendingApprovalCount,
      totalCreated,
    },
    'Completed running scheduled reminders',
  );

  return {
    joiningReminders: joiningCount,
    leavingReminders: leavingCount,
    probationReminders: probationCount,
    documentExpiryReminders: docExpiryCount,
    softwareRenewalReminders: licRenewalCount,
    assetReturnReminders: assetReturnCount,
    overdueAssetReminders: overdueAssetCount,
    pendingApprovalReminders: pendingApprovalCount,
    totalCreated,
  };
}

/**
 * Trigger immediate notification when a leave request is applied or decided (AGENTS.md §8.12).
 */
export async function notifyLeaveEvent(params: {
  leaveRequestId: Types.ObjectId | string;
  employeeId: Types.ObjectId | string;
  eventType: 'applied' | 'approved' | 'rejected' | 'cancelled';
  leaveTypeName?: string;
  datesDescription?: string;
}): Promise<void> {
  const emp = await Employee.findById(params.employeeId).select('firstName lastName reportingManagerId').lean().exec();
  const empName = emp ? `${emp.firstName} ${emp.lastName}` : 'An employee';

  if (params.eventType === 'applied') {
    // Notify reporting manager or HR
    const dedupeKey = `leave-event:applied:${params.leaveRequestId}`;
    if (emp?.reportingManagerId) {
      const managerUser = await getUserForEmployee(emp.reportingManagerId);
      if (managerUser) {
        await createNotification({
          userId: managerUser._id,
          type: 'leave_status',
          title: `New Leave Request from ${empName}`,
          body: `${empName} applied for ${params.leaveTypeName || 'leave'} (${params.datesDescription || ''}).`,
          link: '/leave',
          dedupeKey,
          sendEmailAlert: true,
        });
      }
    }
  } else if (params.eventType === 'approved' || params.eventType === 'rejected') {
    // Notify applying employee
    const empUser = await getUserForEmployee(params.employeeId);
    if (empUser) {
      const statusTitle = params.eventType === 'approved' ? 'Approved' : 'Rejected';
      const dedupeKey = `leave-event:${params.eventType}:${params.leaveRequestId}`;
      await createNotification({
        userId: empUser._id,
        type: 'leave_status',
        title: `Leave Request ${statusTitle}`,
        body: `Your leave request for ${params.datesDescription || ''} has been ${params.eventType}.`,
        link: '/leave',
        dedupeKey,
        sendEmailAlert: true,
      });
    }
  }
}
