import { Schema, Types } from 'mongoose';
import { ROLES, type Role } from '../../config/constants';

/**
 * AGENTS.md §7 — Users.
 * AGENTS.md §6 — access/refresh lifetimes, bcrypt hashing, hashed refresh token,
 * RBAC denylist on logout.
 */
export interface UserDoc {
  email: string;
  passwordHash: string;
  role: Role;
  employeeId: Types.ObjectId | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  /** SHA-256 of the current refresh token — the raw token is never stored. */
  refreshTokenHash: string | null;
  /** Epoch ms after which the refresh token is no longer accepted. */
  refreshTokenExpiresAt: Date | null;
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
}

export const userSchema = new Schema<UserDoc>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 200,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: ROLES },
    employeeId: { type: Types.ObjectId, ref: 'Employee', default: null },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    refreshTokenHash: { type: String, default: null, select: false },
    refreshTokenExpiresAt: { type: Date, default: null, select: false },
    createdBy: { type: Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'users',
    versionKey: false,
  },
);

userSchema.index({ employeeId: 1 });
userSchema.index({ role: 1, isActive: 1 });

export const USER_PASSWORD_SELECT = '+passwordHash +refreshTokenHash +refreshTokenExpiresAt' as const;