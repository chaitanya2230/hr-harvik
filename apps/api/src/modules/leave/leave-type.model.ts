import { model, models, type Model } from 'mongoose';
import { leaveTypeSchema, type LeaveTypeDoc } from './leave-type.schema';

export const LeaveType: Model<LeaveTypeDoc> =
  (models.LeaveType as Model<LeaveTypeDoc> | undefined) ??
  model<LeaveTypeDoc>('LeaveType', leaveTypeSchema);
