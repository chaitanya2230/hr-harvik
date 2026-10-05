import bcrypt from 'bcrypt';
import { beforeAll, describe, expect, it } from 'vitest';
import { runSeed } from '../../src/seed';
import { DEPARTMENTS, DEMO_USERS, EMPLOYEES } from '../../src/seed/data';
import { DEMO_PASSWORD } from '../../src/modules/auth/auth.schema';
import { USER_PASSWORD_SELECT } from '../../src/modules/users/user.schema';
import { Counter } from '../../src/modules/counters/counter.model';
import { Department } from '../../src/modules/departments/department.model';
import { Employee } from '../../src/modules/employees/employee.model';
import { User } from '../../src/modules/users/user.model';
import type { Role } from '../../src/config/constants';
import { DEMO_ACCOUNTS, login } from '../support/helpers';

/** AGENTS.md §12 — `npm run seed` must create usable demo data. */

describe('seed data (§12)', () => {
  beforeAll(async () => {
    await runSeed({ reset: true });
  });

  describe('departments (§12)', () => {
    it('creates the five company departments', async () => {
      const names = (await Department.find({ isDeleted: false }).lean().exec()).map((d) => d.name);

      expect(names.sort()).toEqual([...DEPARTMENTS].sort());
    });

    it('assigns a department head to each department that has one', async () => {
      const departments = await Department.find({ isDeleted: false }).lean().exec();

      expect(departments.length).toBeGreaterThan(0);
      for (const department of departments) {
        expect(department.headEmployeeId, `${department.name} has no head`).not.toBeNull();
      }
    });
  });

  describe('employees (§7, §12)', () => {
    it('creates every seeded employee', async () => {
      const count = await Employee.countDocuments({ isDeleted: false });
      expect(count).toBe(EMPLOYEES.length);
    });

    it('assigns sequential HRV-#### codes', async () => {
      const codes = (await Employee.find({ isDeleted: false }).sort({ employeeCode: 1 }).lean().exec()).map(
        (e) => e.employeeCode,
      );

      expect(codes).toHaveLength(EMPLOYEES.length);
      codes.forEach((code, index) => {
        expect(code).toBe(`HRV-${String(index + 1).padStart(4, '0')}`);
      });
    });

    it('spans the employment types required by §7', async () => {
      const types = new Set(
        (await Employee.find({ isDeleted: false }).lean().exec()).map((e) => e.employmentType),
      );

      for (const required of ['Full-Time', 'Intern', 'Freelancer', 'Contractor']) {
        expect(types.has(required as never), `missing employment type ${required}`).toBe(true);
      }
    });

    it('records an opening status history and employment history entry', async () => {
      const employees = await Employee.find({ isDeleted: false }).lean().exec();

      for (const employee of employees) {
        expect(employee.statusHistory, `${employee.employeeCode} status history`).toHaveLength(1);
        expect(employee.statusHistory[0]?.status).toBe(employee.status);
        expect(employee.employmentHistory, `${employee.employeeCode} employment history`).toHaveLength(1);
        expect(employee.employmentHistory[0]?.to).toBeNull();
      }
    });

    it('builds a reporting hierarchy at least three levels deep (§12)', async () => {
      const employees = await Employee.find({ isDeleted: false }).lean().exec();
      const byId = new Map(employees.map((e) => [String(e._id), e]));

      const depthOf = (id: unknown): number => {
        let depth = 0;
        let cursor = byId.get(String(id));
        const seen = new Set<string>();
        while (cursor?.reportingManagerId) {
          expect(seen.has(String(cursor._id)), 'circular reporting chain in seed').toBe(false);
          seen.add(String(cursor._id));
          cursor = byId.get(String(cursor.reportingManagerId));
          depth += 1;
        }
        return depth;
      };

      const depths = employees.map((e) => depthOf(e._id));
      expect(Math.max(...depths)).toBeGreaterThanOrEqual(2);
    });

    it('never leaves a reporting manager dangling', async () => {
      const employees = await Employee.find({ isDeleted: false }).lean().exec();
      const ids = new Set(employees.map((e) => String(e._id)));

      for (const employee of employees) {
        if (!employee.reportingManagerId) continue;
        expect(ids.has(String(employee.reportingManagerId))).toBe(true);
        expect(String(employee.reportingManagerId)).not.toBe(String(employee._id));
      }
    });

    it('never stores bank details in plaintext (§7 "encrypted at rest")', async () => {
      // The P0 seed sets no bank details; if a fixture ever adds them they must
      // arrive encrypted, never as a raw account number.
      const employees = await Employee.find({ isDeleted: false }).lean().exec();

      for (const employee of employees) {
        const bank = employee.bankDetails as { accountNumberEnc?: string } | undefined;
        if (!bank?.accountNumberEnc) continue;
        expect(bank.accountNumberEnc).toMatch(/^v1:/);
      }
    });
  });

  describe('demo users (§12)', () => {
    it('creates exactly the four documented demo logins', async () => {
      const count = await User.countDocuments({ isDeleted: false });
      expect(count).toBe(DEMO_USERS.length);
      expect(DEMO_USERS.map((u) => u.email).sort()).toEqual(
        Object.values(DEMO_ACCOUNTS).slice().sort(),
      );
    });

    it.each([
      ['admin', 'HR Admin'],
      ['hrManager', 'HR Manager'],
      ['manager', 'Manager'],
      ['employee', 'Employee'],
    ] as Array<[keyof typeof DEMO_ACCOUNTS, Role]>)('maps %s to the %s role', async (key, role) => {
      const user = await User.findOne({ email: DEMO_ACCOUNTS[key] }).lean().exec();

      expect(user?.role).toBe(role);
      expect(user?.isActive).toBe(true);
      expect(user?.employeeId).not.toBeNull();
    });

    it('hashes the demo password with bcrypt at cost >= 10 (§6)', async () => {
      const user = await User.findOne({ email: DEMO_ACCOUNTS.employee })
        .select(USER_PASSWORD_SELECT)
        .lean()
        .exec();

      const hash = (user as unknown as { passwordHash: string }).passwordHash;
      expect(hash).not.toBe(DEMO_PASSWORD);
      expect(hash).toMatch(/^\$2[aby]\$/);
      expect(Number(hash.split('$')[2])).toBeGreaterThanOrEqual(10);
      expect(await bcrypt.compare(DEMO_PASSWORD, hash)).toBe(true);
    });

    it('gives every demo user a working login (§14)', async () => {
      for (const email of Object.values(DEMO_ACCOUNTS)) {
        const result = await login(email, DEMO_PASSWORD);
        expect(result.status, `${email} could not log in`).toBe(200);
      }
    });
  });

  describe('idempotency and determinism (§12)', () => {
    it('restarts codes at 0001 on a re-run', async () => {
      await runSeed({ reset: true });

      const codes = (await Employee.find({ isDeleted: false }).sort({ employeeCode: 1 }).lean().exec()).map(
        (e) => e.employeeCode,
      );

      expect(codes[0]).toBe('HRV-0001');
      expect(codes.at(-1)).toBe(`HRV-${String(EMPLOYEES.length).padStart(4, '0')}`);
    });

    it('resets the counters collection', async () => {
      await runSeed({ reset: true });

      const counter = await Counter.findById('employee').lean().exec();
      expect(counter?.seq).toBe(EMPLOYEES.length);
    });

    it('never accumulates duplicate users or employees across runs', async () => {
      await runSeed({ reset: true });
      await runSeed({ reset: true });

      expect(await User.countDocuments({})).toBe(DEMO_USERS.length);
      expect(await Employee.countDocuments({})).toBe(EMPLOYEES.length);
      expect(await Department.countDocuments({})).toBe(DEPARTMENTS.length);
    });

    it('leaves the audit trail empty until real activity happens', async () => {
      const { AuditLog } = await import('../../src/modules/audit/audit.model');

      expect(await AuditLog.countDocuments({})).toBe(0);
    });
  });
});