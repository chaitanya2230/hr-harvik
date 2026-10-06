import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import {
  useChangeEmployeeStatus,
  useDeleteEmployee,
  useEmployee,
  useEmployeeHistory,
} from './api';
import { useAssetAssignments } from '../assets/api';
import { useAccessItems, useLicenseAssignments } from '../licenses/api';
import { useExitForEmployee } from '../exit/api';
import { EmployeeDocumentsTab } from '../documents/EmployeeDocumentsTab';
import { EmployeeAttendanceTab } from '../attendance/EmployeeAttendanceTab';
import { EmployeeLeaveTab } from '../leave/EmployeeLeaveTab';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../../components/Toast';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../../components/ui';

/**
 * AGENTS.md §8.2 — Employee 360 view.
 *
 * Overview, Employment History, Assets, Software & Access, Documents, and Exit carry real data.
 * The tabs owned by later phases render an explicit "arrives in Pn" notice —
 * never placeholder numbers.
 */

type Tab = 'overview' | 'history' | 'assets' | 'software' | 'documents' | 'attendance' | 'leave' | 'exit';

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  history: 'Employment History',
  assets: 'Assets',
  software: 'Software & Access',
  documents: 'Documents',
  attendance: 'Attendance',
  leave: 'Leave',
  exit: 'Exit',
};

const FUTURE_TABS: Array<{ label: string; phase: string }> = [];

const STATUS_OPTIONS = ['Active', 'Probation', 'On Notice', 'Resigned', 'Relieved', 'Inactive'] as const;

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { account } = useAuth();
  const navigate = useNavigate();
  const notify = useToast();

  const [tab, setTab] = useState<Tab>('overview');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [statusTarget, setStatusTarget] = useState('');
  const [statusReason, setStatusReason] = useState('');

  const detailQuery = useEmployee(id);
  const historyQuery = useEmployeeHistory(tab === 'history' ? id : undefined);
  const employeeAssetsQuery = useAssetAssignments(
    { page: 1, limit: 100, employeeId: id ?? '' },
    tab === 'assets',
  );
  const employeeLicensesQuery = useLicenseAssignments(
    { page: 1, limit: 100, employeeId: id ?? '' },
    tab === 'software',
  );
  const employeeAccessQuery = useAccessItems(
    { page: 1, limit: 100, employeeId: id ?? '' },
    tab === 'software',
  );
  const exitQuery = useExitForEmployee(tab === 'exit' ? id : undefined);
  const statusMutation = useChangeEmployeeStatus(id ?? '');
  const deleteMutation = useDeleteEmployee();

  const canEdit = account?.permissions.includes('updateEmployee') ?? false;
  const canDelete = account?.permissions.includes('deleteEmployee') ?? false;

  if (detailQuery.isPending) return <LoadingState label="Loading employee…" />;
  if (detailQuery.isError) {
    return <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  }

  const employee = detailQuery.data.data;

  const onStatusChange = async (): Promise<void> => {
    if (!statusTarget || !id) return;
    try {
      await statusMutation.mutateAsync({
        status: statusTarget,
        ...(statusTarget === 'Relieved' || employee.status === 'Relieved'
          ? { reason: statusReason || 'Status changed from the employee profile' }
          : {}),
      });
      notify('success', `Status changed to ${statusTarget}`);
      setStatusTarget('');
      setStatusReason('');
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Status change failed.');
    }
  };

  const onDelete = async (): Promise<void> => {
    if (!id) return;
    try {
      await deleteMutation.mutateAsync(id);
      notify('success', 'Employee deleted');
      navigate('/employees');
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Delete failed.');
      setConfirmingDelete(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={employee.fullName}
        subtitle={`${employee.employeeCode} · ${employee.email}`}
        actions={
          <>
            {canEdit ? (
              <Link
                to={`/employees/${employee.id}/edit`}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Edit
              </Link>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <StatusBadge status={employee.status} />
        <span className="text-sm text-slate-500">
          {employee.designation ?? 'No designation'} · {employee.employmentType}
        </span>
      </div>

      <div role="tablist" aria-label="Employee sections" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {(['overview', 'history', 'assets', 'software', 'documents', 'attendance', 'leave', 'exit'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`rounded-t-md px-4 py-2 text-sm font-medium ${
              tab === value
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {TAB_LABELS[value]}
            {value === 'exit' &&
              ['On Notice', 'Resigned', 'Relieved'].includes(employee.status) && (
                <span className="ml-1 inline-flex h-2 w-2 rounded-full bg-orange-400" />
              )}
          </button>
        ))}
        {FUTURE_TABS.map((future) => (
          <span
            key={future.label}
            title={`Arrives in ${future.phase}`}
            className="cursor-not-allowed rounded-t-md px-4 py-2 text-sm text-slate-400"
          >
            {future.label} <span className="text-xs">({future.phase})</span>
          </span>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Employment">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Department</dt><dd className="text-slate-900">{employee.department?.name ?? '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Manager</dt><dd className="text-slate-900">{employee.reportingManager?.fullName ?? '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Date of joining</dt><dd className="text-slate-900">{employee.dateOfJoining}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Probation ends</dt><dd className="text-slate-900">{employee.probationEndDate ?? '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Last working day</dt><dd className="text-slate-900">{employee.lastWorkingDay ?? '—'}</dd></div>
            </dl>
          </Card>

          <Card title="Contact">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Phone</dt><dd className="text-slate-900">{employee.phone ?? '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Date of birth</dt><dd className="text-slate-900">{employee.dob ?? '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Emergency contact</dt><dd className="text-slate-900">{employee.emergencyContact?.name ? `${employee.emergencyContact.name} (${employee.emergencyContact.relation ?? '—'})` : '—'}</dd></div>
            </dl>
          </Card>

          {employee.compensation ? (
            <Card title="Compensation">
              <p className="text-sm text-slate-900">
                {employee.compensation.amount} {employee.compensation.currency} · {employee.compensation.period}
              </p>
            </Card>
          ) : null}

          {employee.bankDetails ? (
            <Card title="Bank details">
              <p className="text-sm text-slate-500">
                Masked account details on file ({employee.bankDetails.bankName ?? 'bank not recorded'}).
              </p>
            </Card>
          ) : null}

          {canEdit ? (
            <Card title="Change status">
              <div className="flex flex-wrap gap-2">
                <label htmlFor="status-target" className="sr-only">New status</label>
                <select
                  id="status-target"
                  value={statusTarget}
                  onChange={(event) => setStatusTarget(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="">Select status…</option>
                  {STATUS_OPTIONS.filter((option) => option !== employee.status).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                <input
                  aria-label="Reason (required when relieving)"
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder="Reason / note"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  disabled={!statusTarget || statusMutation.isPending}
                  onClick={() => void onStatusChange()}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {statusMutation.isPending ? 'Saving…' : 'Apply'}
                </button>
              </div>
              {statusMutation.isError ? <p role="alert" className="mt-2 text-sm text-red-600">Status change failed. The API message has been shown as a notification.</p> : null}
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === 'history' ? (
        historyQuery.isPending ? (
          <LoadingState label="Loading history…" />
        ) : historyQuery.isError ? (
          <ErrorState error={historyQuery.error} onRetry={() => void historyQuery.refetch()} />
        ) : historyQuery.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Status history">
            <ol className="space-y-3">
              {historyQuery.data.data.statusHistory.map((entry, index) => (
                <li key={`${entry.changedAt}-${index}`} className="text-sm">
                  <StatusBadge status={entry.status} />
                  <div className="mt-1 text-xs text-slate-500">
                    {new Date(entry.changedAt).toLocaleString()}
                    {entry.note ? ` — ${entry.note}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Employment history">
            <ol className="space-y-3">
              {historyQuery.data.data.employmentHistory.map((entry, index) => (
                <li key={`${entry.from}-${index}`} className="text-sm text-slate-700">
                  <p className="font-medium text-slate-900">{entry.employmentType}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(entry.from).toLocaleDateString()} → {entry.to ? new Date(entry.to).toLocaleDateString() : 'present'}
                    {entry.note ? ` — ${entry.note}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      ) : (
        <EmptyState title="No history available" />
      )
      ) : null}

      {tab === 'assets' ? (
        <Card title="Assigned hardware">
          {employeeAssetsQuery.isPending ? (
            <LoadingState label="Loading assets…" />
          ) : employeeAssetsQuery.isError ? (
            <ErrorState error={employeeAssetsQuery.error} onRetry={() => void employeeAssetsQuery.refetch()} />
          ) : (employeeAssetsQuery.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="No hardware assigned" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {employeeAssetsQuery.data?.data.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">
                      {row.asset?.name ?? 'Unknown asset'}
                      <span className="ml-2 font-mono text-xs text-slate-500">{row.asset?.assetCode}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Assigned {new Date(row.assignedAt).toLocaleDateString()}
                      {row.actualReturnDate ? ` · returned ${row.actualReturnDate}` : ' · still held'}
                      {row.overdue ? <span className="ml-1 font-medium text-red-600">overdue</span> : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === 'software' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Software licenses">
            {employeeLicensesQuery.isPending ? (
              <LoadingState label="Loading licenses…" />
            ) : employeeLicensesQuery.isError ? (
              <ErrorState error={employeeLicensesQuery.error} onRetry={() => void employeeLicensesQuery.refetch()} />
            ) : (employeeLicensesQuery.data?.data.length ?? 0) === 0 ? (
              <EmptyState title="No licenses assigned" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {employeeLicensesQuery.data?.data.map((row) => (
                  <li key={row.id} className="py-2 text-sm">
                    <p className="font-medium text-slate-900">{row.license?.softwareName ?? '—'}</p>
                    <p className="text-xs text-slate-500">{row.status}{row.accountIdentifier ? ` · ${row.accountIdentifier}` : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="External access">
            {employeeAccessQuery.isPending ? (
              <LoadingState label="Loading access…" />
            ) : employeeAccessQuery.isError ? (
              <ErrorState error={employeeAccessQuery.error} onRetry={() => void employeeAccessQuery.refetch()} />
            ) : (employeeAccessQuery.data?.data.length ?? 0) === 0 ? (
              <EmptyState title="No external accounts" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {employeeAccessQuery.data?.data.map((row) => (
                  <li key={row.id} className="py-2 text-sm">
                    <p className="font-medium text-slate-900">{row.system}</p>
                    <p className="text-xs text-slate-500">{row.status}{row.identifier ? ` · ${row.identifier}` : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'documents' ? <EmployeeDocumentsTab employeeId={employee.id} /> : null}

      {tab === 'attendance' ? <EmployeeAttendanceTab employeeId={employee.id} /> : null}

      {tab === 'leave' ? <EmployeeLeaveTab employeeId={employee.id} /> : null}

      {tab === 'exit' ? (
        exitQuery.isPending ? (
          <LoadingState label="Loading exit details…" />
        ) : exitQuery.isError ? (
          <Card title="Exit / Offboarding">
            {['On Notice', 'Resigned', 'Relieved'].includes(employee.status) ? (
              <p className="text-sm text-slate-500">
                Exit record is being created or could not be loaded. Refresh to try again.
              </p>
            ) : (
              <EmptyState title="No exit process" hint="Employee is not currently on notice or resigned." />
            )}
          </Card>
        ) : exitQuery.data ? (
          <div className="space-y-4">
            <Card title="Exit overview">
              <div className="mb-3 flex items-center justify-between">
                <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
                  {exitQuery.data.data.stage}
                </span>
                <Link
                  to={`/exit/${employee.id}`}
                  className="text-sm text-brand-600 hover:underline"
                >
                  Open full exit page →
                </Link>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-slate-500">Last working day</dt><dd className="font-medium text-slate-900">{exitQuery.data.data.lastWorkingDay}</dd></div>
                <div><dt className="text-slate-500">Reason</dt><dd className="text-slate-900">{exitQuery.data.data.reason}</dd></div>
              </dl>
            </Card>

            {exitQuery.data.data.blockers.length > 0 && (
              <Card title="Blockers">
                <ul className="space-y-1">
                  {exitQuery.data.data.blockers.map((b, i) => (
                    <li key={i} className="text-sm text-red-700">• {b}</li>
                  ))}
                </ul>
              </Card>
            )}

            <Card title="Checklist summary">
              <ul className="divide-y divide-slate-100">
                {exitQuery.data.data.checklist.map((item) => (
                  <li key={item.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-slate-700">{item.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.status === 'Completed'
                          ? 'bg-green-100 text-green-700'
                          : item.status === 'Waived'
                            ? 'bg-slate-100 text-slate-500'
                            : 'bg-orange-100 text-orange-700'
                      }`}
                    >
                      {item.status}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        ) : (
          <EmptyState title="No exit process" hint="Employee is not currently on notice or resigned." />
        )
      ) : null}

      {confirmingDelete ? (
        <div role="alertdialog" aria-label="Confirm delete" className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">Delete employee?</h2>
            <p className="mt-1 text-sm text-slate-500">
              {employee.fullName} will be soft-deleted. Their login will be deactivated.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => void onDelete()}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
