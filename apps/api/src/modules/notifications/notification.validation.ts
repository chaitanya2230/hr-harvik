import { z } from 'zod';
import { NOTIFICATION_TYPES, MAX_PAGE_LIMIT } from '../../config/constants';

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
  read: z
    .enum(['true', 'false', 'all'])
    .optional()
    .transform((val) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    }),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const markNotificationReadSchema = z.object({
  read: z.boolean().default(true),
});

export type MarkNotificationReadInput = z.infer<typeof markNotificationReadSchema>;
