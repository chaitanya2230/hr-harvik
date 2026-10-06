import { Schema, type Types } from 'mongoose';
import type { LicenseAssignmentStatus, LicenseStatus } from '../../config/constants';

/**
 * AGENTS.md §7 — Licenses + License assignments.
 *
 * Field notes:
 *  - `licenseType` / `billingCycle` / `provider` are open strings (D-28).
 *  - `licenseKeyRef` holds the AES-256-GCM ciphertext (§11), never plaintext.
 *    It is never returned in list/detail responses (§7, §8.9); the only path
 *    that decrypts it is the HR-Admin reveal endpoint.
 *  - `availableSeats` is derived (`maxSeats - usedSeats`), never stored (§7).
 *  - `status` lifecycle (D-30): Available ↔ Assigned (seat-driven),
 *    Expired / Suspended / Revoked via explicit operations.
 *  - Assignment timestamps are UTC Dates; date-only strings are YYYY-MM-DD.
 */

export interface LicenseDoc {
  licenseCode: string;
  softwareName: string;
  licenseType: string;
  /** AES-256-GCM ciphertext of the license key, or null when keyless (Free). */
  licenseKeyRef?: string | null;
  provider?: string | null;
  cost?: number | null;
  currency?: string | null;
  billingCycle?: string | null;
  startDate?: string | null;
  renewalDate?: string | null;
  maxSeats: number;
  usedSeats: number;
  status: LicenseStatus;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
}

export interface LicenseAssignmentDoc {
  licenseId: Types.ObjectId;
  employeeId: Types.ObjectId;
  assignedAt: Date;
  accountIdentifier?: string | null;
  status: LicenseAssignmentStatus;
  revokedAt?: Date | null;
  revokedBy: Types.ObjectId | null;
  revocationNote?: string | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
}

const licenseAssignmentSchema = new Schema<LicenseAssignmentDoc>(
  {
    licenseId: { type: Schema.Types.ObjectId, ref: 'License', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    assignedAt: { type: Date, default: Date.now },
    accountIdentifier: { type: String, trim: true, maxlength: 200, default: null },
    status: { type: String, enum: ['Assigned', 'Revoked'], required: true, default: 'Assigned' },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    revocationNote: { type: String, trim: true, maxlength: 500, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'licenseAssignments',
    versionKey: false,
  },
);

// §8.9 — at most one *active* assignment per employee + license. The partial
// index makes "duplicate assignment → 409" a database guarantee, not just a
// service check, so concurrent duplicates cannot both commit.
licenseAssignmentSchema.index(
  { licenseId: 1, employeeId: 1 },
  { unique: true, partialFilterExpression: { status: 'Assigned' } },
);
licenseAssignmentSchema.index({ employeeId: 1, status: 1 });
licenseAssignmentSchema.index({ licenseId: 1, status: 1 });

export const licenseSchema = new Schema<LicenseDoc>(
  {
    licenseCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^LIC-\d{4,}$/, 'licenseCode must look like LIC-0001'],
    },
    softwareName: {
      type: String,
      required: [true, 'Software name is required'],
      trim: true,
      maxlength: 120,
    },
    licenseType: {
      type: String,
      required: [true, 'License type is required'],
      trim: true,
      maxlength: 60,
    },
    licenseKeyRef: { type: String, default: null, select: false },
    provider: { type: String, trim: true, maxlength: 120, default: null },
    cost: { type: Number, min: 0, default: null },
    currency: { type: String, trim: true, uppercase: true, maxlength: 8, default: null },
    billingCycle: { type: String, trim: true, maxlength: 40, default: null },
    startDate: { type: String, default: null },
    renewalDate: { type: String, default: null },
    maxSeats: { type: Number, required: [true, 'Maximum seats is required'], min: 1 },
    usedSeats: { type: Number, required: true, default: 0, min: 0 },
    status: {
      type: String,
      required: true,
      default: 'Available',
      enum: ['Available', 'Assigned', 'Expired', 'Suspended', 'Revoked'],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'licenses',
    versionKey: false,
  },
);

licenseSchema.index({ status: 1, isDeleted: 1 });
licenseSchema.index({ licenseType: 1, isDeleted: 1 });
licenseSchema.index({ renewalDate: 1 });
licenseSchema.index({ softwareName: 1 });

export { licenseAssignmentSchema };
