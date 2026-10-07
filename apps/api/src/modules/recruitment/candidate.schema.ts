import { Schema, type Types } from 'mongoose';
import {
  CANDIDATE_SOURCES,
  CANDIDATE_STAGES,
  INTERVIEW_STATUSES,
  OFFER_STATUSES,
  SELECTION_STATUSES,
  type CandidateSource,
  type CandidateStage,
  type InterviewStatus,
  type OfferStatus,
  type SelectionStatus,
} from '../../config/constants';

export interface ResumeFileDoc {
  serverFilename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

export interface InterviewDoc {
  round: number;
  title: string;
  interviewerId: Types.ObjectId;
  scheduledAt: Date;
  status: InterviewStatus;
  feedback?: string | null;
  rating?: number | null; // 1-5
  completedAt?: Date | null;
}

export interface CandidateStageHistoryDoc {
  stage: CandidateStage;
  changedAt: Date;
  changedBy: Types.ObjectId | null;
  note?: string | null;
}

export interface CandidateDoc {
  _id: Types.ObjectId;
  candidateCode: string;
  name: string;
  email: string;
  phone: string;
  resumeFile?: ResumeFileDoc | null;
  jobId: Types.ObjectId;
  source: CandidateSource;
  stage: CandidateStage;
  interviews: InterviewDoc[];
  selectionStatus: SelectionStatus;
  offerStatus: OfferStatus;
  joiningDate?: string | null; // YYYY-MM-DD
  stageHistory: CandidateStageHistoryDoc[];
  rejectionReason?: string | null;
  convertedEmployeeId?: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const resumeFileSchema = new Schema<ResumeFileDoc>(
  {
    serverFilename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const interviewSchema = new Schema<InterviewDoc>(
  {
    round: { type: Number, required: true },
    title: { type: String, required: true },
    interviewerId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    scheduledAt: { type: Date, required: true },
    status: { type: String, enum: INTERVIEW_STATUSES, default: 'Scheduled' },
    feedback: { type: String, default: null },
    rating: { type: Number, min: 1, max: 5, default: null },
    completedAt: { type: Date, default: null },
  },
  { _id: true },
);

const stageHistorySchema = new Schema<CandidateStageHistoryDoc>(
  {
    stage: { type: String, enum: CANDIDATE_STAGES, required: true },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

export const candidateSchema = new Schema<CandidateDoc>(
  {
    candidateCode: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    phone: { type: String, required: true, trim: true },
    resumeFile: { type: resumeFileSchema, default: null },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    source: { type: String, enum: CANDIDATE_SOURCES, required: true },
    stage: { type: String, enum: CANDIDATE_STAGES, default: 'Applied', index: true },
    interviews: { type: [interviewSchema], default: [] },
    selectionStatus: { type: String, enum: SELECTION_STATUSES, default: 'Pending' },
    offerStatus: { type: String, enum: OFFER_STATUSES, default: 'Pending' },
    joiningDate: { type: String, default: null },
    stageHistory: { type: [stageHistorySchema], default: [] },
    rejectionReason: { type: String, default: null },
    convertedEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

candidateSchema.index({ jobId: 1, stage: 1 });
candidateSchema.index({ email: 1, jobId: 1, isDeleted: 1 });
