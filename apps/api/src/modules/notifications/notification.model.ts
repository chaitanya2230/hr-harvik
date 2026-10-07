import { model, models, type Model } from 'mongoose';
import { notificationSchema, type INotification } from './notification.schema';

export const Notification: Model<INotification> =
  (models.Notification as Model<INotification> | undefined) ??
  model<INotification>('Notification', notificationSchema);
