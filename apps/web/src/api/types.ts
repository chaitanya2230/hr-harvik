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
    accountNumber?: string;
    ifscOrRouting?: string;
    bankName?: string;
    masked: boolean;
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
  /** §8.1 clickable cards. Null where no filtered list exists yet. */
  links: Record<string, string | null>;
}

export type AssetStatus =
  | 'Available'
  | 'Assigned'
  | 'Under Repair'
  | 'Lost'
  | 'Damaged'
  | 'Returned'
  | 'Retired';

export interface AssetItem {
  id: string;
  assetCode: string;
  name: string;
  type: string;
  brand: string | null;
  model: string | null;
  serialNumber: string;
  purchaseDate: string | null;
  purchaseCost: number | null;
  condition: string | null;
  status: AssetStatus;
  currentAssignmentId: string | null;
  notes: string | null;
  activeAssignment: {
    id: string;
    employee: { id: string; employeeCode: string; fullName: string };
    assignedAt: string;
    expectedReturnDate: string | null;
    overdue: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetAssignmentItem {
  id: string;
  asset: { id: string; assetCode: string; name: string; type: string } | null;
  employee: { id: string; employeeCode: string; fullName: string } | null;
  assignedAt: string;
  expectedReturnDate: string | null;
  actualReturnDate: string | null;
  overdue: boolean;
  conditionAtAssign: string | null;
  conditionAtReturn: string | null;
  notes: string | null;
}

export type LicenseStatus = 'Available' | 'Assigned' | 'Expired' | 'Suspended' | 'Revoked';

export interface LicenseItem {
  id: string;
  licenseCode: string;
  softwareName: string;
  licenseType: string;
  hasKey: boolean;
  provider: string | null;
  cost: number | null;
  currency: string | null;
  billingCycle: string | null;
  startDate: string | null;
  renewalDate: string | null;
  maxSeats: number;
  usedSeats: number;
  availableSeats: number;
  status: LicenseStatus;
  effectivelyExpired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LicenseAssignmentItem {
  id: string;
  license: { id: string; licenseCode: string; softwareName: string } | null;
  employee: { id: string; employeeCode: string; fullName: string } | null;
  assignedAt: string;
  accountIdentifier: string | null;
  status: 'Assigned' | 'Revoked';
  revokedAt: string | null;
  revocationNote: string | null;
}

export interface LicenseUtilization {
  licenseCode: string;
  softwareName: string;
  status: LicenseStatus;
  maxSeats: number;
  usedSeats: number;
  availableSeats: number;
  utilizationPct: number;
  renewalDate: string | null;
  activeAssignments: number;
}

export interface AccessItemEntry {
  id: string;
  employee: { id: string; employeeCode: string; fullName: string } | null;
  system: string;
  identifier: string | null;
  status: 'Active' | 'Revoked';
  revokedAt: string | null;
  linkedLicenseAssignmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Exit / Offboarding (P3 — AGENTS.md §8.10)
// ---------------------------------------------------------------------------

export type ExitStage =
  | 'Resignation'
  | 'Notice Period'
  | 'Clearance'
  | 'Asset Return'
  | 'Software Revocation'
  | 'Final Settlement'
  | 'Documents'
  | 'Relieved'
  | 'Cancelled';

export type ChecklistStatus = 'Pending' | 'Completed' | 'Waived';
export type ChecklistCategory = 'asset' | 'license' | 'access' | 'clearance' | 'settlement' | 'document' | 'other';
export type ClearanceStatus = 'Pending' | 'Approved' | 'Rejected';
export type FinalSettlementStatus = 'Pending' | 'Processing' | 'Completed';

export interface ExitChecklistItem {
  id: string;
  category: ChecklistCategory;
  title: string;
  status: ChecklistStatus;
  referenceType?: 'Asset' | 'License' | 'AccessItem' | null;
  referenceId?: string | null;
  details?: string | null;
  completedAt?: string | null;
  completedBy?: string | null;
  notes?: string | null;
}

export interface ClearanceItem {
  status: ClearanceStatus;
  comments?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

export interface ExitView {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  resignationDate: string;
  noticePeriodDays: number;
  lastWorkingDay: string;
  reason: string;
  reasonNote?: string | null;
  clearances: {
    manager: ClearanceItem;
    hr: ClearanceItem;
    finance: ClearanceItem;
  };
  checklist: ExitChecklistItem[];
  finalSettlementStatus: FinalSettlementStatus;
  experienceLetterDocId?: string | null;
  relievingLetterDocId?: string | null;
  stage: ExitStage;
  completedAt?: string | null;
  forceRelieved?: boolean;
  forceReason?: string | null;
  blockers: string[];
  createdAt: string;
  updatedAt: string;
}

export type DocumentCategory =
  | 'Offer Letter'
  | 'Agreement'
  | 'NDA'
  | 'Experience Certificate'
  | 'Relieving Letter'
  | 'Appraisal'
  | 'Identity'
  | 'Education'
  | 'Other';

export type DocumentSource = 'Uploaded' | 'Generated';

export interface DocumentFileMeta {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
}

export interface DocumentItem {
  id: string;
  employeeId: string;
  category: DocumentCategory;
  title: string;
  file: DocumentFileMeta;
  version: number;
  previousVersionId?: string | null;
  source: DocumentSource;
  templateId?: string | null;
  expiryDate?: string | null;
  confidential: boolean;
  uploadedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentTemplateItem {
  id: string;
  name: string;
  category: DocumentCategory;
  applicableEmploymentTypes: EmploymentType[];
  bodyHtml: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

