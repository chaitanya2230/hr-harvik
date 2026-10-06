import { model, models, type Model } from 'mongoose';
import { documentTemplateSchema, type DocumentTemplateDoc } from './template.schema';

export const DocumentTemplate: Model<DocumentTemplateDoc> =
  (models.DocumentTemplate as Model<DocumentTemplateDoc> | undefined) ??
  model<DocumentTemplateDoc>('DocumentTemplate', documentTemplateSchema);

