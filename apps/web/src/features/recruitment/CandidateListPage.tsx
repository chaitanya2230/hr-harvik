import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { useAuth } from '../auth/auth-context';
import { useCandidates, useJobs } from './api';

export function CandidateListPage() {
  const { account } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState(searchParams.get('stage') ?? '');
  const [jobId, setJobId] = useState(searchParams.get('jobId') ?? '');

  const canManage = account?.permissions.includes('manageCandidates');

  const { data, isPending, isError, error, refetch } = useCandidates({
    page,
    limit: 10,
    jobId: jobId || undefined,
    stage: stage || undefined,
    q: q || undefined,
  });

  const jobsQuery = useJobs({ limit: 100 });
  const jobs = jobsQuery.data?.data ?? [];

  if (isPending) return <LoadingState label="Loading candidate pool…" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const candidates = data.data;
  const meta = data.meta;

  const stageBadgeTone: Record<string, string> = {
    Applied: 'bg-slate-100 text-slate-800',
    Shortlisted: 'bg-blue-50 text-blue-700',
    Interview: 'bg-purple-50 text-purple-700',
    Selected: 'bg-amber-50 text-amber-700',
    Offer: 'bg-indigo-50 text-indigo-700',
    Joined: 'bg-emerald-50 text-emerald-700 font-semibold',
    Rejected: 'bg-rose-50 text-rose-700',
  };

  return (
    <div>
      <PageHeader
        title="Candidate Pool"
        subtitle="Manage recruitment pipeline, interviews, and candidate evaluations"
        actions={
          canManage ? (
            <Link
              to="/recruitment/candidates/new"
              className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-500"
            >
              Add Candidate
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search by name, email, CAN-####…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm placeholder:text-slate-400"
        />

        <select
          value={jobId}
          onChange={(e) => {
            const val = e.target.value;
            setJobId(val);
            setPage(1);
            if (val) searchParams.set('jobId', val);
            else searchParams.delete('jobId');
            setSearchParams(searchParams);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All Jobs</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.jobCode} - {j.title}
            </option>
          ))}
        </select>

        <select
          value={stage}
          onChange={(e) => {
            const val = e.target.value;
            setStage(val);
            setPage(1);
            if (val) searchParams.set('stage', val);
            else searchParams.delete('stage');
            setSearchParams(searchParams);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All Stages</option>
          <option value="Applied">Applied</option>
          <option value="Shortlisted">Shortlisted</option>
          <option value="Interview">Interview</option>
          <option value="Selected">Selected</option>
          <option value="Offer">Offer</option>
          <option value="Joined">Joined</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>

      {candidates.length === 0 ? (
        <EmptyState title="No candidates found" hint="Try adjusting your filters or add a candidate." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Job Applied</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Offer Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {candidates.map((cand) => (
                <tr key={cand.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                    <Link
                      to={`/recruitment/candidates/${cand.id}`}
                      className="text-brand-600 hover:underline"
                    >
                      {cand.candidateCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{cand.name}</p>
                    <p className="text-xs text-slate-500">{cand.email} · {cand.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <p className="font-medium">{cand.jobTitle ?? '—'}</p>
                    <p className="text-xs text-slate-500">{cand.jobCode}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{cand.source}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        stageBadgeTone[cand.stage] ?? 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {cand.stage}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {cand.offerStatus !== 'Pending' ? (
                      <span className="font-medium text-indigo-700">{cand.offerStatus}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/recruitment/candidates/${cand.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      Manage
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
                {Math.min(meta.page * meta.limit, meta.total)} of {meta.total} candidates
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
