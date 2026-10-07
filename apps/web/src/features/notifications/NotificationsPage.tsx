import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../../components/ui';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from './api';

/**
 * AGENTS.md §8.12 + §9 — notification inbox. Read/unread filtering,
 * per-item mark-read and mark-all-read, all backed by the scoped API.
 *
 * The filter is seeded from the URL (`?read=false` / `?read=true`) so deep
 * links such as the dashboard "Pending HR actions" card land on the right
 * filtered list.
 */
export function NotificationsPage() {
  const notify = useToast();
  const [searchParams] = useSearchParams();
  const initialRead = searchParams.get('read');
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>(
    initialRead === 'false' ? 'unread' : initialRead === 'true' ? 'read' : 'all',
  );
  const [page, setPage] = useState(1);

  const listQuery = useNotifications({
    ...(filter === 'all' ? {} : { read: filter === 'read' }),
    page,
  });
  const markReadMutation = useMarkNotificationRead();
  const markAllMutation = useMarkAllNotificationsRead();

  const items = listQuery.data?.data ?? [];
  const totalPages = listQuery.data?.meta.totalPages ?? 1;

  const handleMarkRead = async (id: string, read: boolean): Promise<void> => {
    try {
      await markReadMutation.mutateAsync({ id, read });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to update notification');
    }
  };

  const handleMarkAll = async (): Promise<void> => {
    try {
      await markAllMutation.mutateAsync();
      notify('success', 'All notifications marked as read');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to mark all as read');
    }
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Reminders, approvals and updates for you"
        actions={
          <button
            type="button"
            disabled={markAllMutation.isPending}
            onClick={() => void handleMarkAll()}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Mark all as read
          </button>
        }
      />

      <div role="tablist" aria-label="Notification filters" className="mb-4 flex gap-1 border-b border-slate-200">
        {(['all', 'unread', 'read'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => {
              setFilter(value);
              setPage(1);
            }}
            className={`rounded-t-md px-4 py-2 text-sm font-medium capitalize ${
              filter === value
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {value === 'unread'
              ? `Unread${listQuery.data ? ` (${listQuery.data.meta.unreadCount})` : ''}`
              : value}
          </button>
        ))}
      </div>

      {listQuery.isPending ? (
        <LoadingState label="Loading notifications…" />
      ) : listQuery.isError ? (
        <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No notifications" hint="New reminders and updates will appear here." />
      ) : (
        <>
          <Card title="">
            <ul className="divide-y divide-slate-100">
              {items.map((item) => {
                const unread = item.readAt === null;
                return (
                  <li key={item._id} className={`flex items-start justify-between gap-3 py-3 ${unread ? '' : 'opacity-70'}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {unread ? (
                          <span aria-label="unread" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand-600" />
                        ) : null}
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">{item.body}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {new Date(item.createdAt).toLocaleString()}
                        {item.link ? ` · ${item.link}` : ''}
                      </p>
                    </div>
                    {unread ? (
                      <button
                        type="button"
                        disabled={markReadMutation.isPending}
                        onClick={() => void handleMarkRead(item._id, true)}
                        className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        Mark read
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>

          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
            <p className="text-slate-500">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
