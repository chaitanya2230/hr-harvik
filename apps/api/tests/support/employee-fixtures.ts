import { Types } from 'mongoose';
import { Employee } from '../../src/modules/employees/employee.model';
import { Department } from '../../src/modules/departments/department.model';

/**
 * P1 test fixtures.
 *
 * Looked up by email / name rather than by generated `employeeCode`, because the
 * seed allocates codes in hierarchy order and hard-coding HRV-0001..HRV-0011
 * would make these tests break for the wrong reason if the fixture order ever
 * changes.
 */

export async function employeeIdByEmail(email: string): Promise<string> {
  const doc = await Employee.findOne({ email }).select('_id').lean().exec();
  if (!doc) throw new Error(`Seed fixture "${email}" not found`);
  return doc._id.toString();
}

export async function employeeIdByCode(employeeCode: string): Promise<string> {
  const doc = await Employee.findOne({ employeeCode }).select('_id').lean().exec();
  if (!doc) throw new Error(`Seed employee "${employeeCode}" not found`);
  return doc._id.toString();
}

export async function departmentIdByName(name: string): Promise<string> {
  const doc = await Department.findOne({ name }).select('_id').lean().exec();
  if (!doc) throw new Error(`Seed department "${name}" not found`);
  return doc._id.toString();
}

/** The seeded demo users, resolved to their employee records. */
export const SEEDED = {
  /** Head of People, top of the reporting tree, HR Admin login. */
  headOfPeople: 'meera.raghavan@harviktech.com',
  hrBusinessPartner: 'vikram.nair@harviktech.com',
  engineeringManager: 'ananya.iyer@harviktech.com',
  seniorEngineer: 'rahul.verma@harviktech.com',
  softwareEngineer: 'sneha.patil@harviktech.com',
  contractor: 'rohit.bansal@harviktech.com',
  freelancerEng: 'naveen.joshi@harviktech.com',
  productDesigner: 'karan.malhotra@harviktech.com',
  intern: 'dev.sharma@harviktech.com',
  financeAnalyst: 'ishita.rao@harviktech.com',
  salesExecutive: 'pooja.menon@harviktech.com',
} as const;

/** A date-only string `days` away from today, in the company timezone. */
export function daysFromToday(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/** Do the seeded demo users actually exist? Guards against a silent seed change. */
export async function assertSeedIntact(): Promise<void> {
  for (const email of Object.values(SEEDED)) {
    await employeeIdByEmail(email);
  }
}

export const isObjectId = (value: string): boolean => Types.ObjectId.isValid(value);
