import { Schema, type Document as MongooseDocument, type Model, type Types } from 'mongoose';

export interface LeaveBalanceDoc extends MongooseDocument {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  leaveTypeId: Types.ObjectId;
  year: number;
  allocated: number;
  used: number;
  pending: number;
  carriedForward: number;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const leaveBalanceSchema = new Schema<LeaveBalanceDoc, Model<LeaveBalanceDoc>>(
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
    year: {
      type: Number,
      required: true,
      index: true,
    },
    allocated: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    used: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    pending: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    carriedForward: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
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

// Compound unique index: employeeId + leaveTypeId + year mandated by AGENTS.md §7
leaveBalanceSchema.index({ employeeId: 1, leaveTypeId: 1, year: 1 }, { unique: true });
