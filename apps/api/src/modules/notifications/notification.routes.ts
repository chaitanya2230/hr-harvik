
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRoles } from '../../middleware/rbac';
import {
  listNotifications,
  getNotificationUnreadCount,
  updateNotificationRead,
  markAllRead,
  triggerReminders,
} from './notification.controller';

export const notificationRouter = Router();

// All notification routes require authentication
notificationRouter.use(requireAuth);

notificationRouter.get('/', listNotifications);
notificationRouter.get('/unread-count', getNotificationUnreadCount);
notificationRouter.patch('/:id/read', updateNotificationRead);
notificationRouter.post('/mark-all-read', markAllRead);

// Manual reminder trigger for HR Admin or HR Manager
notificationRouter.post('/trigger-reminders', requireRoles('HR Admin', 'HR Manager'), triggerReminders);
