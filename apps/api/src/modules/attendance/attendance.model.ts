import { model, models, type Model } from 'mongoose';
import { attendanceSchema, type AttendanceDoc } from './attendance.schema';

export const Attendance: Model<AttendanceDoc> =
  (models.Attendance as Model<AttendanceDoc> | undefined) ??
  model<AttendanceDoc>('Attendance', attendanceSchema);
