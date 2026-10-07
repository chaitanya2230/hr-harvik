import { Schema, type Types } from 'mongoose';
import { NOTIFICATION_TYPES, type NotificationType } from '../../config/constants';

/**
 * AGENTS.md §7 — Notification document interface.
 */
export interface INotification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  readAt: Date | null;
  dueAt?: Date | null;
  dedupeKey?: string | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    link: {
      type: String,
      trim: true,
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
    },
    dueAt: {
      type: Date,
      default: null,
    },
    dedupeKey: {
      type: String,
      trim: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for querying user notifications, unread status, and reverse chronological order.
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
// Sparse unique index to strictly guarantee deduplication across scheduled jobs (AGENTS.md §7 & §8.12).
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
notificationSchema.index({ userId: 1, isDeleted: 1 });
