import { model, models, type Model } from 'mongoose';
import { accessItemSchema, type AccessItemDoc } from './access.schema';

export const AccessItem: Model<AccessItemDoc> =
  (models.AccessItem as Model<AccessItemDoc> | undefined) ??
  model<AccessItemDoc>('AccessItem', accessItemSchema);
