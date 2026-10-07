import { model, models, type Model } from 'mongoose';
import { jobSchema, type JobDoc } from './job.schema';

export const Job: Model<JobDoc> =
  (models.Job as Model<JobDoc> | undefined) ?? model<JobDoc>('Job', jobSchema);
