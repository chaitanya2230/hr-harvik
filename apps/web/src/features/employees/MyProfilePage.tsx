import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { useEmployee } from '../employees/api';
import { useAssetAssignments } from '../assets/api';
import { useAccessItems, useLicenseAssignments } from '../licenses/api';
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

  if (!account?.employeeId) {
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
      </div>
    </div>
  );
}
