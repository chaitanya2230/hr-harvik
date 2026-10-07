import { Types, type ClientSession } from 'mongoose';
import { LeaveBalance } from './leave-balance.model';
import type { LeaveBalanceDoc } from './leave-balance.schema';
import { LeaveType } from './leave-type.model';
import { Holiday } from '../attendance/holiday.model';
import { collectTeamIds, isValidScopeId } from '../employees/employee.scope';
import { eachDayInclusive, isWeekend, todayInTimeZone } from '../../utils/dates';
import { trustedFilter } from '../../utils/mongo';
import type { AuthAccount } from '../auth/auth.service';
import type { EmploymentType } from '../../config/constants';

/**
 * Calculates working days between two dates (inclusive),
 * strictly excluding weekends and registered company holidays.
 */
export async function calculateWorkingDays(
  fromDate: string,
  toDate: string,
  halfDay = false,
): Promise<{ workingDays: number; dates: string[] }> {
  const allDays = eachDayInclusive(fromDate, toDate);
  const holidays = await Holiday.find({
    date: trustedFilter({ $in: allDays }),
    isDeleted: false,
  }).select('date');

  const holidaySet = new Set(holidays.map((h) => h.date));
  const workingDateList = allDays.filter((d) => !isWeekend(d) && !holidaySet.has(d));

  if (workingDateList.length === 0) {
    return { workingDays: 0, dates: [] };
  }

  if (halfDay) {
    return { workingDays: 0.5, dates: workingDateList };
  }

  return { workingDays: workingDateList.length, dates: workingDateList };
}

/**
 * AGENTS.md §8.2, §14 LEV — Auto-creates leave balances for an employee,
 * applying joining-month pro-rating when joining in the current year.
 */
export async function initializeEmployeeBalances(
  employeeId: Types.ObjectId | string,
  dateOfJoining: string,
  employmentType: EmploymentType,
  targetYear?: number,
  session?: ClientSession,
): Promise<LeaveBalanceDoc[]> {
  const empId = typeof employeeId === 'string' ? new Types.ObjectId(employeeId) : employeeId;
  const year = targetYear ?? new Date().getUTCFullYear();
  const joiningYear = parseInt(dateOfJoining.slice(0, 4), 10);
  const joiningMonth = parseInt(dateOfJoining.slice(5, 7), 10);

  const applicableTypes = await LeaveType.find({
    applicableEmploymentTypes: employmentType,
    isActive: true,
    isDeleted: false,
  }).session(session ?? null);

  const createdBalances: LeaveBalanceDoc[] = [];

  for (const lt of applicableTypes) {
    let allocation = lt.annualAllocation;

    // AGENTS.md §14 LEV — joining-month pro-rating
    if (year === joiningYear && lt.annualAllocation > 0) {
      const remainingMonths = Math.max(1, 13 - joiningMonth);
      allocation = Math.round((lt.annualAllocation / 12) * remainingMonths);
    }

    const balance = await LeaveBalance.findOneAndUpdate(
      { employeeId: empId, leaveTypeId: lt._id, year },
      {
        $setOnInsert: {
          employeeId: empId,
          leaveTypeId: lt._id,
          year,
          allocated: allocation,
          used: 0,
          pending: 0,
          carriedForward: 0,
        },
      },
      { upsert: true, new: true, session: session ?? null },
    );
    if (balance) createdBalances.push(balance);
  }

  return createdBalances;
}

/**
 * AGENTS.md §14 LEV — Year rollover with carry-forward capped at maxCarryForward.
 */
export async function rolloverYear(
  employeeId: string,
  fromYear: number,
  toYear: number,
): Promise<LeaveBalanceDoc[]> {
  const empId = new Types.ObjectId(employeeId);
  const pastBalances = await LeaveBalance.find({
    employeeId: empId,
    year: fromYear,
    isDeleted: false,
  }).populate('leaveTypeId');

  const rolledBalances: LeaveBalanceDoc[] = [];

  for (const pb of pastBalances) {
    const lt = pb.leaveTypeId as unknown as {
      _id: Types.ObjectId;
      annualAllocation: number;
      carryForward: boolean;
      maxCarryForward: number;
    };
    if (!lt) continue;

    let carry = 0;
    if (lt.carryForward) {
      const unused = Math.max(0, pb.allocated + pb.carriedForward - pb.used);
      carry = Math.min(unused, lt.maxCarryForward ?? 0);
    }

    const nextBalance = await LeaveBalance.findOneAndUpdate(
      { employeeId: empId, leaveTypeId: lt._id, year: toYear },
      {
        $set: {
          allocated: lt.annualAllocation,
          carriedForward: carry,
        },
        $setOnInsert: {
          used: 0,
          pending: 0,
        },
      },
      { upsert: true, new: true },
    );
    rolledBalances.push(nextBalance);
  }

  return rolledBalances;
}

/**
 * AGENTS.md §8.12 / §14 — operational year rollover, invoked from the daily
 * worker heartbeat. Idempotent by construction: only employees that have
 * balances for the previous year and no rows yet for the current year are
 * rolled, so a rerun never clobbers allocations or `used`/`pending` that were
 * recorded after the initial rollover. Employees hired mid-year receive their
 * current-year balances at creation time and are skipped here.
 */
export async function runScheduledYearRollover(): Promise<{ year: number; employees: number }> {
  const toYear = parseInt(todayInTimeZone().slice(0, 4), 10);
  const fromYear = toYear - 1;

  const employeesWithPast = await LeaveBalance.distinct('employeeId', {
    year: fromYear,
    isDeleted: false,
  });

  let rolled = 0;
  for (const employeeId of employeesWithPast) {
    const hasCurrent = await LeaveBalance.exists({
      employeeId,
      year: toYear,
      isDeleted: false,
    });
    if (hasCurrent) continue;
    await rolloverYear(String(employeeId), fromYear, toYear);
    rolled += 1;
  }

  return { year: toYear, employees: rolled };
}

export async function listBalances(
  query: { employeeId?: string; year?: number },
  actor: AuthAccount,
): Promise<LeaveBalanceDoc[]> {
  const currentYear = query.year ?? new Date().getUTCFullYear();
  const filter: Record<string, unknown> = { year: currentYear, isDeleted: false };

  if (actor.role === 'Employee') {
    if (!isValidScopeId(actor.employeeId)) return [];
    filter.employeeId = new Types.ObjectId(actor.employeeId);
  } else if (actor.role === 'Manager') {
    if (!actor.employeeId) return [];
    const teamIds = await collectTeamIds(actor.employeeId);
    if (query.employeeId) {
      if (!teamIds.has(query.employeeId)) {
        return [];
      }
      filter.employeeId = new Types.ObjectId(query.employeeId);
    } else {
      filter.employeeId = trustedFilter({ $in: Array.from(teamIds).map((id) => new Types.ObjectId(id)) });
    }
  } else if (query.employeeId) {
    filter.employeeId = new Types.ObjectId(query.employeeId);
  }

  return LeaveBalance.find(filter)
    .populate('leaveTypeId')
    .populate('employeeId', 'employeeCode firstName lastName')
    .sort({ createdAt: 1 });
}
