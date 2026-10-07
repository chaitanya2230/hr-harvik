import { Types } from 'mongoose';
import { type AuthAccount } from '../auth/auth.service';
import { resolveScope, isUnrestricted } from '../employees/employee.scope';
import { Employee } from '../employees/employee.model';
import { Department } from '../departments/department.model';
import { Attendance } from '../attendance/attendance.model';
import { LeaveRequest } from '../leave/leave-request.model';
import { Asset, AssetAssignment } from '../assets/asset.model';
import { License, LicenseAssignment } from '../licenses/license.model';
import { Exit } from '../exit/exit.model';
import { type ReportType } from '../../config/constants';
import { type ReportQuery } from './report.validation';
import { type ColumnDefinition } from './export.service';
import { forbidden, notFound } from '../../utils/errors';
import { todayInTimeZone, addDaysIso } from '../../utils/dates';
import { trustedFilter } from '../../utils/mongo';

export interface ReportResult {
  title: string;
  reportType: ReportType;
  columns: ColumnDefinition[];
  rows: Array<Record<string, unknown>>;
  total: number;
  meta?: Record<string, unknown>;
}

export async function generateReportData(
  reportType: ReportType,
  account: AuthAccount,
  query: ReportQuery,
): Promise<ReportResult> {
  const scope = await resolveScope(account);
  const isHr = account.role === 'HR Admin' || account.role === 'HR Manager';

  // 1. Employee Report
  if (reportType === 'employees') {
    if (account.role === 'Employee') {
      throw forbidden('Employees cannot access employee reports');
    }

    const filter: Record<string, unknown> = { isDeleted: false };
    if (!isUnrestricted(scope)) {
      filter._id = trustedFilter({ $in: Array.from(scope.employeeIds).map((id) => new Types.ObjectId(id)) });
    }
    if (query.departmentId) filter.departmentId = new Types.ObjectId(query.departmentId);
    if (query.employmentType) filter.employmentType = query.employmentType;
    if (query.status) filter.status = query.status;
    if (query.managerId) filter.reportingManagerId = new Types.ObjectId(query.managerId);
    if (query.joiningFrom || query.joiningTo) {
      filter.dateOfJoining = trustedFilter({
        ...(query.joiningFrom ? { $gte: query.joiningFrom } : {}),
        ...(query.joiningTo ? { $lte: query.joiningTo } : {}),
      });
    }

    const employees = await Employee.find(filter)
      .populate('departmentId', 'name')
      .populate('reportingManagerId', 'firstName lastName employeeCode')
      .sort({ employeeCode: 1 })
      .lean()
      .exec();

    const columns: ColumnDefinition[] = [
      { header: 'Employee Code', key: 'employeeCode', width: 15 },
      { header: 'First Name', key: 'firstName', width: 15 },
      { header: 'Last Name', key: 'lastName', width: 15 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Designation', key: 'designation', width: 20 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Reporting Manager', key: 'reportingManager', width: 20 },
      { header: 'Employment Type', key: 'employmentType', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Date of Joining', key: 'dateOfJoining', width: 15 },
      { header: 'Date of Birth', key: 'dob', width: 15 },
    ];

    if (isHr) {
      columns.push(
        { header: 'Compensation Amount', key: 'compensationAmount', width: 20 },
        { header: 'Currency', key: 'currency', width: 10 },
        { header: 'Period', key: 'compensationPeriod', width: 15 },
      );
    }

    const rows = employees.map((emp) => {
      const dept = emp.departmentId as { name?: string } | null;
      const mgr = emp.reportingManagerId as { firstName?: string; lastName?: string; employeeCode?: string } | null;
      const row: Record<string, unknown> = {
        employeeCode: emp.employeeCode,
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email,
        phone: emp.phone,
        designation: emp.designation,
        department: dept?.name || 'Unassigned',
        reportingManager: mgr ? `${mgr.firstName} ${mgr.lastName} (${mgr.employeeCode})` : 'None',
        employmentType: emp.employmentType,
        status: emp.status,
        dateOfJoining: emp.dateOfJoining,
        dob: emp.dob || '',
      };

      if (isHr) {
        row.compensationAmount = emp.compensation?.amount ?? '';
        row.currency = emp.compensation?.currency ?? 'INR';
        row.compensationPeriod = emp.compensation?.period ?? '';
      }

      return row;
    });

    return {
      title: 'Employee Master Report',
      reportType,
      columns,
      rows,
      total: rows.length,
    };
  }

  // 2. New Joiner Report
  if (reportType === 'new-joiners') {
    if (account.role === 'Employee') {
      throw forbidden('Employees cannot access new joiner reports');
    }

    const today = todayInTimeZone();
    const defaultStart = addDaysIso(today, -30);
    const startDate = query.startDate || defaultStart;
    const endDate = query.endDate || today;

    const filter: Record<string, unknown> = {
      isDeleted: false,
      dateOfJoining: trustedFilter({ $gte: startDate, $lte: endDate }),
    };

    if (!isUnrestricted(scope)) {
      filter._id = trustedFilter({ $in: Array.from(scope.employeeIds).map((id) => new Types.ObjectId(id)) });
    }
    if (query.departmentId) filter.departmentId = new Types.ObjectId(query.departmentId);
    if (query.employmentType) filter.employmentType = query.employmentType;

    const joiners = await Employee.find(filter)
      .populate('departmentId', 'name')
      .populate('reportingManagerId', 'firstName lastName')
      .sort({ dateOfJoining: -1 })
      .lean()
      .exec();

    const columns: ColumnDefinition[] = [
      { header: 'Employee Code', key: 'employeeCode', width: 15 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Designation', key: 'designation', width: 20 },
      { header: 'Employment Type', key: 'employmentType', width: 15 },
      { header: 'Date of Joining', key: 'dateOfJoining', width: 15 },
    ];

    const rows = joiners.map((emp) => {
      const dept = emp.departmentId as { name?: string } | null;
      return {
        employeeCode: emp.employeeCode,
        name: `${emp.firstName} ${emp.lastName}`,
        email: emp.email,
        department: dept?.name || 'Unassigned',
        designation: emp.designation,
        employmentType: emp.employmentType,
        dateOfJoining: emp.dateOfJoining,
      };
    });

    return {
      title: 'New Joiners Report',
      reportType,
      columns,
      rows,
      total: rows.length,
    };
  }

  // 3. Employee Exit Report
  if (reportType === 'exits') {
    if (account.role === 'Employee') {
      throw forbidden('Employees cannot access exit reports');
    }

    const filter: Record<string, unknown> = { isDeleted: false };
    if (query.stage) filter.stage = query.stage;

    const exits = await Exit.find(filter)
      .populate({
        path: 'employeeId',
        select: 'employeeCode firstName lastName designation departmentId status',
        populate: { path: 'departmentId', select: 'name' },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    let filteredExits = exits;
    if (!isUnrestricted(scope)) {
      filteredExits = exits.filter((e) => {
        const emp = e.employeeId as { _id?: Types.ObjectId } | null;
        return emp?._id && scope.employeeIds.has(emp._id.toString());
      });
    }

    if (query.departmentId) {
      filteredExits = filteredExits.filter((e) => {
        const emp = e.employeeId as { departmentId?: { _id?: Types.ObjectId } } | null;
        return emp?.departmentId?._id?.toString() === query.departmentId;
      });
    }

    if (query.startDate || query.endDate) {
      filteredExits = filteredExits.filter((e) => {
        const lwd = e.lastWorkingDay;
        if (!lwd) return false;
        if (query.startDate && lwd < query.startDate) return false;
        if (query.endDate && lwd > query.endDate) return false;
        return true;
      });
    }

    const columns: ColumnDefinition[] = [
      { header: 'Employee Code', key: 'employeeCode', width: 15 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Designation', key: 'designation', width: 20 },
      { header: 'Resignation Date', key: 'resignationDate', width: 15 },
      { header: 'Last Working Day', key: 'lastWorkingDay', width: 15 },
      { header: 'Reason', key: 'reason', width: 20 },
      { header: 'Stage', key: 'stage', width: 15 },
      { header: 'Final Settlement Status', key: 'settlementStatus', width: 20 },
      { header: 'Completed At', key: 'completedAt', width: 20 },
    ];

    const rows = filteredExits.map((item) => {
      const emp = item.employeeId as {
        employeeCode?: string;
        firstName?: string;
        lastName?: string;
        designation?: string;
        departmentId?: { name?: string };
      } | null;

      return {
        employeeCode: emp?.employeeCode || '',
        name: emp ? `${emp.firstName} ${emp.lastName}` : '',
        department: emp?.departmentId?.name || 'Unassigned',
        designation: emp?.designation || '',
        resignationDate: item.resignationDate || '',
        lastWorkingDay: item.lastWorkingDay || '',
        reason: item.reason || '',
        stage: item.stage || '',
        settlementStatus: item.finalSettlementStatus || '',
        completedAt: item.completedAt ? new Date(item.completedAt).toISOString().slice(0, 10) : '',
      };
    });

    return {
      title: 'Employee Exit Report',
      reportType,
      columns,
      rows,
      total: rows.length,
    };
  }

  // 4. Attendance Report
  if (reportType === 'attendance') {
    if (account.role === 'Employee') {
      throw forbidden('Employees cannot access full attendance reports');
    }

    const today = todayInTimeZone();
    const defaultStart = addDaysIso(today, -30);
    const startDate = query.startDate || defaultStart;
    const endDate = query.endDate || today;

    const filter: Record<string, unknown> = {
      isDeleted: false,
      date: trustedFilter({ $gte: startDate, $lte: endDate }),
    };

    if (!isUnrestricted(scope)) {
      filter.employeeId = trustedFilter({ $in: Array.from(scope.employeeIds).map((id) => new Types.ObjectId(id)) });
    }
    if (query.employeeId) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.status) filter.status = query.status;
    if (query.workMode) filter.workMode = query.workMode;

    const attendanceRecords = await Attendance.find(filter)
      .populate({
        path: 'employeeId',
        select: 'employeeCode firstName lastName designation departmentId',
        populate: { path: 'departmentId', select: 'name' },
      })
      .sort({ date: -1, 'employeeId.employeeCode': 1 })
      .lean()
      .exec();

    let filteredRecords = attendanceRecords;
    if (query.departmentId) {
      filteredRecords = attendanceRecords.filter((a) => {
        const emp = a.employeeId as { departmentId?: { _id?: Types.ObjectId } } | null;
        return emp?.departmentId?._id?.toString() === query.departmentId;
      });
    }

    const columns: ColumnDefinition[] = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Employee Code', key: 'employeeCode', width: 15 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Work Mode', key: 'workMode', width: 15 },
      { header: 'Check In', key: 'checkIn', width: 12 },
      { header: 'Check Out', key: 'checkOut', width: 12 },
      { header: 'Source', key: 'source', width: 15 },
      { header: 'Note', key: 'note', width: 25 },
    ];

    const rows = filteredRecords.map((rec) => {
      const emp = rec.employeeId as {
        employeeCode?: string;
        firstName?: string;
        lastName?: string;
        departmentId?: { name?: string };
      } | null;

      return {
        date: rec.date,
        employeeCode: emp?.employeeCode || '',
        name: emp ? `${emp.firstName} ${emp.lastName}` : '',
        department: emp?.departmentId?.name || 'Unassigned',
        status: rec.status,
        workMode: rec.workMode || '',
        checkIn: rec.checkIn || '',
        checkOut: rec.checkOut || '',
        source: rec.source || '',
        note: rec.note || '',
      };
    });

    return {
      title: 'Attendance Report',
      reportType,
      columns,
      rows,
      total: rows.length,
    };
  }

  // 5. Leave Report
  if (reportType === 'leave') {
    if (account.role === 'Employee') {
      throw forbidden('Employees cannot access full leave reports');
    }

    const filter: Record<string, unknown> = { isDeleted: false };
    if (!isUnrestricted(scope)) {
      filter.employeeId = trustedFilter({ $in: Array.from(scope.employeeIds).map((id) => new Types.ObjectId(id)) });
    }
    if (query.employeeId) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.leaveTypeId) filter.leaveTypeId = new Types.ObjectId(query.leaveTypeId);
    if (query.status) filter.status = query.status;

    if (query.startDate || query.endDate) {
      if (query.startDate && query.endDate) {
        filter.fromDate = trustedFilter({ $lte: query.endDate });
        filter.toDate = trustedFilter({ $gte: query.startDate });
      } else if (query.startDate) {
        filter.toDate = trustedFilter({ $gte: query.startDate });
      } else if (query.endDate) {
        filter.fromDate = trustedFilter({ $lte: query.endDate });
      }
    }

    const leaves = await LeaveRequest.find(filter)
      .populate({
        path: 'employeeId',
        select: 'employeeCode firstName lastName departmentId',
        populate: { path: 'departmentId', select: 'name' },
      })
      .populate('leaveTypeId', 'name code')
      .sort({ fromDate: -1 })
      .lean()
      .exec();

    let filteredLeaves = leaves;
    if (query.departmentId) {
      filteredLeaves = leaves.filter((l) => {
        const emp = l.employeeId as { departmentId?: { _id?: Types.ObjectId } } | null;
        return emp?.departmentId?._id?.toString() === query.departmentId;
      });
    }

    const columns: ColumnDefinition[] = [
      { header: 'Employee Code', key: 'employeeCode', width: 15 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Leave Type', key: 'leaveType', width: 15 },
      { header: 'From Date', key: 'fromDate', width: 12 },
      { header: 'To Date', key: 'toDate', width: 12 },
      { header: 'Days', key: 'days', width: 10 },
      { header: 'Half Day', key: 'halfDay', width: 10 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Reason', key: 'reason', width: 25 },
      { header: 'Applied At', key: 'appliedAt', width: 15 },
      { header: 'Decided At', key: 'decidedAt', width: 15 },
    ];

    const rows = filteredLeaves.map((leave) => {
      const emp = leave.employeeId as {
        employeeCode?: string;
        firstName?: string;
        lastName?: string;
        departmentId?: { name?: string };
      } | null;
      const lt = leave.leaveTypeId as { name?: string } | null;

      return {
        employeeCode: emp?.employeeCode || '',
        name: emp ? `${emp.firstName} ${emp.lastName}` : '',
        department: emp?.departmentId?.name || 'Unassigned',
        leaveType: lt?.name || '',
        fromDate: leave.fromDate,
        toDate: leave.toDate,
        days: leave.days,
        halfDay: leave.halfDay ? 'Yes' : 'No',
        status: leave.status,
        reason: leave.reason || '',
        appliedAt: leave.createdAt ? new Date(leave.createdAt).toISOString().slice(0, 10) : '',
        decidedAt: leave.decidedAt ? new Date(leave.decidedAt).toISOString().slice(0, 10) : '',
      };
    });

    return {
      title: 'Leave Report',
      reportType,
      columns,
      rows,
      total: rows.length,
    };
  }

  // 6. Asset Report
  if (reportType === 'assets') {
    if (!isHr) {
      throw forbidden('Asset reports are restricted to HR Admin and HR Manager');
    }

    const filter: Record<string, unknown> = { isDeleted: false };
    if (query.status) filter.status = query.status;
    if (query.condition) filter.condition = query.condition;

    const assets = await Asset.find(filter)
      .populate({
        path: 'currentAssignmentId',
        populate: { path: 'employeeId', select: 'employeeCode firstName lastName' },
      })
      .sort({ assetCode: 1 })
      .lean()
      .exec();

    const columns: ColumnDefinition[] = [
      { header: 'Asset Code', key: 'assetCode', width: 15 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Type', key: 'type', width: 15 },
      { header: 'Brand', key: 'brand', width: 15 },
      { header: 'Model', key: 'model', width: 15 },
      { header: 'Serial Number', key: 'serialNumber', width: 20 },
      { header: 'Purchase Date', key: 'purchaseDate', width: 15 },
      { header: 'Purchase Cost', key: 'purchaseCost', width: 15 },
      { header: 'Condition', key: 'condition', width: 12 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Assigned To', key: 'assignedTo', width: 25 },
      { header: 'Assigned At', key: 'assignedAt', width: 15 },
    ];

    const rows = assets.map((a) => {
      const assignment = a.currentAssignmentId as {
        assignedAt?: string | Date;
        employeeId?: { employeeCode?: string; firstName?: string; lastName?: string };
      } | null;
      const emp = assignment?.employeeId;

      return {
        assetCode: a.assetCode,
        name: a.name,
        type: a.type,
        brand: a.brand || '',
        model: a.model || '',
        serialNumber: a.serialNumber,
        purchaseDate: a.purchaseDate || '',
        purchaseCost: a.purchaseCost ?? 0,
        condition: a.condition,
        status: a.status,
        assignedTo: emp ? `${emp.firstName} ${emp.lastName} (${emp.employeeCode})` : 'Unassigned',
        assignedAt: assignment?.assignedAt ? new Date(assignment.assignedAt).toISOString().slice(0, 10) : '',
      };
    });

    return {
      title: 'Hardware & Asset Inventory Report',
      reportType,
      columns,
      rows,
      total: rows.length,
    };
  }

  // 7. Software / License Report
  if (reportType === 'licenses') {
    if (!isHr) {
      throw forbidden('License reports are restricted to HR Admin and HR Manager');
    }

    const filter: Record<string, unknown> = { isDeleted: false };
    if (query.licenseType) filter.licenseType = query.licenseType;
    if (query.status) filter.status = query.status;
    if (query.provider) filter.provider = query.provider;

    const licenses = await License.find(filter).sort({ licenseCode: 1 }).lean().exec();

    const columns: ColumnDefinition[] = [
      { header: 'License Code', key: 'licenseCode', width: 15 },
      { header: 'Software Name', key: 'softwareName', width: 20 },
      { header: 'Provider', key: 'provider', width: 15 },
      { header: 'License Type', key: 'licenseType', width: 15 },
      { header: 'Cost', key: 'cost', width: 12 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Billing Cycle', key: 'billingCycle', width: 15 },
      { header: 'Start Date', key: 'startDate', width: 15 },
      { header: 'Renewal Date', key: 'renewalDate', width: 15 },
      { header: 'Max Seats', key: 'maxSeats', width: 12 },
      { header: 'Used Seats', key: 'usedSeats', width: 12 },
      { header: 'Available Seats', key: 'availableSeats', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    const rows = licenses.map((l) => ({
      licenseCode: l.licenseCode,
      softwareName: l.softwareName,
      provider: l.provider || '',
      licenseType: l.licenseType,
      cost: l.cost,
      currency: l.currency,
      billingCycle: l.billingCycle,
      startDate: l.startDate || '',
      renewalDate: l.renewalDate || '',
      maxSeats: l.maxSeats,
      usedSeats: l.usedSeats,
      availableSeats: Math.max(0, l.maxSeats - l.usedSeats),
      status: l.status,
    }));

    return {
      title: 'Software & License Utilization Report',
      reportType,
      columns,
      rows,
      total: rows.length,
    };
  }

  // 8. Pending Asset Returns Report
  if (reportType === 'pending-asset-returns') {
    if (account.role === 'Employee') {
      throw forbidden('Employees cannot access pending asset return reports');
    }

    const today = todayInTimeZone();
    // Active assignments without return
    const assignments = await AssetAssignment.find({
      actualReturnDate: null,
      isDeleted: false,
    })
      .populate('assetId', 'assetCode name type serialNumber')
      .populate('employeeId', 'employeeCode firstName lastName status')
      .sort({ expectedReturnDate: 1 })
      .lean()
      .exec();

    // Filter assignments that are overdue OR belonging to exiting/relieved employees
    const pendingReturns = assignments.filter((asgn) => {
      const emp = asgn.employeeId as { status?: string; _id?: Types.ObjectId } | null;
      if (!emp) return false;

      // Scope check for manager
      if (!isUnrestricted(scope) && !scope.employeeIds.has(emp._id?.toString() || '')) {
        return false;
      }

      const isOverdue = asgn.expectedReturnDate && asgn.expectedReturnDate < today;
      const isExiting = emp.status === 'On Notice' || emp.status === 'Resigned' || emp.status === 'Relieved';
      return isOverdue || isExiting;
    });

    const columns: ColumnDefinition[] = [
      { header: 'Asset Code', key: 'assetCode', width: 15 },
      { header: 'Asset Name', key: 'assetName', width: 20 },
      { header: 'Type', key: 'type', width: 15 },
      { header: 'Serial Number', key: 'serialNumber', width: 20 },
      { header: 'Assigned To', key: 'assignedTo', width: 25 },
      { header: 'Employee Status', key: 'employeeStatus', width: 15 },
      { header: 'Expected Return Date', key: 'expectedReturnDate', width: 20 },
      { header: 'Status Reason', key: 'statusReason', width: 20 },
    ];

    const rows = pendingReturns.map((asgn) => {
      const asset = asgn.assetId as { assetCode?: string; name?: string; type?: string; serialNumber?: string } | null;
      const emp = asgn.employeeId as { employeeCode?: string; firstName?: string; lastName?: string; status?: string } | null;

      const isOverdue = asgn.expectedReturnDate && asgn.expectedReturnDate < today;
      const isExiting = emp?.status === 'On Notice' || emp?.status === 'Resigned' || emp?.status === 'Relieved';
      const reason = isOverdue && isExiting ? 'Overdue & Exit Notice' : isOverdue ? 'Overdue Return Date' : 'Employee On Notice/Exiting';

      return {
        assetCode: asset?.assetCode || '',
        assetName: asset?.name || '',
        type: asset?.type || '',
        serialNumber: asset?.serialNumber || '',
        assignedTo: emp ? `${emp.firstName} ${emp.lastName} (${emp.employeeCode})` : '',
        employeeStatus: emp?.status || '',
        expectedReturnDate: asgn.expectedReturnDate || 'Not specified',
        statusReason: reason,
      };
    });

    return {
      title: 'Pending Asset Returns Report',
      reportType,
      columns,
      rows,
      total: rows.length,
    };
  }

  // 9. Pending License Revocations Report
  if (reportType === 'pending-license-revocations') {
    if (!isHr) {
      throw forbidden('License reports are restricted to HR Admin and HR Manager');
    }

    const exitingEmployees = await Employee.find({
      status: trustedFilter({ $in: ['On Notice', 'Resigned', 'Relieved'] }),
      isDeleted: false,
    })
      .select('_id employeeCode firstName lastName status')
      .lean()
      .exec();

    const exitingEmployeeIds = exitingEmployees.map((e) => e._id);
    const empMap = new Map(exitingEmployees.map((e) => [e._id.toString(), e]));

    const activeAssignments = await LicenseAssignment.find({
      employeeId: trustedFilter({ $in: exitingEmployeeIds }),
      status: 'Assigned',
      isDeleted: false,
    })
      .populate('licenseId', 'licenseCode softwareName')
      .sort({ assignedAt: -1 })
      .lean()
      .exec();

    const columns: ColumnDefinition[] = [
      { header: 'License Code', key: 'licenseCode', width: 15 },
      { header: 'Software Name', key: 'softwareName', width: 20 },
      { header: 'Account Identifier', key: 'accountIdentifier', width: 25 },
      { header: 'Employee Code', key: 'employeeCode', width: 15 },
      { header: 'Employee Name', key: 'employeeName', width: 20 },
      { header: 'Employee Status', key: 'employeeStatus', width: 15 },
      { header: 'Assigned At', key: 'assignedAt', width: 15 },
    ];

    const rows = activeAssignments.map((asgn) => {
      const lic = asgn.licenseId as { licenseCode?: string; softwareName?: string } | null;
      const emp = empMap.get(asgn.employeeId.toString());

      return {
        licenseCode: lic?.licenseCode || '',
        softwareName: lic?.softwareName || '',
        accountIdentifier: asgn.accountIdentifier || '',
        employeeCode: emp?.employeeCode || '',
        employeeName: emp ? `${emp.firstName} ${emp.lastName}` : '',
        employeeStatus: emp?.status || '',
        assignedAt: asgn.assignedAt ? new Date(asgn.assignedAt).toISOString().slice(0, 10) : '',
      };
    });

    return {
      title: 'Pending Software License Revocations Report',
      reportType,
      columns,
      rows,
      total: rows.length,
    };
  }

  // 10. Employee Cost Summary Report (HR Admin / HR Manager only)
  if (reportType === 'cost-summary') {
    if (!isHr) {
      // AGENTS.md §8.11: Salary/cost data is HR Admin/HR Manager only.
      throw forbidden('Employee cost summary is restricted to HR Admin and HR Manager');
    }

    const employees = await Employee.find({
      status: trustedFilter({ $nin: ['Relieved', 'Inactive'] }),
      isDeleted: false,
    })
      .populate('departmentId', 'name')
      .lean()
      .exec();

    let totalPayroll = 0;
    const deptCostMap = new Map<string, { count: number; totalCost: number }>();
    const typeCostMap = new Map<string, { count: number; totalCost: number }>();

    for (const emp of employees) {
      const amount = emp.compensation?.amount || 0;
      totalPayroll += amount;

      const deptId = emp.departmentId ? (emp.departmentId as { _id?: Types.ObjectId; name?: string }).name || 'Unassigned' : 'Unassigned';
      const currentDept = deptCostMap.get(deptId) || { count: 0, totalCost: 0 };
      currentDept.count += 1;
      currentDept.totalCost += amount;
      deptCostMap.set(deptId, currentDept);

      const type = emp.employmentType || 'Other';
      const currentType = typeCostMap.get(type) || { count: 0, totalCost: 0 };
      currentType.count += 1;
      currentType.totalCost += amount;
      typeCostMap.set(type, currentType);
    }

    const columns: ColumnDefinition[] = [
      { header: 'Dimension', key: 'dimension', width: 20 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Employee Count', key: 'count', width: 15 },
      { header: 'Total Monthly Cost (INR)', key: 'totalCost', width: 25 },
      { header: 'Average Monthly Cost (INR)', key: 'avgCost', width: 25 },
    ];

    const rows: Array<Record<string, unknown>> = [];

    // Overall summary row
    rows.push({
      dimension: 'Overview',
      name: 'All Active Employees',
      count: employees.length,
      totalCost: totalPayroll,
      avgCost: employees.length > 0 ? Math.round(totalPayroll / employees.length) : 0,
    });

    // By Department rows
    for (const [deptName, data] of deptCostMap.entries()) {
      rows.push({
        dimension: 'Department',
        name: deptName,
        count: data.count,
        totalCost: data.totalCost,
        avgCost: data.count > 0 ? Math.round(data.totalCost / data.count) : 0,
      });
    }

    // By Employment Type rows
    for (const [typeName, data] of typeCostMap.entries()) {
      rows.push({
        dimension: 'Employment Type',
        name: typeName,
        count: data.count,
        totalCost: data.totalCost,
        avgCost: data.count > 0 ? Math.round(data.totalCost / data.count) : 0,
      });
    }

    return {
      title: 'Employee Cost & Payroll Summary Report',
      reportType,
      columns,
      rows,
      total: rows.length,
      meta: {
        totalEmployees: employees.length,
        totalMonthlyCost: totalPayroll,
        averageMonthlyCost: employees.length > 0 ? Math.round(totalPayroll / employees.length) : 0,
        currency: 'INR',
      },
    };
  }

  // 11. Department-wise Employee Count Report
  if (reportType === 'department-counts') {
    if (account.role === 'Employee') {
      throw forbidden('Employees cannot access department employee count reports');
    }

    const departments = await Department.find({ isDeleted: false })
      .populate('headEmployeeId', 'firstName lastName employeeCode')
      .sort({ name: 1 })
      .lean()
      .exec();

    const employees = await Employee.find({
      status: trustedFilter({ $nin: ['Relieved', 'Inactive'] }),
      isDeleted: false,
    })
      .select('departmentId status employmentType')
      .lean()
      .exec();

    const columns: ColumnDefinition[] = [
      { header: 'Department', key: 'departmentName', width: 20 },
      { header: 'Department Head', key: 'headName', width: 25 },
      { header: 'Active', key: 'activeCount', width: 12 },
      { header: 'Probation', key: 'probationCount', width: 12 },
      { header: 'On Notice', key: 'onNoticeCount', width: 12 },
      { header: 'Total Headcount', key: 'totalCount', width: 15 },
      { header: 'Full-Time', key: 'fullTime', width: 12 },
      { header: 'Intern', key: 'intern', width: 12 },
      { header: 'Freelancer', key: 'freelancer', width: 12 },
      { header: 'Contractor', key: 'contractor', width: 12 },
      { header: 'Other', key: 'other', width: 10 },
    ];

    const rows = departments.map((dept) => {
      const deptEmployees = employees.filter(
        (e) => e.departmentId?.toString() === dept._id.toString(),
      );
      const head = dept.headEmployeeId as { firstName?: string; lastName?: string; employeeCode?: string } | null;

      const activeCount = deptEmployees.filter((e) => e.status === 'Active').length;
      const probationCount = deptEmployees.filter((e) => e.status === 'Probation').length;
      const onNoticeCount = deptEmployees.filter((e) => e.status === 'On Notice').length;

      const fullTime = deptEmployees.filter((e) => e.employmentType === 'Full-Time').length;
      const intern = deptEmployees.filter((e) => e.employmentType === 'Intern').length;
      const freelancer = deptEmployees.filter((e) => e.employmentType === 'Freelancer').length;
      const contractor = deptEmployees.filter((e) => e.employmentType === 'Contractor').length;
      const other = deptEmployees.filter((e) => e.employmentType === 'Other').length;

      return {
        departmentName: dept.name,
        headName: head ? `${head.firstName} ${head.lastName} (${head.employeeCode})` : 'Unassigned',
        activeCount,
        probationCount,
        onNoticeCount,
        totalCount: deptEmployees.length,
        fullTime,
        intern,
        freelancer,
        contractor,
        other,
      };
    });

    return {
      title: 'Department-wise Headcount Report',
      reportType,
      columns,
      rows,
      total: rows.length,
    };
  }

  throw notFound(`Unknown report type: ${reportType}`);
}
