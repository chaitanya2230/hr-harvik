import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import type { DashboardSummary } from '../../api/types';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../../components/ui';

/**
 * AGENTS.md §8.1 — HR dashboard. Every number comes from
 * `GET /api/v1/dashboard/summary`; metrics the backend cannot compute yet are
 * rendered as "arrives in Pn", never as zero.
 */

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => apiRequest<{ data: DashboardSummary }>('/dashboard/summary'),
  });
}

function MetricCard({ label, value, href }: { label: string; value: number; href?: string | null }) {
  const body = (
    <>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-sm text-slate-500">{label}</p>
    </>
  );
  // §8.1 — cards lead to filtered lists. No href means no list exists yet.
  if (href && !href.startsWith('#')) {
    return (
      <Link
        to={href}
        className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
      >
        {body}
      </Link>
    );
  }
  if (href) {
    return (
      <a
        href={href}
        className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
      >
        {body}
      </a>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {body}
    </div>
  );
}

function UnavailableMetric({ label, phase }: { label: string; phase: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4" title={`Arrives in ${phase}`}>
      <p className="text-2xl font-semibold text-slate-400">—</p>
      <p className="mt-0.5 text-sm text-slate-500">{label} <span className="text-xs">({phase})</span></p>
    </div>
  );
}

export function DashboardPage() {
  const summaryQuery = useDashboardSummary();

  if (summaryQuery.isPending) return <LoadingState label="Loading dashboard…" />;
  if (summaryQuery.isError) {
    return <ErrorState error={summaryQuery.error} onRetry={() => void summaryQuery.refetch()} />;
  }

  const summary = summaryQuery.data.data;
  const metrics = summary.metrics;
  const links = summary.links ?? {};

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${summary.scope.label}${summary.cache.hit ? ' · cached' : ''}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total employees" value={metrics.totalEmployees} href={links.totalEmployees} />
        <MetricCard label="Full-time" value={metrics.fullTime} href={links.fullTime} />
        <MetricCard label="Interns" value={metrics.interns} href={links.interns} />
        <MetricCard label="Freelancers" value={metrics.freelancers} href={links.freelancers} />
        <MetricCard label="New joiners (30d)" value={metrics.newJoiners} href={links.newJoiners} />
        <MetricCard label="On notice" value={metrics.onNotice} href={links.onNotice} />
        <MetricCard label="Leaving soon (30d)" value={metrics.leavingSoon} href={links.leavingSoon} />
        {metrics.pendingHrActions.value === null ? (
          <UnavailableMetric label={metrics.pendingHrActions.label} phase={metrics.pendingHrActions.phase ?? '?'} />
        ) : (
          <MetricCard label={metrics.pendingHrActions.label} value={metrics.pendingHrActions.value} href={links.pendingHrActions} />
        )}
        {metrics.onLeave === null ? <UnavailableMetric label="On leave today" phase="P5" /> : <MetricCard label="On leave today" value={metrics.onLeave} href={links.onLeave} />}
        {metrics.pendingOnboarding === null ? <UnavailableMetric label="Pending onboarding" phase="P6" /> : <MetricCard label="Pending onboarding" value={metrics.pendingOnboarding} href={links.pendingOnboarding} />}
        {metrics.pendingDocumentGeneration === null ? <UnavailableMetric label="Pending documents" phase="P4" /> : <MetricCard label="Pending documents" value={metrics.pendingDocumentGeneration} href={links.pendingDocumentGeneration} />}
        {metrics.pendingAssetReturns === null ? <UnavailableMetric label="Pending asset returns" phase="P2" /> : <MetricCard label="Pending asset returns" value={metrics.pendingAssetReturns} href={links.pendingAssetReturns} />}
        {metrics.pendingLicenseRevocations === null ? <UnavailableMetric label="Pending licence revocations" phase="P2" /> : <MetricCard label="Pending licence revocations" value={metrics.pendingLicenseRevocations} href={links.pendingLicenseRevocations} />}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Recently joined">
          <span id="recently-joined" className="block h-0" aria-hidden />
          {summary.recentlyJoined.length === 0 ? (
            <EmptyState title="No recent joiners" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {summary.recentlyJoined.map((person) => (
                <li key={person.id} className="flex items-center justify-between gap-3 py-2">
                  <Link to={`/employees/${person.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                    {person.fullName}
                  </Link>
                  <StatusBadge status={person.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Leaving soon">
          <span id="leaving-soon" className="block h-0" aria-hidden />
          {summary.leavingSoonEmployees.length === 0 ? (
            <EmptyState title="Nobody leaving soon" hint="Employees with a last working day in the next 30 days appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {summary.leavingSoonEmployees.map((person) => (
                <li key={person.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <Link to={`/employees/${person.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                      {person.fullName}
                    </Link>
                    <p className="text-xs text-slate-500">Last working day: {person.lastWorkingDay ?? '—'}</p>
                  </div>
                  <StatusBadge status={person.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Quick actions">
          <div className="flex flex-wrap gap-2">
            {summary.quickActions.map((action) =>
              action.enabled ? (
                <Link
                  key={action.key}
                  to={action.href}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  {action.label}
                </Link>
              ) : (
                <span
                  key={action.key}
                  title={`Arrives in ${action.phase}`}
                  className="cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-400"
                >
                  {action.label} <span className="text-xs">({action.phase})</span>
                </span>
              ),
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
