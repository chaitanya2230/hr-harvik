import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../auth/auth-context';
import { useDeleteJob, useJob, useUpdateJob } from './api';
import type { Job } from './types';

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notify = useToast();
  const { account } = useAuth();
  const [isEditing, setIsEditing] = useState(false);

  const { data, isPending, isError, error, refetch } = useJob(id ?? '');
  const updateJob = useUpdateJob(id ?? '');
  const deleteJob = useDeleteJob(id ?? '');

  const canManage = account?.permissions.includes('manageJobs');
  const canDelete = account?.permissions.includes('deleteJob');

  const [editTitle, setEditTitle] = useState('');
  const [editOpenings, setEditOpenings] = useState(1);
  const [editStatus, setEditStatus] = useState('Open');
  const [editDescription, setEditDescription] = useState('');

  if (isPending) return <LoadingState label="Loading job details…" />;
  if (isError || !data?.data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const job = data.data;

  const handleStartEdit = () => {
    setEditTitle(job.title);
    setEditOpenings(job.openings);
    setEditStatus(job.status);
    setEditDescription(job.description);
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateJob.mutateAsync({
        title: editTitle,
        openings: editOpenings,
        status: editStatus as Job['status'],
        description: editDescription,
      });
      notify('success', 'Job updated successfully');
      setIsEditing(false);
      void refetch();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to update job');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete job ${job.jobCode}?`)) return;
    try {
      await deleteJob.mutateAsync();
      notify('success', 'Job deleted successfully');
      navigate('/recruitment/jobs');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete job');
    }
  };

  return (
    <div>
      <PageHeader
        title={`${job.title} (${job.jobCode})`}
        subtitle={`${job.departmentName ?? 'Department'} · Status: ${job.status}`}
        actions={
          <div className="flex gap-2">
            <Link
              to={`/recruitment/candidates?jobId=${job.id}`}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View Candidates
            </Link>
            {canManage && !isEditing && (
              <button
                type="button"
                onClick={handleStartEdit}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
              >
                Edit Job
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
              >
                Delete
              </button>
            )}
          </div>
        }
      />

      {isEditing ? (
        <Card title="Edit Job Details">
          <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Job Title</label>
              <input
                type="text"
                required
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Openings</label>
                <input
                  type="number"
                  min={job.filledCount}
                  required
                  value={editOpenings}
                  onChange={(e) => setEditOpenings(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="Open">Open</option>
                  <option value="Filled">Filled</option>
                  <option value="Closed">Closed</option>
                  <option value="On Hold">On Hold</option>
                  <option value="Draft">Draft</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Description</label>
              <textarea
                rows={4}
                required
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateJob.isPending}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              >
                {updateJob.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-xs text-slate-500">Total Openings</p>
              <p className="text-xl font-bold text-slate-900">{job.openings}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500">Filled Count</p>
              <p className="text-xl font-bold text-emerald-600">{job.filledCount}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500">Remaining Positions</p>
              <p className="text-xl font-bold text-slate-700">{job.remainingOpenings}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500">Hiring Manager</p>
              <p className="text-sm font-semibold text-slate-900">{job.hiringManagerName ?? '—'}</p>
            </Card>
          </div>

          <Card title="Job Description & Requirements">
            <div className="space-y-4 text-sm text-slate-700 whitespace-pre-line">
              <p>{job.description}</p>
              {job.requiredSkills && job.requiredSkills.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Required Skills
                  </h4>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {job.requiredSkills.map((skill, idx) => (
                      <span
                        key={idx}
                        className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card title="Recruitment Timeline">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500">Opening Date</p>
                <p className="font-medium text-slate-800">{job.openingDate}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Closing Date</p>
                <p className="font-medium text-slate-800">{job.closingDate ?? 'Ongoing'}</p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
