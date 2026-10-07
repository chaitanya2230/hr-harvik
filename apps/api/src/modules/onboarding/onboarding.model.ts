import { model, models, type Model } from 'mongoose';
import { onboardingSchema, type OnboardingDoc } from './onboarding.schema';

export const Onboarding: Model<OnboardingDoc> =
  (models.Onboarding as Model<OnboardingDoc> | undefined) ??
  model<OnboardingDoc>('Onboarding', onboardingSchema);
