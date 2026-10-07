import { Schema, type Types } from 'mongoose';
import { JOB_STATUSES, type JobStatus } from '../../config/constants';

/**
 * AGENTS.md §7 — Jobs
 *
 * Fields:
 *  - jobCode unique (JOB-0001)
 *  - title
 *  - departmentId
 *  - openings
 *  - description
 *  - requiredSkills[]
 *  - hiringManagerId
 *  - openingDate
 *  - closingDate
 *  - status: Draft | Open | On Hold | Closed | Filled
 *  - filledCount
 *  - isDeleted, createdBy, createdAt, updatedAt
 */

export interface JobDoc {
  _id: Types.ObjectId;
  jobCode: string;
  title: string;
  departmentId: Types.ObjectId;
  openings: number;
  filledCount: number;
  description: string;
  requiredSkills: string[];
  hiringManagerId: Types.ObjectId;
  openingDate: string; // YYYY-MM-DD
  closingDate?: string | null; // YYYY-MM-DD
  status: JobStatus;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const jobSchema = new Schema<JobDoc>(
  {
    jobCode: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    openings: { type: Number, required: true, min: 1 },
    filledCount: { type: Number, required: true, default: 0, min: 0 },
    description: { type: String, required: true },
    requiredSkills: { type: [String], default: [] },
    hiringManagerId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    openingDate: { type: String, required: true },
    closingDate: { type: String, default: null },
    status: { type: String, enum: JOB_STATUSES, default: 'Open', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

jobSchema.index({ departmentId: 1, status: 1 });
jobSchema.index({ hiringManagerId: 1, status: 1 });
