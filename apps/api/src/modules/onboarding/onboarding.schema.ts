import { Schema, type Types } from 'mongoose';
import {
  CHECKLIST_ITEM_STATUSES,
  ONBOARDING_ITEM_KEYS,
  ONBOARDING_STATUSES,
  type ChecklistItemStatus,
  type OnboardingItemKey,
  type OnboardingStatus,
} from '../../config/constants';

export interface OnboardingChecklistItemDoc {
  key: OnboardingItemKey;
  title: string;
  category: 'profile' | 'documents' | 'access' | 'equipment' | 'orientation';
  status: ChecklistItemStatus;
  isRequired: boolean;
  completedAt?: Date | null;
  completedBy?: Types.ObjectId | null;
  completedSource?: 'Auto' | 'Manual' | null;
  notes?: string | null;
  naReason?: string | null;
}

export interface OnboardingDoc {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  status: OnboardingStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  reopenedAt?: Date | null;
  reopenedBy?: Types.ObjectId | null;
  reopenReason?: string | null;
  items: OnboardingChecklistItemDoc[];
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const checklistItemSchema = new Schema<OnboardingChecklistItemDoc>(
  {
    key: { type: String, enum: ONBOARDING_ITEM_KEYS, required: true },
    title: { type: String, required: true },
    category: {
      type: String,
      enum: ['profile', 'documents', 'access', 'equipment', 'orientation'],
      required: true,
    },
    status: { type: String, enum: CHECKLIST_ITEM_STATUSES, default: 'Pending' },
    isRequired: { type: Boolean, default: true },
    completedAt: { type: Date, default: null },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    completedSource: { type: String, enum: ['Auto', 'Manual'], default: null },
    notes: { type: String, default: null },
    naReason: { type: String, default: null },
  },
  { _id: false },
);

export const onboardingSchema = new Schema<OnboardingDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true, index: true },
    status: { type: String, enum: ONBOARDING_STATUSES, default: 'Not Started', index: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    reopenedAt: { type: Date, default: null },
    reopenedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reopenReason: { type: String, default: null },
    items: { type: [checklistItemSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);
