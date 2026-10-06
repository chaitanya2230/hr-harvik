import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { useEmployee } from '../employees/api';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../../components/ui';

/**
 * AGENTS.md §6 — Employee self-service: everyone can see their own profile,
 * even without directory access.
 */
export function MyProfilePage() {
  const { account } = useAuth();
  const detailQuery = useEmployee(account?.employeeId ?? undefined);

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
      </div>
    </div>
  );
}
