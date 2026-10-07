import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useEmployeeList } from '../employees/api';
import { useExitList, useInitiateExit, type ExitListParams } from './api';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../../components/Toast';
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
  const notify = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useState<ExitListParams>({ page: 1, limit: 20 });

  const listQuery = useExitList(params);

  const canInitiate = account?.permissions.includes('processExit') ?? false;

  // §8.10 — "Process Exit" initiation form (employee + resignation details).
  const [showInitiate, setShowInitiate] = useState(false);
  const [initForm, setInitForm] = useState({
    employeeId: '',
    reason: '',
    resignationDate: '',
    noticePeriodDays: 30,
    lastWorkingDay: '',
    reasonNote: '',
  });
  const employeesQuery = useEmployeeList({ page: 1, limit: 100 }, showInitiate && canInitiate);
  const initiateMut = useInitiateExit(initForm.employeeId);

  const resetInitForm = () => {
    setInitForm({
      employeeId: '',
      reason: '',
      resignationDate: '',
      noticePeriodDays: 30,
      lastWorkingDay: '',
      reasonNote: '',
    });
  };

  const handleInitiateSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!initForm.employeeId) {
      notify('error', 'Select an employee');
      return;
    }
    if (!initForm.reason.trim()) {
      notify('error', 'Reason is required');
      return;
    }
    try {
      await initiateMut.mutateAsync({
        reason: initForm.reason.trim(),
        noticePeriodDays: Number(initForm.noticePeriodDays) || 0,
        ...(initForm.resignationDate ? { resignationDate: initForm.resignationDate } : {}),
        ...(initForm.lastWorkingDay ? { lastWorkingDay: initForm.lastWorkingDay } : {}),
        ...(initForm.reasonNote.trim() ? { reasonNote: initForm.reasonNote.trim() } : {}),
      });
      notify('success', 'Exit process started');
      const employeeId = initForm.employeeId;
      resetInitForm();
      setShowInitiate(false);
      navigate(`/exit/${employeeId}`);
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Failed to start exit');
    }
  };

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
            <button
              type="button"
              onClick={() => setShowInitiate(true)}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Process Exit
            </button>
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

      {/* Process Exit initiation modal (§8.10) */}
      {showInitiate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Process Exit</h2>
            <form onSubmit={(event) => void handleInitiateSubmit(event)} className="space-y-4">
              <div>
                <label htmlFor="exit-employee" className="block text-xs font-medium text-slate-700 mb-1">
                  Employee *
                </label>
                <select
                  id="exit-employee"
                  required
                  value={initForm.employeeId}
                  onChange={(event) =>
                    setInitForm({ ...initForm, employeeId: event.target.value })
                  }
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                >
                  <option value="">Select an employee…</option>
                  {employeesQuery.data?.data.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.fullName} ({employee.employeeCode}) — {employee.status}
                    </option>
                  ))}
                </select>
                {employeesQuery.isError ? (
                  <p className="mt-1 text-xs text-rose-600" role="alert">
                    Employee list could not be loaded.
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="exit-reason" className="block text-xs font-medium text-slate-700 mb-1">
                  Reason *
                </label>
                <input
                  id="exit-reason"
                  required
                  maxLength={200}
                  value={initForm.reason}
                  onChange={(event) => setInitForm({ ...initForm, reason: event.target.value })}
                  placeholder="Resignation, termination, relocation…"
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="exit-resignation-date"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Resignation date
                  </label>
                  <input
                    id="exit-resignation-date"
                    type="date"
                    value={initForm.resignationDate}
                    onChange={(event) =>
                      setInitForm({ ...initForm, resignationDate: event.target.value })
                    }
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="exit-notice-period"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Notice period (days)
                  </label>
                  <input
                    id="exit-notice-period"
                    type="number"
                    min={0}
                    max={365}
                    value={initForm.noticePeriodDays}
                    onChange={(event) =>
                      setInitForm({ ...initForm, noticePeriodDays: Number(event.target.value) })
                    }
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="exit-lwd"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Last working day
                </label>
                <input
                  id="exit-lwd"
                  type="date"
                  value={initForm.lastWorkingDay}
                  onChange={(event) =>
                    setInitForm({ ...initForm, lastWorkingDay: event.target.value })
                  }
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Leave blank to let the server calculate it from the resignation date and notice
                  period.
                </p>
              </div>
              <div>
                <label
                  htmlFor="exit-reason-note"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Notes
                </label>
                <textarea
                  id="exit-reason-note"
                  rows={3}
                  maxLength={1000}
                  value={initForm.reasonNote}
                  onChange={(event) =>
                    setInitForm({ ...initForm, reasonNote: event.target.value })
                  }
                  placeholder="Optional context…"
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    resetInitForm();
                    setShowInitiate(false);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={initiateMut.isPending}
                  className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {initiateMut.isPending ? 'Starting…' : 'Start Exit Process'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
