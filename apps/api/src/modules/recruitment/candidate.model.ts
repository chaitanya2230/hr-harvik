import { model, models, type Model } from 'mongoose';
import { candidateSchema, type CandidateDoc } from './candidate.schema';

export const Candidate: Model<CandidateDoc> =
  (models.Candidate as Model<CandidateDoc> | undefined) ??
  model<CandidateDoc>('Candidate', candidateSchema);
