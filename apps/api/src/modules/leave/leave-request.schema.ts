import { Schema, type Document as MongooseDocument, type Model, type Types } from 'mongoose';
import { LEAVE_REQUEST_STATUSES, type LeaveRequestStatus } from '../../config/constants';

export interface LeaveRequestDoc extends MongooseDocument {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  leaveTypeId: Types.ObjectId;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  halfDay: boolean;
  days: number;
  reason: string;
  status: LeaveRequestStatus;
  approverId: Types.ObjectId | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  documentId: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const leaveRequestSchema = new Schema<LeaveRequestDoc, Model<LeaveRequestDoc>>(
  {
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    leaveTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'LeaveType',
      required: true,
      index: true,
    },
    fromDate: {
      type: String,
      required: true,
      index: true,
    },
    toDate: {
      type: String,
      required: true,
      index: true,
    },
    halfDay: {
      type: Boolean,
      default: false,
    },
    days: {
      type: Number,
      required: true,
      min: 0.5,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: LEAVE_REQUEST_STATUSES,
      default: 'Pending',
      index: true,
    },
    approverId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decisionNote: {
      type: String,
      default: null,
      trim: true,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: 'Document',
      default: null,
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
