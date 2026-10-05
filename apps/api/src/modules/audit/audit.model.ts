import { model, models, type Model } from 'mongoose';
import { auditSchema, type AuditDoc } from './audit.schema';

export const AuditLog: Model<AuditDoc> =
  (models.AuditLog as Model<AuditDoc> | undefined) ??
  model<AuditDoc>('AuditLog', auditSchema);