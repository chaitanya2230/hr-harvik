import { model, models, type Model } from 'mongoose';
import { counterSchema, type CounterDoc } from './counter.schema';

// Reuse the compiled model when a dev server reloads this module.
export const Counter: Model<CounterDoc> =
  (models.Counter as Model<CounterDoc> | undefined) ??
  model<CounterDoc>('Counter', counterSchema);