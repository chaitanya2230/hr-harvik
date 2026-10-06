import { model, models, type Model } from 'mongoose';
import { exitSchema, type ExitDoc } from './exit.schema';

export const Exit: Model<ExitDoc> =
  (models.Exit as Model<ExitDoc> | undefined) ??
  model<ExitDoc>('Exit', exitSchema, 'exits');
export type { ExitDoc } from './exit.schema';
