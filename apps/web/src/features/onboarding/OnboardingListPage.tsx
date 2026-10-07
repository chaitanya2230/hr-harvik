import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { useAuth } from '../auth/auth-context';
import { useOnboardings } from './api';

export function OnboardingListPage() {
  const { account } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const isEmployee = account?.role === 'Employee' && Boolean(account.employeeId);

  const { data, isPending, isError, error, refetch } = useOnboardings({
    page,
    limit: 10,
    status: status || undefined,
    q: q || undefined,
    enabled: !isEmployee,
  });

  // If Employee role, redirect to own checklist directly (§6, §8.4)
  if (isEmployee) {
    return <Navigate to={`/onboarding/${account?.employeeId}`} replace />;
  }

  if (isPending) return <LoadingState label="Loading onboarding checklists…" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const onboardings = data.data;
  const meta = data.meta;

  const statusBadgeTone: Record<string, string> = {
    'Not Started': 'bg-slate-100 text-slate-700',
    'In Progress': 'bg-amber-50 text-amber-800 font-semibold',
    Completed: 'bg-emerald-50 text-emerald-800 font-semibold',
  };

  return (
    <div>
      <PageHeader
        title="Employee Onboarding"
        subtitle="Track the 14-item onboarding checklist and lifecycle readiness"
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search by employee name or code…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm placeholder:text-slate-400"
        />

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="In Progress">In Progress</option>
          <option value="Not Started">Not Started</option>
          <option value="Completed">Completed</option>
        </select>
      </div>

      {onboardings.length === 0 ? (
        <EmptyState title="No onboarding records found" hint="Try adjusting your search criteria." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Joining Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {onboardings.map((onb) => (
                <tr key={onb.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/onboarding/${onb.employeeId}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {onb.employeeName}
                    </Link>
                    <p className="font-mono text-xs text-slate-500">{onb.employeeCode}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{onb.departmentName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{onb.employmentType}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${
                        statusBadgeTone[onb.status] ?? 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {onb.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-36">
                      <div className="flex justify-between text-xs text-slate-600 mb-1">
                        <span>{onb.completedItemsCount} / {onb.totalItemsCount}</span>
                        <span>{onb.progressPercent}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={`h-full ${
                            onb.progressPercent === 100 ? 'bg-emerald-500' : 'bg-brand-600'
                          }`}
                          style={{ width: `${onb.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{onb.dateOfJoining}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/onboarding/${onb.employeeId}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      View Checklist
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {meta.total > meta.limit && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
              <span>
                Showing {((meta.page - 1) * meta.limit) + 1} to{' '}
                {Math.min(meta.page * meta.limit, meta.total)} of {meta.total} records
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-300 px-2.5 py-1 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page * meta.limit >= meta.total}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border border-slate-300 px-2.5 py-1 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
