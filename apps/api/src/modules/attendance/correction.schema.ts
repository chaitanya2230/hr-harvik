import { Schema, type Document as MongooseDocument, type Model, type Types } from 'mongoose';
import {
  ATTENDANCE_CORRECTION_STATUSES,
  ATTENDANCE_STATUSES,
  WORK_MODES,
  type AttendanceCorrectionStatus,
  type AttendanceStatus,
  type WorkMode,
} from '../../config/constants';

export interface AttendanceCorrectionDoc extends MongooseDocument {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  date: string; // YYYY-MM-DD
  requestedStatus: AttendanceStatus;
  requestedWorkMode: WorkMode | null;
  reason: string;
  status: AttendanceCorrectionStatus;
  reviewedBy: Types.ObjectId | null;
  reviewNote: string | null;
  decidedAt: Date | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const attendanceCorrectionSchema = new Schema<AttendanceCorrectionDoc, Model<AttendanceCorrectionDoc>>(
  {
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    requestedStatus: {
      type: String,
      enum: ATTENDANCE_STATUSES,
      required: true,
    },
    requestedWorkMode: {
      type: String,
      enum: WORK_MODES,
      default: null,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ATTENDANCE_CORRECTION_STATUSES,
      default: 'Pending',
      index: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewNote: {
      type: String,
      default: null,
      trim: true,
    },
    decidedAt: {
      type: Date,
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
