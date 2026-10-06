import { useAttendanceList } from './api';
import { LoadingState, EmptyState, ErrorState } from '../../components/ui';

export function EmployeeAttendanceTab({ employeeId }: { employeeId: string }) {
  const { data, isPending, isError, error, refetch } = useAttendanceList({
    employeeId,
    limit: 50,
  });

  if (isPending) return <LoadingState label="Loading employee attendance..." />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data?.data || data.data.length === 0) {
    return <EmptyState title="No attendance history" hint="Attendance records for this employee will appear here." />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Date</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Work Mode</th>
            <th className="px-4 py-3 text-left font-medium">Check In</th>
            <th className="px-4 py-3 text-left font-medium">Check Out</th>
            <th className="px-4 py-3 text-left font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {data.data.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-900">{row.date}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    row.status === 'Present'
                      ? 'bg-emerald-100 text-emerald-800'
                      : row.status === 'Absent'
                        ? 'bg-rose-100 text-rose-800'
                        : row.status === 'Leave'
                          ? 'bg-amber-100 text-amber-800'
                          : row.status === 'Holiday'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {row.status}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-600">{row.workMode ?? '—'}</td>
              <td className="px-4 py-3 text-slate-600">{row.checkIn ?? '—'}</td>
              <td className="px-4 py-3 text-slate-600">{row.checkOut ?? '—'}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
