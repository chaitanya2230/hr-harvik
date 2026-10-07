import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { useEmployee } from '../employees/api';
import { useAssetAssignments } from '../assets/api';
import { useAccessItems, useLicenseAssignments } from '../licenses/api';
import { useAttendanceList } from '../attendance/api';
import { downloadDocument, useDocuments } from '../documents/api';
import { useLeaveBalances, useLeaveRequests } from '../leave/api';
import { useToast } from '../../components/Toast';
import type { DocumentItem } from '../../api/types';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../../components/ui';

/**
 * AGENTS.md §6 — Employee self-service: everyone can see their own profile,
 * own assets and own software/access, even without directory access.
 */
export function MyProfilePage() {
  const { account } = useAuth();
  const employeeId = account?.employeeId ?? undefined;
  const detailQuery = useEmployee(employeeId);
  const assignmentFilter = { page: 1, limit: 100, employeeId: employeeId ?? '' };
  const assetsQuery = useAssetAssignments(assignmentFilter, Boolean(employeeId));
  const licensesQuery = useLicenseAssignments(assignmentFilter, Boolean(employeeId));
  const accessQuery = useAccessItems(assignmentFilter, Boolean(employeeId));

  // AGENTS.md §6 — self-service sections below are only mounted for a linked
  // employee record, so no query is ever issued without a valid employee id.
  const selfId = account?.employeeId ?? null;

  if (!selfId) {
    return (
      <EmptyState
        title="No employee profile linked"
        hint="Your login is not linked to an employee record. Contact HR."
      />
    );
  }

  if (detailQuery.isPending) return <LoadingState label="Loading your profile…" />;
  if (detailQuery.isError) {
    return <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  }

  const employee = detailQuery.data.data;

  return (
    <div>
      <PageHeader title={employee.fullName} subtitle={`${employee.employeeCode} · ${employee.email}`} />
      <div className="mb-4">
        <StatusBadge status={employee.status} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Employment">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Designation</dt><dd className="text-slate-900">{employee.designation ?? '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Department</dt><dd className="text-slate-900">{employee.department?.name ?? '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Manager</dt><dd className="text-slate-900">{employee.reportingManager?.fullName ?? '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Type</dt><dd className="text-slate-900">{employee.employmentType}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Joined</dt><dd className="text-slate-900">{employee.dateOfJoining}</dd></div>
          </dl>
        </Card>
        <Card title="Details">
          <Link to={`/employees/${employee.id}`} className="text-sm font-medium text-brand-700 hover:underline">
            Open full profile
          </Link>
        </Card>
        <Card title="My hardware">
          {assetsQuery.isPending ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (assetsQuery.data?.data.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">No hardware assigned.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {assetsQuery.data?.data.map((row) => (
                <li key={row.id} className="text-slate-700">
                  {row.asset?.name ?? '—'}
                  <span className="ml-1 text-xs text-slate-500">
                    {row.actualReturnDate ? `(returned ${row.actualReturnDate})` : '(held)'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="My software & access">
          {(licensesQuery.isPending || accessQuery.isPending) ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (licensesQuery.data?.data.length ?? 0) + (accessQuery.data?.data.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">Nothing assigned.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {licensesQuery.data?.data.map((row) => (
                <li key={row.id} className="text-slate-700">
                  {row.license?.softwareName ?? '—'}
                  <span className="ml-1 text-xs text-slate-500">({row.status})</span>
                </li>
              ))}
              {accessQuery.data?.data.map((row) => (
                <li key={row.id} className="text-slate-700">
                  {row.system}
                  <span className="ml-1 text-xs text-slate-500">({row.status})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <SelfDocuments employeeId={selfId} />
        <SelfAttendance employeeId={selfId} />
        <SelfLeave employeeId={selfId} />
      </div>
    </div>
  );
}

/** AGENTS.md §9 — compact status pill shared by the self-service sections. */
const TONE_CLASSES: Record<string, string> = {
  Present: 'bg-green-100 text-green-800',
  'Half Day': 'bg-amber-100 text-amber-800',
  Absent: 'bg-red-100 text-red-800',
  Leave: 'bg-purple-100 text-purple-800',
  Holiday: 'bg-blue-100 text-blue-800',
  Pending: 'bg-amber-100 text-amber-800',
  Approved: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-800',
  Cancelled: 'bg-slate-100 text-slate-500',
};

const toneClass = (label: string): string => TONE_CLASSES[label] ?? 'bg-slate-100 text-slate-600';

function ToneBadge({ label }: { label: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClass(label)}`}>
      {label}
    </span>
  );
}

/**
 * AGENTS.md §6/§9 — own documents: category, dates, version and a secure
 * download through the API helper (uploads are never served publicly).
 * Mounted only when the account is linked to an employee, and the query is
 * additionally guarded with `enabled` so no request fires without an id.
 */
function SelfDocuments({ employeeId }: { employeeId: string }) {
  const notify = useToast();
  const documentsQuery = useDocuments({ employeeId, limit: 50 }, Boolean(employeeId));
  const items = documentsQuery.data?.data ?? [];

  const handleDownload = (doc: DocumentItem): void => {
    downloadDocument(doc.id, doc.file.originalName).catch((error: unknown) => {
      notify('error', error instanceof Error ? error.message : 'Download failed');
    });
  };

  return (
    <Card title="My documents">
      {documentsQuery.isPending ? (
        <p className="text-sm text-slate-500">Loading documents…</p>
      ) : documentsQuery.isError ? (
        <ErrorState error={documentsQuery.error} onRetry={() => void documentsQuery.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No documents on file yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((doc) => (
            <li key={doc.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{doc.title}</p>
                <p className="text-xs text-slate-500">
                  {doc.category} · v{doc.version} · uploaded {doc.createdAt.slice(0, 10)}
                  {doc.expiryDate ? ` · expires ${doc.expiryDate}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDownload(doc)}
                className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
      <Link to="/documents" className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
        All documents →
      </Link>
    </Card>
  );
}

/**
 * AGENTS.md §6/§9 — own recent attendance (last 14 entries, newest first) with
 * a small status summary. The hook has no `enabled` option, so this component
 * is only mounted for a linked employee id (see the guard in MyProfilePage).
 */
function SelfAttendance({ employeeId }: { employeeId: string }) {
  const attendanceQuery = useAttendanceList({ employeeId, limit: 14 });
  const records = attendanceQuery.data?.data ?? [];

  const counts = records.reduce<Record<string, number>>((acc, record) => {
    acc[record.status] = (acc[record.status] ?? 0) + 1;
    return acc;
  }, {});
  const summaryStatuses = ['Present', 'Half Day', 'Absent', 'Leave', 'Holiday'];

  return (
    <Card title="My attendance">
      {attendanceQuery.isPending ? (
        <p className="text-sm text-slate-500">Loading attendance…</p>
      ) : attendanceQuery.isError ? (
        <ErrorState error={attendanceQuery.error} onRetry={() => void attendanceQuery.refetch()} />
      ) : records.length === 0 ? (
        <p className="text-sm text-slate-500">No attendance recorded yet.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-400">
            Summary of the {records.length} most recent entries
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {summaryStatuses.map((status) => (
              <span
                key={status}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass(status)}`}
              >
                {status} {counts[status] ?? 0}
              </span>
            ))}
          </div>
          <ul className="divide-y divide-slate-100">
            {records.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="text-slate-700">{record.date}</span>
                <span className="flex items-center gap-2">
                  {record.workMode ? (
                    <span className="text-xs text-slate-400">{record.workMode}</span>
                  ) : null}
                  <ToneBadge label={record.status} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to="/attendance" className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
        Open attendance calendar →
      </Link>
    </Card>
  );
}

/**
 * AGENTS.md §6/§9 — own leave balances and recent requests with status badges,
 * plus a shortcut to /leave to apply. Both hooks lack an `enabled` option, so
 * this component only mounts for a linked employee id (see MyProfilePage).
 */
function SelfLeave({ employeeId }: { employeeId: string }) {
  const balancesQuery = useLeaveBalances({ employeeId });
  const requestsQuery = useLeaveRequests({ employeeId, limit: 10 });
  const balances = balancesQuery.data ?? [];
  const requests = requestsQuery.data?.data ?? [];

  return (
    <Card title="My leave">
      <h3 className="mb-1 text-sm font-medium text-slate-900">Balances</h3>
      {balancesQuery.isPending ? (
        <p className="text-sm text-slate-500">Loading balances…</p>
      ) : balancesQuery.isError ? (
        <ErrorState error={balancesQuery.error} onRetry={() => void balancesQuery.refetch()} />
      ) : balances.length === 0 ? (
        <p className="text-sm text-slate-500">No leave balances configured yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-slate-100">
          {balances.map((balance) => {
            const total = balance.allocated + balance.carriedForward;
            const remaining = total - balance.used - balance.pending;
            return (
              <li key={balance.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="text-slate-700">{balance.leaveTypeId.name}</span>
                <span className="text-xs text-slate-500">
                  {remaining} of {total} left
                  {balance.pending > 0 ? ` · ${balance.pending} pending` : ''}
                  {balance.used > 0 ? ` · ${balance.used} used` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="mb-1 text-sm font-medium text-slate-900">Recent requests</h3>
      {requestsQuery.isPending ? (
        <p className="text-sm text-slate-500">Loading requests…</p>
      ) : requestsQuery.isError ? (
        <ErrorState error={requestsQuery.error} onRetry={() => void requestsQuery.refetch()} />
      ) : requests.length === 0 ? (
        <p className="text-sm text-slate-500">No leave requests yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {requests.map((request) => (
            <li key={request.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-slate-700">
                  {request.fromDate} – {request.toDate}
                </span>
                <span className="text-xs text-slate-500">
                  {request.days} day{request.days === 1 ? '' : 's'} · {request.leaveTypeId.name}
                </span>
              </span>
              <ToneBadge label={request.status} />
            </li>
          ))}
        </ul>
      )}

      <Link to="/leave" className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
        Apply for leave →
      </Link>
    </Card>
  );
}
