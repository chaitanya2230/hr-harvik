import { model, models, type Model } from 'mongoose';
import { documentSchema, type DocumentDoc } from './document.schema';

export const Document: Model<DocumentDoc> =
  (models.Document as Model<DocumentDoc> | undefined) ??
  model<DocumentDoc>('Document', documentSchema);

