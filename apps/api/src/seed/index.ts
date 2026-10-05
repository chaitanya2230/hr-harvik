import type { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { logger } from '../utils/logger';
import { Counter } from '../modules/counters/counter.model';
import { Department } from '../modules/departments/department.model';
import { Employee } from '../modules/employees/employee.model';
import { User } from '../modules/users/user.model';
import { AuditLog } from '../modules/audit/audit.model';
import { hashPassword } from '../modules/auth/auth.service';
import { nextHumanId } from '../utils/ids';
import { DEMO_PASSWORD } from '../modules/auth/auth.schema';
import { DEPARTMENTS, DEMO_USERS, EMPLOYEES, type SeedEmployee } from './data';

export interface SeedResult {
  departments: number;
  employees: number;
  users: number;
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

  return {
    departments: departmentDocs.length,
    employees: ordered.length,
    users: DEMO_USERS.length,
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