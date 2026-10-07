import type { Request, Response, NextFunction } from 'express';
import {
  listUserNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from './notification.service';
import { runScheduledReminders } from './reminder.service';
import { listNotificationsQuerySchema, markNotificationReadSchema } from './notification.validation';
import { unauthorized, badRequest } from '../../utils/errors';
import { objectIdSchema } from '../employees/employee.validation';

export async function listNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user;
    if (!user) throw unauthorized('Authentication required');

    const query = listNotificationsQuerySchema.parse(req.query);
    const result = await listUserNotifications(user.userId, query);

    res.json({
      data: result.data,
      meta: {
        ...result.meta,
        unreadCount: result.unreadCount,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getNotificationUnreadCount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user;
    if (!user) throw unauthorized('Authentication required');

    const count = await getUnreadCount(user.userId);
    res.json({ data: { unreadCount: count } });
  } catch (error) {
    next(error);
  }
}

export async function updateNotificationRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user;
    if (!user) throw unauthorized('Authentication required');

    const { id } = req.params;
    if (!id) throw badRequest('Notification id is required');
    const notificationId = objectIdSchema.parse(id);
    const body = markNotificationReadSchema.parse(req.body);
    const notification = await markNotificationAsRead(notificationId, user.userId, body.read);

    res.json({ data: notification });
  } catch (error) {
    next(error);
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user;
    if (!user) throw unauthorized('Authentication required');

    const result = await markAllNotificationsAsRead(user.userId);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function triggerReminders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const referenceDate = typeof req.query.date === 'string' ? req.query.date : undefined;
    const result = await runScheduledReminders(referenceDate);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}
