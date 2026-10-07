/**
 * Domain constants shared across modules.
 *
 * These are the values mandated by AGENTS.md §7. Configuration-driven values
 * (leave types, asset types, license types) live in MongoDB and are NOT
 * duplicated here — see `src/config/constants.ts` notes on extensibility.
 */

/** AGENTS.md §6 — Roles. */
export const ROLES = ['HR Admin', 'HR Manager', 'Manager', 'Employee'] as const;
export type Role = (typeof ROLES)[number];

/** AGENTS.md §6 — RBAC is enforced server-side; these are capability keys. */
export const PERMISSIONS = {
  manageUsers: 'manageUsers',
  manageSettings: 'manageSettings',
  manageRoles: 'manageRoles',
  createEmployee: 'createEmployee',
  updateEmployee: 'updateEmployee',
  deleteEmployee: 'deleteEmployee',
  processExit: 'processExit',
  forceRelieve: 'forceRelieve',
  viewAllReports: 'viewAllReports',
  viewCostReports: 'viewCostReports',
  viewEmployeeDirectory: 'viewEmployeeDirectory',
  approveTeamLeave: 'approveTeamLeave',
  approveAttendanceCorrection: 'approveAttendanceCorrection',
  provideManagerClearance: 'provideManagerClearance',
  manageAssets: 'manageAssets',
  manageLicenses: 'manageLicenses',
  manageDocuments: 'manageDocuments',
  manageDocumentTemplates: 'manageDocumentTemplates',
  manageLeaveTypes: 'manageLeaveTypes',
  manageAttendance: 'manageAttendance',
  manageJobs: 'manageJobs',
  deleteJob: 'deleteJob',
  manageCandidates: 'manageCandidates',
  deleteCandidate: 'deleteCandidate',
  viewRecruitment: 'viewRecruitment',
  addInterviewFeedback: 'addInterviewFeedback',
  manageOnboarding: 'manageOnboarding',
  viewOnboarding: 'viewOnboarding',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Role → permission matrix.
 *
 * AGENTS.md §6:
 *  - HR Admin   → full access.
 *  - HR Manager → all HR operations, but no user/system management, no deletes.
 *  - Manager    → team-scoped only.
 *  - Employee   → self-service only.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  'HR Admin': Object.values(PERMISSIONS),
  'HR Manager': [
    PERMISSIONS.createEmployee,
    PERMISSIONS.updateEmployee,
    PERMISSIONS.processExit,
    PERMISSIONS.viewAllReports,
    PERMISSIONS.viewCostReports,
    PERMISSIONS.viewEmployeeDirectory,
    PERMISSIONS.approveTeamLeave,
    PERMISSIONS.approveAttendanceCorrection,
    PERMISSIONS.provideManagerClearance,
    // §6 names the employee-delete restriction only; asset/license management
    // (including delete, which is soft or history-guarded) is an HR operation.
    PERMISSIONS.manageAssets,
    PERMISSIONS.manageLicenses,
    PERMISSIONS.manageDocuments,
    PERMISSIONS.manageAttendance,
    PERMISSIONS.manageJobs,
    PERMISSIONS.manageCandidates,
    PERMISSIONS.viewRecruitment,
    PERMISSIONS.addInterviewFeedback,
    PERMISSIONS.manageOnboarding,
    PERMISSIONS.viewOnboarding,
  ],
  Manager: [
    PERMISSIONS.approveTeamLeave,
    PERMISSIONS.approveAttendanceCorrection,
    PERMISSIONS.provideManagerClearance,
    PERMISSIONS.viewRecruitment,
    PERMISSIONS.addInterviewFeedback,
    PERMISSIONS.viewOnboarding,
  ],
  Employee: [],
};

/** AGENTS.md §7 — Document categories. */
export const DOCUMENT_CATEGORIES = [
  'Offer Letter',
  'Agreement',
  'NDA',
  'Experience Certificate',
  'Relieving Letter',
  'Appraisal',
  'Identity',
  'Education',
  'Other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** AGENTS.md §7 — Document sources. */
export const DOCUMENT_SOURCES = ['Uploaded', 'Generated'] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

/** AGENTS.md §7 — Employee statuses. */
export const EMPLOYEE_STATUSES = [
  'Active',
  'Probation',
  'On Notice',
  'Resigned',
  'Relieved',
  'Inactive',
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** AGENTS.md §7 — Employment types. */
export const EMPLOYMENT_TYPES = [
  'Full-Time',
  'Intern',
  'Freelancer',
  'Contractor',
  'Other',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** AGENTS.md §8.2 — Allowed employee status transitions. */
export const STATUS_TRANSITIONS: Record<EmployeeStatus, readonly EmployeeStatus[]> = {
  Probation: ['Active', 'On Notice', 'Resigned', 'Inactive'],
  Active: ['On Notice', 'Resigned', 'Inactive'],
  Resigned: ['On Notice', 'Relieved'],
  'On Notice': ['Relieved', 'Active'],
  Inactive: ['Active'],
  Relieved: [],
};

/** AGENTS.md §7 — Asset lifecycle statuses (D-29). */
export const ASSET_STATUSES = [
  'Available',
  'Assigned',
  'Under Repair',
  'Lost',
  'Damaged',
  'Returned',
  'Retired',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** AGENTS.md §7 — Asset assignment is open while it has no return date. */
export const ASSIGNABLE_ASSET_STATUSES: readonly AssetStatus[] = ['Available'];

/** AGENTS.md §7 — License lifecycle statuses (D-30). */
export const LICENSE_STATUSES = ['Available', 'Assigned', 'Expired', 'Suspended', 'Revoked'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

/** AGENTS.md §7 — License assignment statuses. */
export const LICENSE_ASSIGNMENT_STATUSES = ['Assigned', 'Revoked'] as const;
export type LicenseAssignmentStatus = (typeof LICENSE_ASSIGNMENT_STATUSES)[number];

/** AGENTS.md §7 — Access item statuses. */
export const ACCESS_STATUSES = ['Active', 'Revoked'] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

/** AGENTS.md §7 — Attendance statuses. */
export const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Half Day', 'Holiday', 'Leave'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** AGENTS.md §7 — Work modes (Office / WFH). */
export const WORK_MODES = ['Office', 'WFH'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

/** AGENTS.md §7 — Attendance entry source. */
export const ATTENDANCE_SOURCES = ['Manual', 'Self', 'Correction', 'NightlyJob', 'LeaveSync'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

/** AGENTS.md §7 — Attendance correction status. */
export const ATTENDANCE_CORRECTION_STATUSES = ['Pending', 'Approved', 'Rejected'] as const;
export type AttendanceCorrectionStatus = (typeof ATTENDANCE_CORRECTION_STATUSES)[number];

/** AGENTS.md §7 — Leave request status. */
export const LEAVE_REQUEST_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

/** AGENTS.md §7 — Job statuses. */
export const JOB_STATUSES = ['Draft', 'Open', 'On Hold', 'Closed', 'Filled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** AGENTS.md §7 — Candidate sources. */
export const CANDIDATE_SOURCES = ['LinkedIn', 'Referral', 'Website', 'Agency', 'Other'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/** AGENTS.md §7 — Candidate stages. */
export const CANDIDATE_STAGES = [
  'Applied',
  'Shortlisted',
  'Interview',
  'Selected',
  'Rejected',
  'Offer',
  'Joined',
] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

/** AGENTS.md §7 — Candidate selection statuses. */
export const SELECTION_STATUSES = ['Pending', 'Selected', 'Rejected'] as const;
export type SelectionStatus = (typeof SELECTION_STATUSES)[number];

/** AGENTS.md §7 — Candidate offer statuses. */
export const OFFER_STATUSES = ['Pending', 'Sent', 'Accepted', 'Declined'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** AGENTS.md §7 — Interview statuses. */
export const INTERVIEW_STATUSES = ['Scheduled', 'Completed', 'Cancelled'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

/** AGENTS.md §7 — Onboarding checklist overall status. */
export const ONBOARDING_STATUSES = ['Not Started', 'In Progress', 'Completed'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/** AGENTS.md §7 — Onboarding item status. */
export const CHECKLIST_ITEM_STATUSES = ['Pending', 'Completed', 'NA'] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

/** AGENTS.md §7 — 14 mandatory onboarding checklist items. */
export const ONBOARDING_ITEM_KEYS = [
  'personalInfo',
  'identityDocs',
  'educationalDocs',
  'offerLetter',
  'agreementNda',
  'bankInfo',
  'taxInfo',
  'departmentAssignment',
  'managerAssignment',
  'companyEmailAccount',
  'hardwareAssignment',
  'softwareLicenseAssignment',
  'orientation',
  'policyAcknowledgement',
] as const;
export type OnboardingItemKey = (typeof ONBOARDING_ITEM_KEYS)[number];

export interface OnboardingItemMeta {
  key: OnboardingItemKey;
  title: string;
  category: 'profile' | 'documents' | 'access' | 'equipment' | 'orientation';
  isRequired: boolean;
}

export const ONBOARDING_ITEM_DEFINITIONS: readonly OnboardingItemMeta[] = [
  { key: 'personalInfo', title: 'Personal information', category: 'profile', isRequired: true },
  { key: 'identityDocs', title: 'Identity documents', category: 'documents', isRequired: true },
  { key: 'educationalDocs', title: 'Educational documents', category: 'documents', isRequired: true },
  { key: 'offerLetter', title: 'Offer letter', category: 'documents', isRequired: true },
  { key: 'agreementNda', title: 'Agreement/NDA', category: 'documents', isRequired: true },
  { key: 'bankInfo', title: 'Bank information', category: 'profile', isRequired: true },
  { key: 'taxInfo', title: 'Tax information', category: 'profile', isRequired: true },
  { key: 'departmentAssignment', title: 'Department assignment', category: 'profile', isRequired: true },
  { key: 'managerAssignment', title: 'Manager assignment', category: 'profile', isRequired: true },
  { key: 'companyEmailAccount', title: 'Company email/account', category: 'access', isRequired: true },
  { key: 'hardwareAssignment', title: 'Hardware assignment', category: 'equipment', isRequired: true },
  { key: 'softwareLicenseAssignment', title: 'Software/license assignment', category: 'access', isRequired: true },
  { key: 'orientation', title: 'Orientation', category: 'orientation', isRequired: true },
  { key: 'policyAcknowledgement', title: 'Policy acknowledgement', category: 'orientation', isRequired: true },
];

/** AGENTS.md §7 — A human-readable ID prefix per entity. */
export const ID_PREFIXES = {
  employee: 'HRV',
  asset: 'AST',
  job: 'JOB',
  license: 'LIC',
  candidate: 'CAN',
} as const;
export type IdPrefixKey = keyof typeof ID_PREFIXES;

export const ID_SEQUENCE_WIDTH = 4;

/** AGENTS.md §6 — Refresh token lifetime / denylist. */
export const REFRESH_COOKIE_NAME = 'hr_refresh_token';

/** AGENTS.md §8.1 — Dashboard cache TTL. */
export const DASHBOARD_CACHE_TTL_SECONDS = 60;

/** AGENTS.md §10 — Maximum page size. */
export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;