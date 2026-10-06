import { useLeaveBalances, useLeaveRequests } from './api';
import { Card, LoadingState, EmptyState, ErrorState } from '../../components/ui';

export function EmployeeLeaveTab({ employeeId }: { employeeId: string }) {
  const currentYear = new Date().getUTCFullYear();
  const balancesQuery = useLeaveBalances({ employeeId, year: currentYear });
  const requestsQuery = useLeaveRequests({ employeeId, limit: 50 });

  if (balancesQuery.isPending || requestsQuery.isPending) {
    return <LoadingState label="Loading employee leave details..." />;
  }

  if (balancesQuery.isError) {
    return <ErrorState error={balancesQuery.error} onRetry={() => void balancesQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      {/* Balances */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Leave Balances ({currentYear})</h3>
        {balancesQuery.data && balancesQuery.data.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {balancesQuery.data.map((bal) => {
              const available =
                bal.allocated + bal.carriedForward - bal.used - bal.pending;
              return (
                <Card key={bal.id}>
                  <p className="text-xs font-semibold text-slate-500 uppercase">{bal.leaveTypeId?.name}</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">{available} days</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Allocated: {bal.allocated} · Used: {bal.used} · Pending: {bal.pending}
                  </p>
                </Card>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No leave balances found for this employee.</p>
        )}
      </div>

      {/* Requests */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Leave History</h3>
        {requestsQuery.isError ? (
          <ErrorState error={requestsQuery.error} onRetry={() => void requestsQuery.refetch()} />
        ) : !requestsQuery.data?.data || requestsQuery.data.data.length === 0 ? (
          <EmptyState title="No leave requests" hint="Leave history for this employee will appear here." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Leave Type</th>
                  <th className="px-4 py-3 text-left font-medium">From</th>
                  <th className="px-4 py-3 text-left font-medium">To</th>
                  <th className="px-4 py-3 text-left font-medium">Days</th>
                  <th className="px-4 py-3 text-left font-medium">Reason</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {requestsQuery.data.data.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{req.leaveTypeId?.name}</td>
                    <td className="px-4 py-3 text-slate-700">{req.fromDate}</td>
                    <td className="px-4 py-3 text-slate-700">{req.toDate}</td>
                    <td className="px-4 py-3 text-slate-700 font-semibold">{req.days}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{req.reason}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          req.status === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : req.status === 'Rejected'
                              ? 'bg-rose-100 text-rose-800'
                              : req.status === 'Cancelled'
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {req.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
