import { model, models, type Model } from 'mongoose';
import { attendanceCorrectionSchema, type AttendanceCorrectionDoc } from './correction.schema';

export const AttendanceCorrection: Model<AttendanceCorrectionDoc> =
  (models.AttendanceCorrection as Model<AttendanceCorrectionDoc> | undefined) ??
  model<AttendanceCorrectionDoc>('AttendanceCorrection', attendanceCorrectionSchema);
