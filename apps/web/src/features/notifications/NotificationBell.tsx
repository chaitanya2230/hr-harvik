import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
  type NotificationRecord,
} from './api';

/** How many recent items the preview panel shows (AGENTS.md §8.12). */
const PREVIEW_COUNT = 8;

/** Short relative time such as "2 hours ago"; falls back to an empty string. */
function shortRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * AGENTS.md §8.12 + §9 — in-app notification bell. The badge shows the
 * server-side unread count; the dropdown previews the latest items, marks
 * them read on activation and follows their deep link (or the inbox).
 * Fully keyboard operable: labelled button, aria-expanded, Escape closes and
 * restores focus, and an overlay closes the panel on outside clicks.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const bellRef = useRef<HTMLButtonElement>(null);
  const unreadQuery = useUnreadCount(true);
  const unread = unreadQuery.data ?? 0;

  // The preview list is only fetched while the panel is open.
  const listQuery = useNotifications({ page: 1 }, open);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const items = (listQuery.data?.data ?? []).slice(0, PREVIEW_COUNT);

  const handleSelect = (item: NotificationRecord): void => {
    if (item.readAt === null) markRead.mutate({ id: item._id, read: true });
    setOpen(false);
    // Deep links are internal routes; anything else lands on the inbox.
    navigate(item.link && item.link.startsWith('/') ? item.link : '/notifications');
  };

  return (
    <div className="relative">
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative z-30 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
      >
        <span aria-hidden>🔔</span>
        <span className="sr-only">Notifications</span>
        {unread > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default bg-transparent"
          />
          <div
            role="dialog"
            aria-label="Notification preview"
            className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <p className="text-sm font-medium text-slate-900">
                {unread === 0
                  ? 'No unread notifications'
                  : `${unread} unread notification${unread === 1 ? '' : 's'}`}
              </p>
              {unread > 0 ? (
                <button
                  type="button"
                  disabled={markAllRead.isPending}
                  onClick={() => markAllRead.mutate()}
                  className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-60"
                >
                  Mark all read
                </button>
              ) : null}
            </div>

            {listQuery.isPending ? (
              <p className="px-3 py-4 text-sm text-slate-500" role="status">
                Loading notifications…
              </p>
            ) : listQuery.isError ? (
              <div className="px-3 py-4" role="alert">
                <p className="text-sm text-red-700">Couldn’t load notifications.</p>
                <button
                  type="button"
                  onClick={() => void listQuery.refetch()}
                  className="mt-1 text-xs font-medium text-brand-700 hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">
                You’re all caught up — no notifications yet.
              </p>
            ) : (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {items.map((item) => {
                  const isUnread = item.readAt === null;
                  return (
                    <li key={item._id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(item)}
                        className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600 ${
                          isUnread ? '' : 'opacity-70'
                        }`}
                      >
                        <span className="flex items-start gap-2">
                          <span
                            aria-hidden
                            className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                              isUnread ? 'bg-brand-600' : 'bg-transparent'
                            }`}
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block truncate text-sm text-slate-900 ${
                                isUnread ? 'font-semibold' : 'font-medium'
                              }`}
                            >
                              {item.title}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">
                              {item.body}
                            </span>
                            <time
                              dateTime={item.createdAt}
                              className="mt-1 block text-xs text-slate-400"
                            >
                              {shortRelativeTime(item.createdAt)}
                            </time>
                          </span>
                          {isUnread ? (
                            <span className="sr-only">Unread</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="border-t border-slate-100 px-3 py-2 text-center">
              <Link
                to="/notifications"
                onClick={() => setOpen(false)}
                className="inline-block text-sm font-medium text-brand-700 hover:underline"
              >
                View all notifications →
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
