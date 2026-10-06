import { model, models, type Model } from 'mongoose';
import { leaveRequestSchema, type LeaveRequestDoc } from './leave-request.schema';

export const LeaveRequest: Model<LeaveRequestDoc> =
  (models.LeaveRequest as Model<LeaveRequestDoc> | undefined) ??
  model<LeaveRequestDoc>('LeaveRequest', leaveRequestSchema);
