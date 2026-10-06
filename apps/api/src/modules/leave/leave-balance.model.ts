import { model, models, type Model } from 'mongoose';
import { leaveBalanceSchema, type LeaveBalanceDoc } from './leave-balance.schema';

export const LeaveBalance: Model<LeaveBalanceDoc> =
  (models.LeaveBalance as Model<LeaveBalanceDoc> | undefined) ??
  model<LeaveBalanceDoc>('LeaveBalance', leaveBalanceSchema);
