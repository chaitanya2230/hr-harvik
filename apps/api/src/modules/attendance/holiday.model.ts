import { model, models, type Model } from 'mongoose';
import { holidaySchema, type HolidayDoc } from './holiday.schema';

export const Holiday: Model<HolidayDoc> =
  (models.Holiday as Model<HolidayDoc> | undefined) ??
  model<HolidayDoc>('Holiday', holidaySchema);
