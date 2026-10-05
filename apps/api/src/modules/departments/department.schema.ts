import { Schema, Types } from 'mongoose';

/** AGENTS.md §7 — Departments. */
export interface DepartmentDoc {
  name: string;
  headEmployeeId: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
}

export const departmentSchema = new Schema<DepartmentDoc>(
  {
    name: {
      type: String,
      required: [true, 'Department name is required'],
      unique: true,
      trim: true,
      maxlength: 120,
    },
    headEmployeeId: { type: Types.ObjectId, ref: 'Employee', default: null },
    createdBy: { type: Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'departments',
    versionKey: false,
  },
);