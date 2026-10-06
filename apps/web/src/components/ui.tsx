import type { ReactNode } from 'react';
import { ApiError, SessionExpiredError } from '../api/client';

/**
 * AGENTS.md §9 — every table renders loading, empty and error states.
 * Shared primitives so P1 screens stay consistent without new dependencies.
 */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-slate-500" role="status">
      <span aria-hidden className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  let message = 'Something went wrong. Please try again.';
  if (error instanceof SessionExpiredError) message = 'Your session expired. Please sign in again.';
  else if (error instanceof ApiError) message = error.message;

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center" role="alert">
      <p className="text-sm font-medium text-red-800">Request failed</p>
      <p className="mt-1 text-sm text-red-600">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      {title ? <h2 className="mb-3 text-base font-medium text-slate-900">{title}</h2> : null}
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    Active: 'bg-green-100 text-green-800',
    Probation: 'bg-amber-100 text-amber-800',
    'On Notice': 'bg-orange-100 text-orange-800',
    Resigned: 'bg-purple-100 text-purple-800',
    Relieved: 'bg-slate-200 text-slate-700',
    Inactive: 'bg-slate-100 text-slate-500',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone[status] ?? 'bg-slate-100 text-slate-600'}`}
    >
      {status}
    </span>
  );
}
