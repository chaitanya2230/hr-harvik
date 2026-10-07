import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, LoadingState, PageHeader } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useCreateCandidate, useJobs } from './api';

export function CandidateForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const notify = useToast();
  const createCandidate = useCreateCandidate();

  const jobsQuery = useJobs({ limit: 100, status: 'Open' });
  const jobs = jobsQuery.data?.data ?? [];

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobId, setJobId] = useState(searchParams.get('jobId') ?? '');
  const [source, setSource] = useState<'LinkedIn' | 'Referral' | 'Website' | 'Agency' | 'Other'>('LinkedIn');
  const [joiningDate, setJoiningDate] = useState('');

  if (jobsQuery.isPending) return <LoadingState label="Loading available positions…" />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobId) {
      notify('error', 'Please select a job opening');
      return;
    }

    try {
      const res = await createCandidate.mutateAsync({
        name,
        email,
        phone,
        jobId,
        source,
        joiningDate: joiningDate || null,
      });
      notify('success', 'Candidate profile registered successfully');
      navigate(`/recruitment/candidates/${res.data.id}`);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to create candidate');
    }
  };

  return (
    <div>
      <PageHeader title="Add Candidate" subtitle="Register a new applicant in the recruitment pipeline" />

      <Card>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Candidate Full Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Priya Sharma"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Email Address *</label>
              <input
                type="email"
                required
                placeholder="priya.sharma@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Phone Number *</label>
              <input
                type="tel"
                required
                placeholder="+91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Target Job Opening *</label>
              <select
                required
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.jobCode} - {j.title} ({j.departmentName})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Source *</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as 'LinkedIn' | 'Referral' | 'Website' | 'Agency' | 'Other')}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="LinkedIn">LinkedIn</option>
                <option value="Referral">Referral</option>
                <option value="Website">Website</option>
                <option value="Agency">Agency</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Anticipated Joining Date (Optional)
              </label>
              <input
                type="date"
                value={joiningDate}
                onChange={(e) => setJoiningDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => navigate('/recruitment/candidates')}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createCandidate.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {createCandidate.isPending ? 'Registering…' : 'Register Candidate'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
