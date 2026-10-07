import { Schema, Types } from 'mongoose';

/**
 * AGENTS.md §6 — HR Admin manages "system settings".
 * AGENTS.md §11 — "company timezone comes from settings".
 * AGENTS.md §8.2 — minimum ages are configurable ("Intern age >= 16. Others
 * age >= 18 unless configurable") and the default Full-Time Probation status
 * is configurable ("Default Full-Time status is Probation when probation
 * configured").
 *
 * The singleton row (key = "system") stores the runtime values; when it does
 * not exist yet the service falls back to the `.env` defaults, so an
 * un-seeded database behaves exactly like the pre-settings build.
 */
export interface SystemSettingsDoc {
  key: string;
  companyName: string;
  /** IANA timezone used for every date-only "today" computation. */
  timezone: string;
  /** §8.2 minimum age for Intern employees. */
  minAgeIntern: number;
  /** §8.2 minimum age for every other employment type. */
  minAgeOther: number;
  /** §8.2 — Full-Time employees start on Probation when true, else Active. */
  probationDefault: boolean;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const systemSettingsSchema = new Schema<SystemSettingsDoc>(
  {
    key: { type: String, required: true, unique: true, default: 'system' },
    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    timezone: { type: String, required: true, trim: true, maxlength: 64 },
    minAgeIntern: { type: Number, required: true, min: 10, max: 60 },
    minAgeOther: { type: Number, required: true, min: 10, max: 60 },
    probationDefault: { type: Boolean, required: true, default: true },
    createdBy: { type: Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'settings',
    versionKey: false,
  },
);
