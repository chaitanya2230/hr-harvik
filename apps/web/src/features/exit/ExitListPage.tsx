import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useExitList, type ExitListParams } from './api';
import { useAuth } from '../auth/auth-context';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import type { ExitStage } from '../../api/types';

/**
 * AGENTS.md §9 — /exit route.
 *
 * Lists all active exit processes. HR Admin/HR Manager see all; Managers see
 * team-scoped; Employees see only their own (redirected to detail).
 */

const STAGE_OPTIONS: ExitStage[] = [
  'Notice Period',
  'Clearance',
  'Asset Return',
  'Software Revocation',
  'Final Settlement',
  'Documents',
  'Relieved',
  'Cancelled',
];

const stageBadgeClass = (stage: ExitStage): string => {
  switch (stage) {
    case 'Relieved':
      return 'bg-green-100 text-green-800';
    case 'Cancelled':
      return 'bg-slate-100 text-slate-600';
    case 'Asset Return':
    case 'Software Revocation':
      return 'bg-orange-100 text-orange-800';
    case 'Clearance':
    case 'Final Settlement':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-blue-100 text-blue-800';
  }
};

export function ExitListPage() {
  const { account } = useAuth();
  const [params, setParams] = useState<ExitListParams>({ page: 1, limit: 20 });

  const listQuery = useExitList(params);

  const canInitiate = account?.permissions.includes('processExit') ?? false;

  const onStageFilter = (stage: string) => {
    setParams((prev) => ({ ...prev, stage: stage || undefined, page: 1 }));
  };

  return (
    <div>
      <PageHeader
        title="Exit / Offboarding"
        subtitle="Active and completed employee exit processes"
        actions={
          canInitiate ? (
            <Link
              to="/employees"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Go to Employee to Initiate
            </Link>
          ) : null
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div>
          <label htmlFor="exit-stage-filter" className="sr-only">
            Filter by stage
          </label>
          <select
            id="exit-stage-filter"
            value={params.stage ?? ''}
            onChange={(e) => onStageFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">All stages</option>
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {listQuery.isPending ? (
        <LoadingState label="Loading exits…" />
      ) : listQuery.isError ? (
        <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      ) : (listQuery.data?.data.length ?? 0) === 0 ? (
        <EmptyState title="No exit processes found" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Employee</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Code</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Stage</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">LWD</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Blockers</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Reason</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {listQuery.data?.data.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.employeeName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.employeeCode}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${stageBadgeClass(row.stage)}`}
                      >
                        {row.stage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.lastWorkingDay}</td>
                    <td className="px-4 py-3">
                      {row.blockers.length > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          {row.blockers.length} pending
                        </span>
                      ) : (
                        <span className="text-xs text-green-600">Clear</span>
                      )}
                    </td>
                    <td className="max-w-[160px] truncate px-4 py-3 text-slate-600">{row.reason}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/exit/${row.employeeId}`}
                        className="text-brand-600 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <p>
              {listQuery.data?.meta.total ?? 0} total
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={params.page <= 1}
                onClick={() => setParams((p) => ({ ...p, page: p.page - 1 }))}
                className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="px-2 py-1">
                Page {params.page} / {Math.ceil((listQuery.data?.meta.total ?? 0) / params.limit) || 1}
              </span>
              <button
                type="button"
                disabled={
                  params.page >= Math.ceil((listQuery.data?.meta.total ?? 0) / params.limit)
                }
                onClick={() => setParams((p) => ({ ...p, page: p.page + 1 }))}
                className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
