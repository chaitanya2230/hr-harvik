import { Types } from 'mongoose';
import { Queue } from 'bullmq';
import { Notification } from './notification.model';
import { type INotification } from './notification.schema';
import { type NotificationType, DEFAULT_PAGE_LIMIT } from '../../config/constants';
import { type ListNotificationsQuery } from './notification.validation';
import { User } from '../users/user.model';
import { sendEmail } from './email.service';
import { notFound, forbidden } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { getRedis } from '../../db/redis';
import { QUEUE_NAMES } from '../../jobs/queues';

export interface CreateNotificationInput {
  userId: string | Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  dueAt?: Date | null;
  dedupeKey?: string | null;
  sendEmailAlert?: boolean;
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<INotification | null> {
  const userId = typeof input.userId === 'string' ? new Types.ObjectId(input.userId) : input.userId;

  // Deduplication check (AGENTS.md §7 & §8.12). A dedupe hit returns null
  // (not the existing row) so callers counting creations — e.g. the reminder
  // runner totals — cannot mistake a skip for new work.
  if (input.dedupeKey) {
    const existing = await Notification.findOne({ dedupeKey: input.dedupeKey }).exec();
    if (existing) {
      logger.debug({ dedupeKey: input.dedupeKey }, 'Notification deduplicated; skipped creation');
      return null;
    }
  }

  try {
    const notification = await Notification.create({
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      dueAt: input.dueAt ?? null,
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      readAt: null,
      isDeleted: false,
    });

    // AGENTS.md §3/§8.12 — email delivery runs through the BullMQ
    // `notifications` queue so SMTP failures are retried by the worker. When
    // Redis is unavailable (local dev without docker) we degrade to inline
    // delivery so mail is never silently dropped.
    if (input.sendEmailAlert) {
      const user = await User.findById(userId).select('email').lean().exec();
      if (user?.email) {
        try {
          await enqueueNotificationEmail(String(notification._id));
        } catch (error: unknown) {
          logger.warn(
            { error, notificationId: String(notification._id) },
            'Notification queue unavailable; sending email inline',
          );
          void sendEmail({
            to: user.email,
            subject: input.title,
            text: `${input.body}\n\n${input.link ? `Link: ${input.link}` : ''}`,
            html: `<p>${input.body}</p>${input.link ? `<p><a href="${input.link}">View in HR Portal</a></p>` : ''}`,
          });
        }
      }
    }

    return notification;
  } catch (error: unknown) {
    // If dedupeKey race resulted in MongoDB E11000 duplicate key error, treat
    // as a dedupe hit (null) rather than failing the scheduler run.
    if (error && typeof error === 'object' && 'code' in error && (error as { code: number }).code === 11000) {
      logger.debug({ dedupeKey: input.dedupeKey }, 'Notification duplicate key caught; safe recovery');
      return null;
    }
    throw error;
  }
}

/**
 * AGENTS.md §3/§8.12 — producer for the `notifications` queue. The BullMQ
 * worker owns the actual SMTP call, so failures retry with backoff instead of
 * being fire-and-forget inside an HTTP request.
 */
export async function enqueueNotificationEmail(notificationId: string): Promise<void> {
  const redis = getRedis();
  if (redis.status !== 'ready' && redis.status !== 'connect' && redis.status !== 'connecting') {
    throw new Error(`Redis not ready (status: ${redis.status})`);
  }
  const queue = new Queue(QUEUE_NAMES.notifications, { connection: redis });
  try {
    await queue.add(
      'deliver-email',
      { notificationId },
      {
        jobId: `notify-email-${notificationId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  } finally {
    await queue.close();
  }
}

/**
 * Worker-side email delivery for one in-app notification. Throws on failure
 * so BullMQ records a failed attempt and retries (AGENTS.md §14 NOT —
 * "retries with BullMQ").
 */
export async function deliverNotificationEmail(
  notificationId: string,
): Promise<{ sent: boolean; skipped?: boolean }> {
  if (!Types.ObjectId.isValid(notificationId)) {
    return { sent: false, skipped: true };
  }
  const notification = await Notification.findById(notificationId).lean().exec();
  if (!notification || notification.isDeleted) {
    return { sent: false, skipped: true };
  }
  const user = await User.findById(notification.userId).select('email').lean().exec();
  if (!user?.email) {
    return { sent: false, skipped: true };
  }

  const sent = await sendEmail({
    to: user.email,
    subject: notification.title,
    text: `${notification.body}\n\n${notification.link ? `Link: ${notification.link}` : ''}`,
    html: `<p>${notification.body}</p>${notification.link ? `<p><a href="${notification.link}">View in HR Portal</a></p>` : ''}`,
  });
  if (!sent) {
    // Bubble up so BullMQ retries with the configured backoff.
    throw new Error(`Email delivery failed for notification ${notificationId}`);
  }
  return { sent: true };
}

export async function listUserNotifications(
  userId: string | Types.ObjectId,
  query: ListNotificationsQuery,
): Promise<{
  data: INotification[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  unreadCount: number;
}> {
  const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
  const page = query.page && query.page > 0 ? query.page : 1;
  const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : DEFAULT_PAGE_LIMIT;
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    userId: userObjectId,
    isDeleted: false,
  };

  if (query.read === true) {
    filter.readAt = { $ne: null };
  } else if (query.read === false) {
    filter.readAt = null;
  }

  if (query.type) {
    filter.type = query.type;
  }

  const [data, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
    Notification.countDocuments(filter).exec(),
    Notification.countDocuments({ userId: userObjectId, readAt: null, isDeleted: false }).exec(),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
    unreadCount,
  };
}

export async function getUnreadCount(userId: string | Types.ObjectId): Promise<number> {
  const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
  return await Notification.countDocuments({ userId: userObjectId, readAt: null, isDeleted: false }).exec();
}

export async function markNotificationAsRead(
  notificationId: string,
  userId: string | Types.ObjectId,
  read = true,
): Promise<INotification> {
  if (!Types.ObjectId.isValid(notificationId)) {
    throw notFound('Notification not found');
  }

  const notification = await Notification.findOne({
    _id: new Types.ObjectId(notificationId),
    isDeleted: false,
  }).exec();

  if (!notification) {
    throw notFound('Notification not found');
  }

  const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
  if (!notification.userId.equals(userObjectId)) {
    // AGENTS.md §14: "user cannot read another user's notification"
    throw forbidden('You cannot access or modify notifications belonging to another user');
  }

  notification.readAt = read ? new Date() : null;
  await notification.save();
  return notification;
}

export async function markAllNotificationsAsRead(
  userId: string | Types.ObjectId,
): Promise<{ modifiedCount: number }> {
  const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
  const result = await Notification.updateMany(
    { userId: userObjectId, readAt: null, isDeleted: false },
    { $set: { readAt: new Date() } },
  ).exec();

  return { modifiedCount: result.modifiedCount };
}
