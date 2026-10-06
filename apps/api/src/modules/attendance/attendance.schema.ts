import { Schema, type Document as MongooseDocument, type Model, type Types } from 'mongoose';
import {
  ATTENDANCE_SOURCES,
  ATTENDANCE_STATUSES,
  WORK_MODES,
  type AttendanceSource,
  type AttendanceStatus,
  type WorkMode,
} from '../../config/constants';

export interface AttendanceDoc extends MongooseDocument {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  workMode: WorkMode | null;
  checkIn: string | null;
  checkOut: string | null;
  source: AttendanceSource;
  note: string | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const attendanceSchema = new Schema<AttendanceDoc, Model<AttendanceDoc>>(
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
    status: {
      type: String,
      enum: ATTENDANCE_STATUSES,
      required: true,
      index: true,
    },
    workMode: {
      type: String,
      enum: WORK_MODES,
      default: null,
    },
    checkIn: {
      type: String,
      default: null,
    },
    checkOut: {
      type: String,
      default: null,
    },
    source: {
      type: String,
      enum: ATTENDANCE_SOURCES,
      default: 'Manual',
    },
    note: {
      type: String,
      default: null,
      trim: true,
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

// Compound unique index: (employeeId, date) mandated by AGENTS.md §7
attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
