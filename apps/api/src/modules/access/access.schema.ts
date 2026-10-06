import { Schema, type Types } from 'mongoose';
import type { AccessStatus } from '../../config/constants';

/**
 * AGENTS.md §7 — Access Items: external accounts beyond licenses
 * (GitHub org, Google Workspace, Slack, VPN, AWS).
 *
 * §2 rule 11: v1 tracks required actions and completion status only — nothing
 * here calls an external API. Revocation is an explicit manual record, and
 * nothing cascades automatically (D-31).
 */

export interface AccessItemDoc {
  employeeId: Types.ObjectId;
  system: string;
  identifier?: string | null;
  status: AccessStatus;
  revokedAt?: Date | null;
  revokedBy: Types.ObjectId | null;
  linkedLicenseAssignmentId: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
}

export const accessItemSchema = new Schema<AccessItemDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    system: {
      type: String,
      required: [true, 'System name is required'],
      trim: true,
      maxlength: 120,
    },
    identifier: { type: String, trim: true, maxlength: 200, default: null },
    status: { type: String, enum: ['Active', 'Revoked'], required: true, default: 'Active' },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    linkedLicenseAssignmentId: { type: Schema.Types.ObjectId, ref: 'LicenseAssignment', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'accessItems',
    versionKey: false,
  },
);

accessItemSchema.index({ employeeId: 1, status: 1 });
accessItemSchema.index({ system: 1, isDeleted: 1 });
accessItemSchema.index({ status: 1, isDeleted: 1 });
