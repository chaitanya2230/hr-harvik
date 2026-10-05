import { model, models, type Model } from 'mongoose';
import { userSchema, type UserDoc } from './user.schema';

export const User: Model<UserDoc> =
  (models.User as Model<UserDoc> | undefined) ?? model<UserDoc>('User', userSchema);