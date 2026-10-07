export type OnboardingItemKey =
  | 'personalInfo'
  | 'identityDocs'
  | 'educationalDocs'
  | 'offerLetter'
  | 'agreementNda'
  | 'bankInfo'
  | 'taxInfo'
  | 'departmentAssignment'
  | 'managerAssignment'
  | 'companyEmailAccount'
  | 'hardwareAssignment'
  | 'softwareLicenseAssignment'
  | 'orientation'
  | 'policyAcknowledgement';

export interface OnboardingItem {
  key: OnboardingItemKey;
  title: string;
  category: string;
  status: 'Pending' | 'Completed' | 'NA';
  isRequired: boolean;
  completedAt?: string | null;
  completedBy?: string | null;
  completedSource?: string | null;
  notes?: string | null;
  naReason?: string | null;
  smartLink: string;
}

export interface OnboardingRecord {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  employmentType: string;
  dateOfJoining: string;
  status: 'Not Started' | 'In Progress' | 'Completed';
  progressPercent: number;
  completedItemsCount: number;
  totalItemsCount: number;
  startedAt?: string | null;
  completedAt?: string | null;
  reopenedAt?: string | null;
  reopenReason?: string | null;
  items: OnboardingItem[];
  createdAt: string;
  updatedAt: string;
}
