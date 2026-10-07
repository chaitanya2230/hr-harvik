import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { useAuth } from '../auth/auth-context';
import { useJobs } from './api';

export function JobListPage() {
  const { account } = useAuth();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const canManageJobs = account?.permissions.includes('manageJobs');

  const { data, isPending, isError, error, refetch } = useJobs({
    page,
    limit: 10,
    status: status || undefined,
    q: q || undefined,
  });

  if (isPending) return <LoadingState label="Loading job postings…" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const jobs = data.data;
  const meta = data.meta;

  return (
    <div>
      <PageHeader
        title="Job Openings"
        subtitle="Manage recruitment requisitions and open positions"
        actions={
          canManageJobs ? (
            <Link
              to="/recruitment/jobs/new"
              className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-500"
            >
              Post New Job
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search jobs by title or code…"
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
          <option value="Open">Open</option>
          <option value="Filled">Filled</option>
          <option value="Closed">Closed</option>
          <option value="On Hold">On Hold</option>
          <option value="Draft">Draft</option>
        </select>
      </div>

      {jobs.length === 0 ? (
        <EmptyState title="No job openings found" hint="Try adjusting your filters or post a new job." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Job Code</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Openings</th>
                <th className="px-4 py-3">Filled</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Opening Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                    <Link to={`/recruitment/jobs/${job.id}`} className="text-brand-600 hover:underline">
                      {job.jobCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{job.title}</td>
                  <td className="px-4 py-3 text-slate-600">{job.departmentName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{job.openings}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-slate-900">{job.filledCount}</span>
                    <span className="text-xs text-slate-500"> ({job.remainingOpenings} left)</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        job.status === 'Open'
                          ? 'bg-emerald-50 text-emerald-700'
                          : job.status === 'Filled'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{job.openingDate}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/recruitment/jobs/${job.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      View
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
                {Math.min(meta.page * meta.limit, meta.total)} of {meta.total} jobs
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
