import { Schema, type Document as MongooseDocument, type Model, type Types } from 'mongoose';
import { EMPLOYMENT_TYPES, type EmploymentType } from '../../config/constants';

export interface LeaveTypeDoc extends MongooseDocument {
  _id: Types.ObjectId;
  name: string;
  code: string;
  annualAllocation: number;
  carryForward: boolean;
  maxCarryForward: number;
  isPaid: boolean;
  requiresDocument: boolean;
  applicableEmploymentTypes: EmploymentType[];
  isActive: boolean;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const leaveTypeSchema = new Schema<LeaveTypeDoc, Model<LeaveTypeDoc>>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    annualAllocation: {
      type: Number,
      required: true,
      min: 0,
    },
    carryForward: {
      type: Boolean,
      default: false,
    },
    maxCarryForward: {
      type: Number,
      default: 0,
      min: 0,
    },
    isPaid: {
      type: Boolean,
      default: true,
    },
    requiresDocument: {
      type: Boolean,
      default: false,
    },
    applicableEmploymentTypes: {
      type: [String],
      enum: EMPLOYMENT_TYPES,
      default: () => [...EMPLOYMENT_TYPES],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);
