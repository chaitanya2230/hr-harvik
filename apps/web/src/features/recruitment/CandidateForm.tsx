import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { Card, LoadingState, PageHeader } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useCreateCandidate, useJobs } from './api';

/** Resume MIME whitelist mirroring the backend `resume.service` (§8.3). */
const RESUME_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** Mirrors the backend's default `MAX_UPLOAD_MB=10`. */
const RESUME_MAX_BYTES = 10 * 1024 * 1024;

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
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeError, setResumeError] = useState('');

  if (jobsQuery.isPending) return <LoadingState label="Loading available positions…" />;

  const handleResumeSelect = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0] ?? null;
    setResumeError('');
    if (!file) {
      setResumeFile(null);
      return;
    }
    if (!RESUME_MIME_TYPES.includes(file.type)) {
      setResumeError('Unsupported file type. Upload a PDF, DOC or DOCX.');
      setResumeFile(null);
      event.target.value = '';
      return;
    }
    if (file.size > RESUME_MAX_BYTES) {
      setResumeError('File exceeds the 10 MB upload limit.');
      setResumeFile(null);
      event.target.value = '';
      return;
    }
    setResumeFile(file);
  };

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

      // §8.3 — resume attached as part of creation. The backend create endpoint
      // is JSON-only, so the file is posted to the resume endpoint right after.
      if (resumeFile) {
        try {
          const formData = new FormData();
          formData.append('resume', resumeFile);
          await apiRequest(`/recruitment/candidates/${res.data.id}/resume`, {
            method: 'POST',
            body: formData,
          });
          notify('success', 'Candidate registered with resume');
        } catch {
          notify(
            'error',
            'Candidate registered, but the resume upload failed — add it from the candidate page.',
          );
        }
      } else {
        notify('success', 'Candidate profile registered successfully');
      }
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

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Resume (optional — PDF, DOC or DOCX, max 10 MB)
            </label>
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={handleResumeSelect}
              className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            {resumeError ? (
              <p className="mt-1 text-xs text-rose-600" role="alert">
                {resumeError}
              </p>
            ) : resumeFile ? (
              <p className="mt-1 text-xs text-slate-500">📎 {resumeFile.name}</p>
            ) : null}
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
