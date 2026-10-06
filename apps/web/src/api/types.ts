/**
 * AGENTS.md §10 — shared shapes for the P1 API responses.
 * These mirror the backend envelopes; they assert structure, never content.
 */

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ListResponse<T> {
  data: T[];
  meta: PageMeta;
}

export interface ItemResponse<T> {
  data: T;
}

export type EmploymentType = 'Full-Time' | 'Intern' | 'Freelancer' | 'Contractor' | 'Other';
export type EmployeeStatus =
  | 'Active'
  | 'Probation'
  | 'On Notice'
  | 'Resigned'
  | 'Relieved'
  | 'Inactive';

export interface EmployeeSummary {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  designation: string | null;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  dateOfJoining: string;
  department: { id: string; name: string } | null;
  reportingManager: { id: string; employeeCode: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeDetail extends EmployeeSummary {
  photoUrl: string | null;
  dob: string | null;
  probationEndDate: string | null;
  lastWorkingDay: string | null;
  address: Record<string, string | undefined> | null;
  emergencyContact: Record<string, string | undefined> | null;
  compensation: { amount?: number; currency?: string; period?: string } | null;
  bankDetails: {
    accountHolder?: string;
    ifscOrRouting?: string;
    bankName?: string;
    masked: true;
  } | null;
  statusHistory: Array<{
    status: EmployeeStatus;
    changedAt: string;
    changedBy: string | null;
    note?: string;
  }>;
  employmentHistory: Array<{
    employmentType: EmploymentType;
    designation?: string;
    departmentId: string | null;
    from: string;
    to: string | null;
    note?: string;
  }>;
}

export interface EmployeeHistory {
  employee: { id: string; employeeCode: string; fullName: string; status: EmployeeStatus };
  statusHistory: EmployeeDetail['statusHistory'];
  employmentHistory: EmployeeDetail['employmentHistory'];
}

export interface DepartmentRow {
  id: string;
  name: string;
  head: { id: string; fullName: string; employeeCode: string } | null;
  employeeCount: number;
}

export interface ManagerOption {
  id: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  status: EmployeeStatus;
}

export interface DashboardSummary {
  scope: { kind: 'organisation' | 'team' | 'self'; label: string; visibleEmployeeIds: number | null };
  generatedAt: string;
  cache: { ttlSeconds: number; hit: boolean };
  metrics: {
    totalEmployees: number;
    fullTime: number;
    interns: number;
    freelancers: number;
    newJoiners: number;
    onLeave: number | null;
    onNotice: number;
    leavingSoon: number;
    pendingHrActions: { key: string; label: string; value: number | null; phase: string | null };
    pendingOnboarding: number | null;
    pendingDocumentGeneration: number | null;
    pendingAssetReturns: number | null;
    pendingLicenseRevocations: number | null;
  };
  unavailable: Array<{ metric: string; phase: string; reason: string }>;
  recentlyJoined: Array<{
    id: string;
    employeeCode: string;
    fullName: string;
    designation: string | null;
    employmentType: string;
    status: string;
    dateOfJoining?: string;
    lastWorkingDay?: string | null;
  }>;
  leavingSoonEmployees: DashboardSummary['recentlyJoined'];
  quickActions: Array<{ key: string; label: string; href: string; enabled: boolean; phase?: string }>;
}
