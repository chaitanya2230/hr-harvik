import type { Types } from 'mongoose';
import type { CandidateStage } from '../config/constants';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { logger } from '../utils/logger';
import { Counter } from '../modules/counters/counter.model';
import { Department } from '../modules/departments/department.model';
import { Employee } from '../modules/employees/employee.model';
import { User } from '../modules/users/user.model';
import { AuditLog } from '../modules/audit/audit.model';
import { Asset, AssetAssignment } from '../modules/assets/asset.model';
import { License, LicenseAssignment } from '../modules/licenses/license.model';
import { AccessItem } from '../modules/access/access.model';
import { Document } from '../modules/documents/document.model';
import { DocumentTemplate } from '../modules/documents/template.model';
import { Holiday } from '../modules/attendance/holiday.model';
import { Attendance } from '../modules/attendance/attendance.model';
import { AttendanceCorrection } from '../modules/attendance/correction.model';
import { LeaveType } from '../modules/leave/leave-type.model';
import { LeaveBalance } from '../modules/leave/leave-balance.model';
import { LeaveRequest } from '../modules/leave/leave-request.model';
import { Exit } from '../modules/exit/exit.model';
import { Job } from '../modules/recruitment/job.model';
import { Candidate } from '../modules/recruitment/candidate.model';
import { Onboarding } from '../modules/onboarding/onboarding.model';
import { createOnboardingForEmployee } from '../modules/onboarding/onboarding.service';
import { initiateExit } from '../modules/exit/exit.service';
import { initializeEmployeeBalances } from '../modules/leave/leave-balance.service';
import { isWeekend } from '../utils/dates';
import { hashPassword } from '../modules/auth/auth.service';
import { encryptField } from '../utils/crypto';
import { nextHumanId } from '../utils/ids';
import { DEMO_PASSWORD } from '../modules/auth/auth.schema';
import {
  ACCESS_ITEMS,
  ASSETS,
  DEPARTMENTS,
  DEMO_USERS,
  DOCUMENT_TEMPLATES,
  EMPLOYEES,
  HOLIDAYS,
  LEAVE_TYPES,
  LICENSES,
  SEED_CANDIDATES,
  SEED_JOBS,
  type SeedEmployee,
} from './data';

export interface SeedResult {
  departments: number;
  employees: number;
  users: number;
  assets: number;
  licenses: number;
  accessItems: number;
  jobs: number;
  candidates: number;
  onboardings: number;
}

/**
 * Seed order matters: departments first, then employees in hierarchy order so a
 * manager always exists before their reports, then users (which reference
 * employees).
 */
const hierarchyDepth = (employee: SeedEmployee, byKey: Map<string, SeedEmployee>): number => {
  let depth = 0;
  let cursor = employee;
  const seen = new Set<string>([employee.key]);

  while (cursor.managerKey) {
    if (seen.has(cursor.managerKey)) {
      throw new Error(`Circular reporting chain detected at "${cursor.key}"`);
    }
    seen.add(cursor.managerKey);

    const manager = byKey.get(cursor.managerKey);
    if (!manager) throw new Error(`Unknown manager "${cursor.managerKey}" for "${cursor.key}"`);
    cursor = manager;
    depth += 1;
  }
  return depth;
};

const clearCollections = async (): Promise<void> => {
  await Promise.all([
    AuditLog.deleteMany({}),
    User.deleteMany({}),
    Employee.deleteMany({}),
    Department.deleteMany({}),
    AssetAssignment.deleteMany({}),
    Asset.deleteMany({}),
    LicenseAssignment.deleteMany({}),
    License.deleteMany({}),
    AccessItem.deleteMany({}),
    Document.deleteMany({}),
    DocumentTemplate.deleteMany({}),
    Holiday.deleteMany({}),
    Attendance.deleteMany({}),
    AttendanceCorrection.deleteMany({}),
    LeaveType.deleteMany({}),
    LeaveBalance.deleteMany({}),
    LeaveRequest.deleteMany({}),
    Exit.deleteMany({}),
    Job.deleteMany({}),
    Candidate.deleteMany({}),
    Onboarding.deleteMany({}),
    // Reset the counters so codes restart at 0001 and stay deterministic.
    Counter.deleteMany({}),
  ]);
};

export async function runSeed({ reset = true }: { reset?: boolean } = {}): Promise<SeedResult> {
  await connectMongo();

  if (reset) {
    await clearCollections();
    logger.info('Cleared existing HR data');
  }

  // --- Departments (§12) ---
  const departmentDocs = await Department.insertMany(
    DEPARTMENTS.map((name) => ({ name, headEmployeeId: null, isDeleted: false })),
  );
  const departmentIdByName = new Map<string, Types.ObjectId>(
    departmentDocs.map((doc) => [doc.name, doc._id]),
  );

  // --- Employees (§12) ---
  const byKey = new Map(EMPLOYEES.map((employee) => [employee.key, employee]));
  const ordered = [...EMPLOYEES].sort(
    (a, b) => hierarchyDepth(a, byKey) - hierarchyDepth(b, byKey),
  );

  const employeeIdByKey = new Map<string, Types.ObjectId>();

  for (const seedEmployee of ordered) {
    const departmentId = departmentIdByName.get(seedEmployee.department);
    if (!departmentId) {
      throw new Error(`Unknown department "${seedEmployee.department}"`);
    }

    const employeeCode = await nextHumanId('employee');
    const reportingManagerId = seedEmployee.managerKey
      ? (employeeIdByKey.get(seedEmployee.managerKey) ?? null)
      : null;

    const created = await Employee.create({
      employeeCode,
      firstName: seedEmployee.firstName,
      lastName: seedEmployee.lastName,
      email: seedEmployee.email,
      phone: seedEmployee.phone,
      dob: seedEmployee.dob,
      designation: seedEmployee.designation,
      departmentId,
      reportingManagerId,
      employmentType: seedEmployee.employmentType,
      dateOfJoining: seedEmployee.dateOfJoining,
      probationEndDate: seedEmployee.probationEndDate ?? null,
      compensation: seedEmployee.compensation,
      status: seedEmployee.status,
      lastWorkingDay: seedEmployee.lastWorkingDay ?? null,
      statusHistory: [
        {
          status: seedEmployee.status,
          changedAt: new Date(`${seedEmployee.dateOfJoining}T00:00:00.000Z`),
          changedBy: null,
          note: 'Initial status on creation',
        },
      ],
      employmentHistory: [
        {
          employmentType: seedEmployee.employmentType,
          designation: seedEmployee.designation,
          departmentId,
          from: new Date(`${seedEmployee.dateOfJoining}T00:00:00.000Z`),
          to: null,
          note: 'Initial employment record',
        },
      ],
      isDeleted: false,
    });

    employeeIdByKey.set(seedEmployee.key, created._id);
  }

  // Department heads = the top-most seeded employee in each department.
  for (const [name, headId] of departmentIdByName) {
    const head = ordered.find((employee) => {
      if (employee.department !== name) return false;
      return !employee.managerKey || byKey.get(employee.managerKey)?.department !== name;
    });
    if (head) {
      const headIdValue = employeeIdByKey.get(head.key);
      if (headIdValue) await Department.updateOne({ _id: headId }, { $set: { headEmployeeId: headIdValue } });
    }
  }

  // --- Users (§6 / §12) ---
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const demoUser of DEMO_USERS) {
    const employeeId = employeeIdByKey.get(demoUser.employeeKey);
    if (!employeeId) {
      throw new Error(`Demo user "${demoUser.email}" references unknown employee`);
    }

    await User.create({
      email: demoUser.email,
      passwordHash,
      role: demoUser.role,
      employeeId,
      isActive: true,
      lastLoginAt: null,
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
      isDeleted: false,
    });
  }

  // --- Leave Types (§7, §12) ---
  for (const seedLeaveType of LEAVE_TYPES) {
    await LeaveType.create({
      ...seedLeaveType,
      isActive: true,
      createdBy: null,
      isDeleted: false,
    });
  }

  // --- Holidays (§7, §12) ---
  for (const seedHoliday of HOLIDAYS) {
    await Holiday.create({
      date: seedHoliday.date,
      name: seedHoliday.name,
      createdBy: null,
      isDeleted: false,
    });
  }

  const allEmployees = await Employee.find({ isDeleted: false });

  // --- Leave Balances (§8.2, §12) ---
  for (const emp of allEmployees) {
    await initializeEmployeeBalances(emp._id, emp.dateOfJoining, emp.employmentType);
  }

  // --- Onboarding Checklists (§7, §8.4, §12) ---
  for (const emp of allEmployees) {
    const onb = await createOnboardingForEmployee(emp);
    if (emp.status === 'Active' && emp.dateOfJoining < '2024-01-01') {
      for (const item of onb.items) {
        item.status = 'Completed';
        item.completedAt = new Date(emp.dateOfJoining);
        item.completedSource = 'Manual';
      }
      await Onboarding.updateOne(
        { _id: onb._id },
        {
          $set: {
            status: 'Completed',
            completedAt: new Date(emp.dateOfJoining),
            items: onb.items,
          },
        },
      ).exec();
    } else if (emp.status === 'Probation' || emp.dateOfJoining >= '2025-01-01') {
      const itemsToComplete = ['personalInfo', 'offerLetter', 'agreementNda', 'companyEmailAccount'];
      for (const item of onb.items) {
        if (itemsToComplete.includes(item.key)) {
          item.status = 'Completed';
          item.completedAt = new Date();
          item.completedSource = 'Manual';
        }
      }
      await Onboarding.updateOne(
        { _id: onb._id },
        {
          $set: {
            status: 'In Progress',
            startedAt: new Date(emp.dateOfJoining),
            items: onb.items,
          },
        },
      ).exec();
    }
  }

  // --- Attendance for last 30 days (§8.5, §12) ---
  const holidayDates = new Set(HOLIDAYS.map((h) => h.date));
  const now = new Date();
  const past30Days: string[] = [];
  for (let i = 30; i >= 1; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    past30Days.push(d.toISOString().slice(0, 10));
  }

  const attendanceBatch: Array<Record<string, unknown>> = [];
  for (const dateStr of past30Days) {
    const weekend = isWeekend(dateStr);
    const isHol = holidayDates.has(dateStr);

    for (const emp of allEmployees) {
      if (emp.status === 'Relieved' && emp.lastWorkingDay && dateStr > emp.lastWorkingDay) {
        continue;
      }

      if (isHol) {
        attendanceBatch.push({
          employeeId: emp._id,
          date: dateStr,
          status: 'Holiday',
          note: HOLIDAYS.find((h) => h.date === dateStr)?.name ?? 'Holiday',
          source: 'NightlyJob',
          isDeleted: false,
        });
      } else if (!weekend) {
        // Working day: 80% Present Office, 20% Present WFH
        const isWfh = (emp.firstName.charCodeAt(0) + dateStr.charCodeAt(dateStr.length - 1)) % 5 === 0;
        attendanceBatch.push({
          employeeId: emp._id,
          date: dateStr,
          status: 'Present',
          workMode: isWfh ? 'WFH' : 'Office',
          checkIn: '09:30',
          checkOut: '18:30',
          source: 'Manual',
          isDeleted: false,
        });
      }
    }
  }

  if (attendanceBatch.length > 0) {
    await Attendance.insertMany(attendanceBatch);
  }

  const p2 = await seedP2Fixtures(employeeIdByKey);
  await seedExitFixtures(employeeIdByKey);
  const p6 = await seedP6Fixtures(employeeIdByKey, departmentIdByName);

  return {
    departments: departmentDocs.length,
    employees: ordered.length,
    users: DEMO_USERS.length,
    ...p2,
    ...p6,
    onboardings: allEmployees.length,
  };
}

/**
 * P3 exit demo data (§12): open exits for the two On Notice employees, a
 * completed exit for the Relieved employee, and a pending leave request for
 * the exit-fixture employee — the §14 E2E fixture shape (2 assets, 3 licenses,
 * 1 access item from the P2 fixtures above, plus pending leave here).
 */
async function seedExitFixtures(
  employeeIdByKey: Map<string, Types.ObjectId>,
): Promise<Record<string, never>> {
  const adminEmail = DEMO_USERS[0]?.email;
  if (!adminEmail) throw new Error('Seed demo users misconfigured');
  const adminUser = await User.findOne({ email: adminEmail }).exec();
  if (!adminUser) throw new Error('Seed admin user not found for exit fixtures');
  const meeraId = employeeIdByKey.get('meera');
  if (!meeraId) throw new Error('Seed employee "meera" not found for exit fixtures');
  const ctx = {
    account: {
      userId: String(adminUser._id),
      email: adminEmail,
      role: 'HR Admin' as const,
      employeeId: String(meeraId),
    },
    ip: null,
    requestId: null,
  };

  // Open exits for seeded On Notice employees (checklist built from their
  // current assignments by the exit service itself).
  for (const key of ['lakshmi', 'manoj']) {
    const employeeId = employeeIdByKey.get(key);
    if (!employeeId) throw new Error(`Seed employee "${key}" not found for exit fixtures`);
    const employee = await Employee.findById(employeeId).exec();
    if (!employee) throw new Error(`Seed employee "${key}" missing`);
    await initiateExit(String(employeeId), {
      reason: 'Career move',
      noticePeriodDays: 30,
      lastWorkingDay: employee.lastWorkingDay ?? undefined,
    }, ctx);
  }

  // Completed exit for the Relieved employee, with closed employment history.
  const nehaId = employeeIdByKey.get('neha');
  if (!nehaId) throw new Error('Seed employee "neha" not found for exit fixtures');
  await Exit.create({
    employeeId: nehaId,
    resignationDate: '2026-07-15',
    noticePeriodDays: 30,
    lastWorkingDay: '2026-08-14',
    reason: 'Relocation',
    reasonNote: null,
    clearances: {
      manager: { status: 'Approved', reviewedBy: adminUser._id, reviewedAt: new Date('2026-08-10T00:00:00.000Z') },
      hr: { status: 'Approved', reviewedBy: adminUser._id, reviewedAt: new Date('2026-08-12T00:00:00.000Z') },
      finance: { status: 'Approved', reviewedBy: adminUser._id, reviewedAt: new Date('2026-08-13T00:00:00.000Z') },
    },
    checklist: [],
    finalSettlementStatus: 'Completed',
    experienceLetterDocId: null,
    relievingLetterDocId: null,
    stage: 'Relieved',
    completedAt: new Date('2026-08-14T00:00:00.000Z'),
    forceRelieved: false,
    forceReason: null,
    forceRelievedBy: null,
    createdBy: adminUser._id,
    isDeleted: false,
  });
  await Employee.updateOne(
    { _id: nehaId },
    { $set: { 'employmentHistory.0.to': new Date('2026-08-14T00:00:00.000Z') } },
  ).exec();

  // Pending leave for the exit-fixture employee (2 assets, 3 licenses and
  // 1 access item already wired through the P2 fixtures above).
  const omprakashId = employeeIdByKey.get('omprakash');
  if (!omprakashId) throw new Error('Seed employee "omprakash" not found for exit fixtures');
  const casual = await LeaveType.findOne({ code: 'CASUAL', isDeleted: false }).exec();
  if (!casual) throw new Error('Seed leave type CASUAL not found for exit fixtures');

  // Next Monday–Tuesday at least a week out (always working days by construction).
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const toISO = (d: Date): string => d.toISOString().slice(0, 10);
  const cursor = new Date(start.getTime() + 7 * 86_400_000);
  while (cursor.getUTCDay() !== 1) cursor.setUTCDate(cursor.getUTCDate() + 1);
  const fromDate = toISO(cursor);
  const tuesday = new Date(cursor.getTime() + 86_400_000);
  const toDate = toISO(tuesday);

  await LeaveRequest.create({
    employeeId: omprakashId,
    leaveTypeId: casual._id,
    fromDate,
    toDate,
    halfDay: false,
    days: 2,
    reason: 'Family function',
    status: 'Pending',
    approverId: null,
    decisionNote: null,
    decidedAt: null,
    createdBy: null,
    isDeleted: false,
  });
  const year = parseInt(fromDate.slice(0, 4), 10);
  await LeaveBalance.updateOne(
    { employeeId: omprakashId, leaveTypeId: casual._id, year },
    { $inc: { pending: 2 } },
  ).exec();

  return {};
}

/** P2 fixtures: assets, licenses (+ assignments), access items (§12, D-12). */
async function seedP2Fixtures(
  employeeIdByKey: Map<string, Types.ObjectId>,
): Promise<Pick<SeedResult, 'assets' | 'licenses' | 'accessItems'>> {
  const dateOnlyDaysFromToday = (days: number): string =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  // --- Assets (§12: ~30) ---
  const assetIdBySerial = new Map<string, Types.ObjectId>();

  for (const seedAsset of ASSETS) {
    const assetCode = await nextHumanId('asset');
    const assigneeId = seedAsset.assigneeKey
      ? (employeeIdByKey.get(seedAsset.assigneeKey) ?? null)
      : null;
    if (seedAsset.assigneeKey && !assigneeId) {
      throw new Error(`Seed asset "${seedAsset.serial}" references unknown employee`);
    }

    const created = await Asset.create({
      assetCode,
      name: seedAsset.name,
      type: seedAsset.type,
      brand: seedAsset.brand ?? null,
      model: seedAsset.model ?? null,
      serialNumber: seedAsset.serial,
      purchaseDate: seedAsset.purchaseDate,
      purchaseCost: seedAsset.purchaseCost,
      condition: seedAsset.condition ?? null,
      status: seedAsset.status ?? (assigneeId ? 'Assigned' : 'Available'),
      currentAssignmentId: null,
      notes: null,
      createdBy: null,
      isDeleted: false,
    });
    assetIdBySerial.set(seedAsset.serial, created._id);

    if (assigneeId) {
      const assignment = await AssetAssignment.create({
        assetId: created._id,
        employeeId: assigneeId,
        assignedAt: new Date('2026-01-10T00:00:00.000Z'),
        expectedReturnDate: seedAsset.expectedReturnDate ?? null,
        actualReturnDate: null,
        conditionAtAssign: seedAsset.condition ?? null,
        conditionAtReturn: null,
        assignedBy: null,
        returnedTo: null,
        notes: null,
        createdBy: null,
        isDeleted: false,
      });
      await Asset.updateOne(
        { _id: created._id },
        { $set: { currentAssignmentId: assignment._id } },
      ).exec();
    }
  }

  // --- Licenses (§12: ~8, one expired, one near-renewal) ---
  const licenseIdByName = new Map<string, Types.ObjectId>();
  const licenseAssignmentIdByKey = new Map<string, Types.ObjectId>();

  for (const seedLicense of LICENSES) {
    const licenseCode = await nextHumanId('license');
    const renewalDate =
      seedLicense.renewal === 'expired'
        ? dateOnlyDaysFromToday(-90)
        : seedLicense.renewal === 'near'
          ? dateOnlyDaysFromToday(20)
          : seedLicense.renewal;

    const created = await License.create({
      licenseCode,
      softwareName: seedLicense.softwareName,
      licenseType: seedLicense.licenseType,
      licenseKeyRef: seedLicense.licenseKey ? encryptField(seedLicense.licenseKey) : null,
      provider: seedLicense.provider ?? null,
      cost: seedLicense.cost ?? null,
      currency: seedLicense.currency ?? null,
      billingCycle: seedLicense.billingCycle ?? null,
      startDate: seedLicense.startDate,
      renewalDate,
      maxSeats: seedLicense.maxSeats,
      usedSeats: 0,
      status: seedLicense.status ?? 'Available',
      createdBy: null,
      isDeleted: false,
    });
    licenseIdByName.set(seedLicense.softwareName, created._id);

    for (const assigneeKey of seedLicense.assigneeKeys ?? []) {
      const employeeId = employeeIdByKey.get(assigneeKey);
      if (!employeeId) throw new Error(`Seed license references unknown employee`);
      const assignment = await LicenseAssignment.create({
        licenseId: created._id,
        employeeId,
        assignedAt: new Date('2026-01-10T00:00:00.000Z'),
        accountIdentifier: null,
        status: 'Assigned',
        revokedAt: null,
        revokedBy: null,
        revocationNote: null,
        createdBy: null,
        isDeleted: false,
      });
      licenseAssignmentIdByKey.set(`${seedLicense.softwareName}:${assigneeKey}`, assignment._id);
    }

    const usedSeats = (seedLicense.assigneeKeys ?? []).length;
    if (usedSeats > 0) {
      await License.updateOne({ _id: created._id }, { $set: { usedSeats } }).exec();
    }
  }

  // --- Access items (§7 examples) ---
  for (const seedAccess of ACCESS_ITEMS) {
    const employeeId = employeeIdByKey.get(seedAccess.employeeKey);
    if (!employeeId) throw new Error(`Seed access item references unknown employee`);
    const linkedId = seedAccess.linkedLicense
      ? (licenseAssignmentIdByKey.get(`${seedAccess.linkedLicense}:${seedAccess.employeeKey}`) ?? null)
      : null;

    await AccessItem.create({
      employeeId,
      system: seedAccess.system,
      identifier: seedAccess.identifier ?? null,
      status: 'Active',
      revokedAt: null,
      revokedBy: null,
      linkedLicenseAssignmentId: linkedId,
      createdBy: null,
      isDeleted: false,
    });
  }

  // --- Document Templates (§7, §12) ---
  for (const seedTemplate of DOCUMENT_TEMPLATES) {
    await DocumentTemplate.create({
      name: seedTemplate.name,
      category: seedTemplate.category,
      applicableEmploymentTypes: seedTemplate.applicableEmploymentTypes,
      bodyHtml: seedTemplate.bodyHtml,
      isActive: true,
      createdBy: null,
      isDeleted: false,
    });
  }

  return {
    assets: ASSETS.length,
    licenses: LICENSES.length,
    accessItems: ACCESS_ITEMS.length,
  };
}

/** P6 fixtures: Jobs and Candidates (§7, §8.3, §12) */
async function seedP6Fixtures(
  employeeIdByKey: Map<string, Types.ObjectId>,
  departmentIdByName: Map<string, Types.ObjectId>,
): Promise<Pick<SeedResult, 'jobs' | 'candidates'>> {
  // --- Jobs (§7, §8.3, §12) ---
  const jobIdByKey = new Map<string, Types.ObjectId>();
  for (const seedJob of SEED_JOBS) {
    const departmentId = departmentIdByName.get(seedJob.department);
    if (!departmentId) {
      throw new Error(`Seed job "${seedJob.title}" references unknown department "${seedJob.department}"`);
    }
    const hiringManagerId = employeeIdByKey.get(seedJob.hiringManagerKey);
    if (!hiringManagerId) {
      throw new Error(`Seed job "${seedJob.title}" references unknown manager "${seedJob.hiringManagerKey}"`);
    }

    const jobCode = await nextHumanId('job');
    const createdJob = await Job.create({
      jobCode,
      title: seedJob.title,
      departmentId,
      hiringManagerId,
      openings: seedJob.openings,
      filledCount: seedJob.filledCount,
      description: seedJob.description,
      requiredSkills: seedJob.requiredSkills,
      openingDate: seedJob.openingDate,
      closingDate: seedJob.closingDate ?? null,
      status: seedJob.status,
      createdBy: null,
      isDeleted: false,
    });
    jobIdByKey.set(seedJob.key, createdJob._id);
  }

  // --- Candidates (§7, §8.3, §12) ---
  for (const seedCand of SEED_CANDIDATES) {
    const jobId = jobIdByKey.get(seedCand.jobKey);
    if (!jobId) {
      throw new Error(`Seed candidate "${seedCand.name}" references unknown job "${seedCand.jobKey}"`);
    }

    const candidateCode = await nextHumanId('candidate');
    const convertedEmployeeId = seedCand.convertedEmployeeKey
      ? employeeIdByKey.get(seedCand.convertedEmployeeKey) ?? null
      : null;

    const interviews = (seedCand.interviews ?? []).map((iv) => {
      const interviewerId = employeeIdByKey.get(iv.interviewerKey);
      if (!interviewerId) {
        throw new Error(`Seed candidate interview references unknown interviewer "${iv.interviewerKey}"`);
      }
      return {
        round: iv.round,
        title: iv.title,
        interviewerId,
        scheduledAt: new Date(iv.scheduledAt),
        status: iv.status,
        feedback: iv.feedback ?? null,
        rating: iv.rating ?? null,
        completedAt: iv.completedAt ? new Date(iv.completedAt) : null,
      };
    });

    const stageHistory: Array<{
      stage: CandidateStage;
      changedAt: Date;
      changedBy: null;
      note: string;
    }> = [
      {
        stage: 'Applied',
        changedAt: new Date('2026-01-20T10:00:00.000Z'),
        changedBy: null,
        note: `Application received via ${seedCand.source}`,
      },
    ];
    if (seedCand.stage !== 'Applied') {
      stageHistory.push({
        stage: seedCand.stage,
        changedAt: new Date('2026-02-01T10:00:00.000Z'),
        changedBy: null,
        note: `Moved to ${seedCand.stage}`,
      });
    }

    await Candidate.create({
      candidateCode,
      name: seedCand.name,
      email: seedCand.email,
      phone: seedCand.phone,
      resumeFile: null,
      jobId,
      source: seedCand.source,
      stage: seedCand.stage,
      interviews,
      selectionStatus:
        seedCand.selectionStatus ??
        (seedCand.stage === 'Selected' ? 'Selected' : seedCand.stage === 'Rejected' ? 'Rejected' : 'Pending'),
      offerStatus: seedCand.offerStatus ?? 'Pending',
      joiningDate: seedCand.joiningDate ?? null,
      stageHistory,
      rejectionReason: seedCand.rejectionReason ?? null,
      convertedEmployeeId,
      createdBy: null,
      isDeleted: false,
    });
  }

  return {
    jobs: SEED_JOBS.length,
    candidates: SEED_CANDIDATES.length,
  };
}

/** Entrypoint for `npm run seed`. */
async function main(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await runSeed({ reset: true });
    logger.info({ ...result, durationMs: Date.now() - startedAt }, 'Seed completed');

    // Demo credentials are intentionally NOT printed — see README.md.
    for (const demoUser of DEMO_USERS) {
      logger.info({ email: demoUser.email, role: demoUser.role }, 'Demo user ready');
    }
  } catch (error) {
    logger.fatal(
      { err: error instanceof Error ? error.message : String(error) },
      'Seed failed',
    );
    process.exitCode = 1;
  } finally {
    await disconnectMongo();
  }
}

// Only run when invoked directly, so tests can import `runSeed`.
if (require.main === module) {
  void main();
}