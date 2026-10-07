export interface Job {
  id: string;
  jobCode: string;
  title: string;
  departmentId: string;
  departmentName?: string;
  openings: number;
  filledCount: number;
  remainingOpenings: number;
  description: string;
  requiredSkills: string[];
  hiringManagerId: string;
  hiringManagerName?: string;
  openingDate: string;
  closingDate?: string | null;
  status: 'Draft' | 'Open' | 'On Hold' | 'Closed' | 'Filled';
  createdAt: string;
  updatedAt: string;
}

export interface CandidateInterview {
  id?: string;
  round: number;
  title: string;
  interviewerId: string;
  interviewerName?: string;
  scheduledAt: string;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  feedback?: string | null;
  rating?: number | null;
  completedAt?: string | null;
}

export interface CandidateStageHistory {
  stage: string;
  changedAt: string;
  changedBy?: string | null;
  note?: string | null;
}

export interface Candidate {
  id: string;
  candidateCode: string;
  name: string;
  email: string;
  phone: string;
  jobId: string;
  jobCode?: string;
  jobTitle?: string;
  departmentName?: string;
  source: 'LinkedIn' | 'Referral' | 'Website' | 'Agency' | 'Other';
  stage: 'Applied' | 'Shortlisted' | 'Interview' | 'Selected' | 'Offer' | 'Joined' | 'Rejected';
  selectionStatus: string;
  offerStatus: 'Pending' | 'Sent' | 'Accepted' | 'Declined';
  joiningDate?: string | null;
  resumeFile?: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  } | null;
  interviews: CandidateInterview[];
  stageHistory: CandidateStageHistory[];
  rejectionReason?: string | null;
  convertedEmployeeId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversionResult {
  candidateId: string;
  candidateCode: string;
  employeeId: string;
  employeeCode: string;
  jobId: string;
  jobCode: string;
  filledCount: number;
  openings: number;
}
