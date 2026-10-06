import type { Request, Response } from 'express';
import { Department } from './department.model';
import { Employee } from '../employees/employee.model';
import { isUnrestricted, resolveScope } from '../employees/employee.scope';
import { asyncHandler } from '../../utils/http';
import { trustedFilter } from '../../utils/mongo';
import { unauthorized } from '../../utils/errors';

/**
 * AGENTS.md §16 lists departments as a P1 deliverable, but §8.2 specifies no
 * department endpoints. This is the minimum needed for the employee form's
 * department picker: a read-only list. No create/update — those belong with
 * system settings (§6, HR Admin only). See docs/DECISIONS.md D-23.
 */

interface DepartmentRow {
  id: string;
  name: string;
  head: { id: string; fullName: string; employeeCode: string } | null;
  employeeCount: number;
}

/** Headcount within the caller's scope, so a Manager never sees org-wide totals. */
async function listDepartments(
  visibleIds: Set<string> | undefined,
): Promise<DepartmentRow[]> {
  const departments = await Department.find({ isDeleted: false })
    .sort({ name: 1 })
    .populate('headEmployeeId', 'employeeCode firstName lastName')
    .lean()
    .exec();

  const countFilter = visibleIds
    ? { isDeleted: false, _id: trustedFilter({ $in: [...visibleIds] }) }
    : { isDeleted: false };

  const counts = await Employee.aggregate<{ _id: unknown; total: number }>([
    { $match: countFilter },
    { $group: { _id: '$departmentId', total: { $sum: 1 } } },
  ]);

  const countByDepartment = new Map<string, number>(
    counts
      .filter((row) => row._id)
      .map((row) => [String(row._id), row.total]),
  );

  return departments.map((department) => {
    const head = department.headEmployeeId as
      | { _id: unknown; employeeCode: string; firstName: string; lastName: string }
      | null;

    return {
      id: department._id.toString(),
      name: department.name,
      head: head
        ? {
            id: String(head._id),
            fullName: `${head.firstName} ${head.lastName}`.trim(),
            employeeCode: head.employeeCode,
          }
        : null,
      employeeCount: countByDepartment.get(department._id.toString()) ?? 0,
    };
  });
}

export const listDepartmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const account = req.user;
  if (!account) throw unauthorized('Authentication required');

  const scope = await resolveScope(account);
  const rows = await listDepartments(isUnrestricted(scope) ? undefined : scope.employeeIds);

  res.status(200).json({ data: rows });
});

/**
 * The department picker needs a manager list too, scoped the same way as
 * `/employees`. Reuses the employee projection so a Manager only ever sees
 * their own reporting chain as a possible `reportingManagerId`.
 */
export const listManagerOptionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const account = req.user;
  if (!account) throw unauthorized('Authentication required');

  const scope = await resolveScope(account);

  if (account.role !== 'HR Admin' && account.role !== 'HR Manager') {
    // A Manager/Employee has no directory access, so there is nothing to offer
    // as a manager option — except their own chain, which they already know.
    res.status(200).json({ data: [] });
    return;
  }

  const filter = isUnrestricted(scope)
    ? { isDeleted: false, status: trustedFilter({ $nin: ['Relieved'] }) }
    : {
        isDeleted: false,
        status: trustedFilter({ $nin: ['Relieved'] }),
        _id: trustedFilter({ $in: [...scope.employeeIds] }),
      };

  const employees = await Employee.find(filter)
    .select('employeeCode firstName lastName designation status employmentType')
    .sort({ firstName: 1, lastName: 1 })
    .limit(500)
    .lean()
    .exec();

  res.status(200).json({
    data: employees.map((employee) => ({
      id: employee._id.toString(),
      employeeCode: employee.employeeCode,
      fullName: `${employee.firstName} ${employee.lastName}`.trim(),
      designation: employee.designation ?? null,
      status: employee.status,
    })),
  });
});
