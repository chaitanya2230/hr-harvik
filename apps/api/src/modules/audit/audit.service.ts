import { Types } from 'mongoose';
import type { Request } from 'express';
import { AuditLog } from './audit.model';
import { redactSensitive } from '../../utils/sanitize';
import { logger } from '../../utils/logger';

export interface AuditInput {
  actorId?: Types.ObjectId | string | null;
  action: string;
  entityType: string;
  entityId?: Types.ObjectId | string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requestId?: string | null;
}

/** Normalise an id-ish value to an ObjectId, or null when absent/invalid. */
export function toObjectIdOrNull(value: Types.ObjectId | string | null | undefined): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

/** IP + correlation id for the current request. */
export function requestMeta(req: Request): { ip: string | null; requestId: string | null } {
  return {
    ip: req.ip ?? null,
    requestId: req.requestId ?? null,
  };
}

/**
 * AGENTS.md §6 — audit every create / update / delete / status change.
 *
 * `before` / `after` are passed through `redactSensitive`, so credentials,
 * bank details and license keys can never be persisted into the audit trail.
 *
 * Audit failures are logged but never thrown: an unavailable audit sink must
 * not roll back or fail an otherwise successful business operation. This is a
 * deliberate availability-vs-auditability trade-off recorded in
 * docs/DECISIONS.md.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      actorId: toObjectIdOrNull(input.actorId),
      action: input.action,
      entityType: input.entityType,
      entityId: toObjectIdOrNull(input.entityId),
      before: redactSensitive(input.before ?? null),
      after: redactSensitive(input.after ?? null),
      at: new Date(),
      ip: input.ip ?? null,
      requestId: input.requestId ?? null,
    });
  } catch (error) {
    logger.error(
      { err: (error as Error).message, action: input.action, entityType: input.entityType },
      'Failed to write audit log entry',
    );
  }
}

/** Convenience wrapper that pulls ip/requestId off the request. */
export async function recordAuditFromRequest(
  req: Request,
  input: Omit<AuditInput, 'ip' | 'requestId'>,
): Promise<void> {
  await recordAudit({ ...input, ...requestMeta(req) });
}