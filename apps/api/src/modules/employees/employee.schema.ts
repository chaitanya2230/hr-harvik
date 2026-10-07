import { Schema, Types } from 'mongoose';
import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  type EmployeeStatus,
  type EmploymentType,
} from '../../config/constants';

/**
 * AGENTS.md §7 — Employees.
 *
 * P0 creates the full schema so later phases never need a destructive
 * migration. Service/controller/routes for this module land in P1.
 *
 * Security notes:
 *  - `bankDetails.accountNumberEnc` is stored AES-256-GCM encrypted (§11).
 *  - Bank details are masked in responses except for HR Admin / self (§7).
 *  - Date-only fields are `YYYY-MM-DD` strings; timestamps are UTC (§11).
 */

export interface AddressDoc {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface EmergencyContactDoc {
  name?: string;
  relation?: string;
  phone?: string;
}

export interface CompensationDoc {
  amount?: number;
  currency?: string;
  period?: 'monthly' | 'hourly' | 'fixed';
}

export interface BankDetailsDoc {
  accountHolder?: string;
  /** AES-256-GCM ciphertext, never a plaintext account number. */
  accountNumberEnc?: string;
  ifscOrRouting?: string;
  bankName?: string;
}

export interface StatusHistoryDoc {
  status: EmployeeStatus;
  changedAt: Date;
  changedBy: Types.ObjectId | null;
  note?: string;
}

export interface EmploymentHistoryDoc {
  employmentType: EmploymentType;
  designation?: string;
  departmentId: Types.ObjectId | null;
  from: Date;
  to?: Date | null;
  note?: string;
}

export interface EmployeeDoc {
  employeeCode: string;
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
  email: string;
  phone?: string | null;
  dob?: string | null;
  address?: AddressDoc;
  emergencyContact?: EmergencyContactDoc;
  designation?: string | null;
  departmentId: Types.ObjectId | null;
  reportingManagerId: Types.ObjectId | null;
  employmentType: EmploymentType;
  dateOfJoining: string;
  probationEndDate?: string | null;
  compensation?: CompensationDoc;
  bankDetails?: BankDetailsDoc;
  status: EmployeeStatus;
  statusHistory: Types.DocumentArray<StatusHistoryDoc>;
  employmentHistory: Types.DocumentArray<EmploymentHistoryDoc>;
  lastWorkingDay?: string | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  /**
   * Per-employee serialization counter for leave mutations. Concurrent leave
   * applications touch this document first inside their transaction, so all
   * but one abort with a write conflict and retry — at which point the
   * overlap check observes the winner. Never read for business meaning.
   */
  leaveOpSeq: number;
}

const addressSchema = new Schema<AddressDoc>(
  {
    line1: { type: String, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, maxlength: 120 },
    state: { type: String, trim: true, maxlength: 120 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    country: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false },
);

const emergencyContactSchema = new Schema<EmergencyContactDoc>(
  {
    name: { type: String, trim: true, maxlength: 120 },
    relation: { type: String, trim: true, maxlength: 60 },
    phone: { type: String, trim: true, maxlength: 32 },
  },
  { _id: false },
);

const compensationSchema = new Schema<CompensationDoc>(
  {
    amount: { type: Number, min: 0 },
    currency: { type: String, trim: true, uppercase: true, maxlength: 8 },
    period: { type: String, enum: ['monthly', 'hourly', 'fixed'] },
  },
  { _id: false },
);

const bankDetailsSchema = new Schema<BankDetailsDoc>(
  {
    accountHolder: { type: String, trim: true, maxlength: 120 },
    accountNumberEnc: { type: String },
    ifscOrRouting: { type: String, trim: true, maxlength: 64 },
    bankName: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false },
);

const statusHistorySchema = new Schema<StatusHistoryDoc>(
  {
    status: { type: String, enum: EMPLOYEE_STATUSES, required: true },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const employmentHistorySchema = new Schema<EmploymentHistoryDoc>(
  {
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, required: true },
    designation: { type: String, trim: true, maxlength: 120 },
    departmentId: { type: Types.ObjectId, ref: 'Department', default: null },
    from: { type: Date, default: Date.now },
    to: { type: Date, default: null },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

export const employeeSchema = new Schema<EmployeeDoc>(
  {
    employeeCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^HRV-\d{4,}$/, 'employeeCode must look like HRV-0001'],
    },
    firstName: { type: String, required: [true, 'First name is required'], trim: true, maxlength: 80 },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true, maxlength: 80 },
    photoUrl: { type: String, trim: true, default: null },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 200,
    },
    phone: { type: String, trim: true, maxlength: 32, default: null },
    dob: { type: String, default: null },
    address: { type: addressSchema, default: () => ({}) },
    emergencyContact: { type: emergencyContactSchema, default: () => ({}) },
    designation: { type: String, trim: true, maxlength: 120, default: null },
    departmentId: { type: Types.ObjectId, ref: 'Department', default: null },
    reportingManagerId: { type: Types.ObjectId, ref: 'Employee', default: null },
    employmentType: {
      type: String,
      enum: EMPLOYMENT_TYPES,
      required: [true, 'Employment type is required'],
    },
    dateOfJoining: { type: String, required: [true, 'Date of joining is required'] },
    probationEndDate: { type: String, default: null },
    compensation: { type: compensationSchema, default: () => ({}) },
    bankDetails: { type: bankDetailsSchema, default: () => ({}) },
    status: {
      type: String,
      enum: EMPLOYEE_STATUSES,
      required: true,
      default: 'Probation',
    },
    statusHistory: { type: [statusHistorySchema], default: () => [] },
    employmentHistory: { type: [employmentHistorySchema], default: () => [] },
    lastWorkingDay: { type: String, default: null },
    createdBy: { type: Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
    leaveOpSeq: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'employees',
    versionKey: false,
  },
);

// Filter/sort indexes required by §8.2 list endpoints.
employeeSchema.index({ departmentId: 1, status: 1 });
employeeSchema.index({ reportingManagerId: 1 });
employeeSchema.index({ status: 1, isDeleted: 1 });
employeeSchema.index({ employmentType: 1, isDeleted: 1 });
employeeSchema.index({ dateOfJoining: -1 });
// Directory search fallback: name / email / employeeCode / phone (§8.2).
employeeSchema.index({ lastName: 1, firstName: 1 });
employeeSchema.index({ phone: 1 });