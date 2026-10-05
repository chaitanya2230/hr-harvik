import { Schema, Types } from 'mongoose';

/**
 * AGENTS.md §6 — audit every create / update / delete / status change.
 * Shape: { actorId, action, entityType, entityId, before, after, at, ip }
 */
export interface AuditDoc {
  actorId: Types.ObjectId | null;
  action: string;
  entityType: string;
  entityId: Types.ObjectId | null;
  before: unknown;
  after: unknown;
  at: Date;
  ip: string | null;
  requestId?: string | null;
}

export const auditSchema = new Schema<AuditDoc>(
  {
    actorId: { type: Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true, trim: true, maxlength: 80 },
    entityType: { type: String, required: true, trim: true, maxlength: 80 },
    entityId: { type: Types.ObjectId, default: null },
    // Mixed: shape varies per entity. Secrets are stripped before writing.
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    at: { type: Date, default: Date.now },
    ip: { type: String, default: null },
    requestId: { type: String, default: null },
  },
  {
    // Audit rows are immutable; createdAt mirrors `at`.
    timestamps: { createdAt: false, updatedAt: false },
    collection: 'auditlogs',
    versionKey: false,
  },
);

auditSchema.index({ entityType: 1, entityId: 1, at: -1 });
auditSchema.index({ actorId: 1, at: -1 });
auditSchema.index({ at: -1 });