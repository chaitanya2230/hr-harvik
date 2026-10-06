import { Schema, type Types } from 'mongoose';
import type { AssetStatus } from '../../config/constants';

/**
 * AGENTS.md §7 — Assets + Asset assignments.
 *
 * P2 creates the full schema so later phases (P3 exit linkage, P7 reports)
 * never need a destructive migration.
 *
 * Field notes:
 *  - `type` / `condition` are open strings, never enums (D-28): new asset types
 *    must work without code changes, and §8.8 specifies no type-management
 *    endpoint.
 *  - `status` is a closed enum (D-29): Available → Assigned → Returned →
 *    Available (via repair), Under Repair / Lost / Damaged via repair,
 *    Retired terminal.
 *  - `currentAssignmentId` is maintained inside the assign/return transactions;
 *    nothing else writes it.
 *  - Date-only fields are `YYYY-MM-DD` strings; timestamps are UTC (§11).
 */

export interface AssetAssignmentDoc {
  assetId: Types.ObjectId;
  employeeId: Types.ObjectId;
  assignedAt: Date;
  expectedReturnDate?: string | null;
  actualReturnDate?: string | null;
  conditionAtAssign?: string | null;
  conditionAtReturn?: string | null;
  assignedBy: Types.ObjectId | null;
  returnedTo: Types.ObjectId | null;
  notes?: string | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
}

export interface AssetDoc {
  assetCode: string;
  name: string;
  type: string;
  brand?: string | null;
  model?: string | null;
  serialNumber: string;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  condition?: string | null;
  status: AssetStatus;
  currentAssignmentId: Types.ObjectId | null;
  notes?: string | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
}

const assignmentSchema = new Schema<AssetAssignmentDoc>(
  {
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    assignedAt: { type: Date, default: Date.now },
    expectedReturnDate: { type: String, default: null },
    actualReturnDate: { type: String, default: null },
    conditionAtAssign: { type: String, trim: true, maxlength: 60, default: null },
    conditionAtReturn: { type: String, trim: true, maxlength: 60, default: null },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    returnedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, trim: true, maxlength: 500, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'assetAssignments',
    versionKey: false,
  },
);

// §7 — "Only one active assignment per asset." An assignment is active while it
// has no actual return date; the partial index enforces single-activity at the
// database level, behind the transactional status flip in the service.
assignmentSchema.index(
  { assetId: 1 },
  { unique: true, partialFilterExpression: { actualReturnDate: null } },
);
assignmentSchema.index({ employeeId: 1, actualReturnDate: 1 });
assignmentSchema.index({ expectedReturnDate: 1, actualReturnDate: 1 });

export const assetSchema = new Schema<AssetDoc>(
  {
    assetCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^AST-\d{4,}$/, 'assetCode must look like AST-0001'],
    },
    name: { type: String, required: [true, 'Asset name is required'], trim: true, maxlength: 120 },
    type: { type: String, required: [true, 'Asset type is required'], trim: true, maxlength: 60 },
    brand: { type: String, trim: true, maxlength: 120, default: null },
    model: { type: String, trim: true, maxlength: 120, default: null },
    serialNumber: {
      type: String,
      required: [true, 'Serial number is required'],
      unique: true,
      trim: true,
      maxlength: 120,
    },
    purchaseDate: { type: String, default: null },
    purchaseCost: { type: Number, min: 0, default: null },
    condition: { type: String, trim: true, maxlength: 60, default: null },
    status: {
      type: String,
      required: true,
      default: 'Available',
      // Closed lifecycle enum (D-28, D-29). Canonical §7 values.
      enum: ['Available', 'Assigned', 'Under Repair', 'Lost', 'Damaged', 'Returned', 'Retired'],
    },
    currentAssignmentId: { type: Schema.Types.ObjectId, ref: 'AssetAssignment', default: null },
    notes: { type: String, trim: true, maxlength: 500, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'assets',
    versionKey: false,
  },
);

// Filter/sort indexes required by §8.8 list endpoints + §11 indexed fields.
assetSchema.index({ status: 1, isDeleted: 1 });
assetSchema.index({ type: 1, isDeleted: 1 });
assetSchema.index({ name: 1 });

export { assignmentSchema as assetAssignmentSchema };
