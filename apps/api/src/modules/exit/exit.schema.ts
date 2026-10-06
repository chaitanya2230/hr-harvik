import { Schema } from 'mongoose';
import type { Types } from 'mongoose';

/**
 * AGENTS.md §7 + §8.10 — Exit data model.
 *
 * Tracks the complete employee offboarding lifecycle:
 * Resignation → Notice Period → Clearance → Asset Return →
 * Software Revocation → Final Settlement → Documents → Relieved.
 */

export const EXIT_STAGES = [
  'Resignation',
  'Notice Period',
  'Clearance',
  'Asset Return',
  'Software Revocation',
  'Final Settlement',
  'Documents',
  'Relieved',
  'Cancelled',
] as const;
export type ExitStage = (typeof EXIT_STAGES)[number];

export const CLEARANCE_STATUSES = ['Pending', 'Approved', 'Rejected'] as const;
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];

export const FINAL_SETTLEMENT_STATUSES = ['Pending', 'Processing', 'Completed'] as const;
export type FinalSettlementStatus = (typeof FINAL_SETTLEMENT_STATUSES)[number];

export const CHECKLIST_CATEGORIES = [
  'asset',
  'license',
  'access',
  'clearance',
  'settlement',
  'document',
  'other',
] as const;
export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number];

export const CHECKLIST_STATUSES = ['Pending', 'Completed', 'Waived'] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export interface ExitChecklistItem {
  id: string;
  category: ChecklistCategory;
  title: string;
  status: ChecklistStatus;
  referenceType?: 'Asset' | 'License' | 'AccessItem' | null;
  referenceId?: string | null;
  details?: string | null;
  completedAt?: Date | null;
  completedBy?: Types.ObjectId | null;
  notes?: string | null;
}

export interface ClearanceItem {
  status: ClearanceStatus;
  comments?: string | null;
  reviewedBy?: Types.ObjectId | null;
  reviewedAt?: Date | null;
}

export interface Clearances {
  manager: ClearanceItem;
  hr: ClearanceItem;
  finance: ClearanceItem;
}

export interface ExitDoc {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  resignationDate: string; // YYYY-MM-DD
  noticePeriodDays: number;
  lastWorkingDay: string; // YYYY-MM-DD
  reason: string;
  reasonNote?: string | null;
  clearances: Clearances;
  checklist: ExitChecklistItem[];
  finalSettlementStatus: FinalSettlementStatus;
  experienceLetterDocId?: Types.ObjectId | null;
  relievingLetterDocId?: Types.ObjectId | null;
  stage: ExitStage;
  completedAt?: Date | null;
  forceRelieved?: boolean;
  forceReason?: string | null;
  forceRelievedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
}

const clearanceItemSchema = new Schema<ClearanceItem>(
  {
    status: {
      type: String,
      enum: CLEARANCE_STATUSES,
      default: 'Pending',
      required: true,
    },
    comments: { type: String, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { _id: false },
);

const checklistItemSchema = new Schema<ExitChecklistItem>(
  {
    id: { type: String, required: true },
    category: {
      type: String,
      enum: CHECKLIST_CATEGORIES,
      required: true,
    },
    title: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: CHECKLIST_STATUSES,
      default: 'Pending',
      required: true,
    },
    referenceType: {
      type: String,
      enum: ['Asset', 'License', 'AccessItem'],
      default: null,
    },
    referenceId: { type: String, default: null },
    details: { type: String, default: null },
    completedAt: { type: Date, default: null },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, default: null },
  },
  { _id: false },
);

export const exitSchema = new Schema<ExitDoc>(
  {
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    resignationDate: { type: String, required: true },
    noticePeriodDays: { type: Number, required: true, min: 0, default: 30 },
    lastWorkingDay: { type: String, required: true },
    reason: { type: String, required: true, trim: true },
    reasonNote: { type: String, default: null },
    clearances: {
      type: {
        manager: { type: clearanceItemSchema, default: () => ({ status: 'Pending' }) },
        hr: { type: clearanceItemSchema, default: () => ({ status: 'Pending' }) },
        finance: { type: clearanceItemSchema, default: () => ({ status: 'Pending' }) },
      },
      required: true,
      default: () => ({
        manager: { status: 'Pending' },
        hr: { status: 'Pending' },
        finance: { status: 'Pending' },
      }),
    },
    checklist: {
      type: [checklistItemSchema],
      default: [],
    },
    finalSettlementStatus: {
      type: String,
      enum: FINAL_SETTLEMENT_STATUSES,
      default: 'Pending',
      required: true,
    },
    experienceLetterDocId: { type: Schema.Types.ObjectId, ref: 'Document', default: null },
    relievingLetterDocId: { type: Schema.Types.ObjectId, ref: 'Document', default: null },
    stage: {
      type: String,
      enum: EXIT_STAGES,
      default: 'Resignation',
      required: true,
      index: true,
    },
    completedAt: { type: Date, default: null },
    forceRelieved: { type: Boolean, default: false },
    forceReason: { type: String, default: null },
    forceRelievedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  },
);

exitSchema.index({ employeeId: 1, isDeleted: 1 });
