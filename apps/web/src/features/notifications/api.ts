import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';

/**
 * AGENTS.md §8.12 — notification inbox data access. All scoping is server-side
 * (users only ever see their own notifications); the bell only displays.
 */

export interface NotificationRecord {
  _id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  readAt: string | null;
  dueAt?: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  data: NotificationRecord[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    unreadCount: number;
  };
}

export function useNotifications(
  params: { read?: boolean; page?: number } = {},
  enabled = true,
) {
  const search = new URLSearchParams();
  if (params.read !== undefined) search.set('read', String(params.read));
  if (params.page) search.set('page', String(params.page));
  const query = search.toString();

  return useQuery({
    queryKey: ['notifications', params.read ?? 'all', params.page ?? 1],
    queryFn: () =>
      apiRequest<NotificationListResponse>(`/notifications${query ? `?${query}` : ''}`),
    enabled,
  });
}

export function useUnreadCount(poll = false) {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () =>
      apiRequest<{ data: { unreadCount: number } }>('/notifications/unread-count').then(
        (r) => r.data.unreadCount,
      ),
    refetchInterval: poll ? 60_000 : false,
  });
}

function useInvalidateNotifications() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      apiRequest<{ data: NotificationRecord }>(`/notifications/${id}/read`, {
        method: 'PATCH',
        body: { read },
      }),
    onSuccess: () => invalidate(),
  });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ data: { modifiedCount: number } }>('/notifications/mark-all-read', {
        method: 'POST',
      }),
    onSuccess: () => invalidate(),
  });
}
