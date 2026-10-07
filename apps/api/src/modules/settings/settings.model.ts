import { model, models, type Model } from 'mongoose';
import { systemSettingsSchema, type SystemSettingsDoc } from './settings.schema';

export const SystemSettings: Model<SystemSettingsDoc> =
  (models.SystemSettings as Model<SystemSettingsDoc> | undefined) ??
  model<SystemSettingsDoc>('SystemSettings', systemSettingsSchema);
