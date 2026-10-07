import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, LoadingState, PageHeader } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDepartments, useManagerOptions } from '../employees/api';
import { useCreateJob } from './api';
import type { Job } from './types';

export function JobForm() {
  const navigate = useNavigate();
  const notify = useToast();
  const createJob = useCreateJob();
  const departmentsQuery = useDepartments();
  const managersQuery = useManagerOptions();

  const [title, setTitle] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [hiringManagerId, setHiringManagerId] = useState('');
  const [openings, setOpenings] = useState(1);
  const [description, setDescription] = useState('');
  const [skillsStr, setSkillsStr] = useState('');
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().split('T')[0]);
  const [closingDate, setClosingDate] = useState('');
  const [status, setStatus] = useState('Open');

  if (departmentsQuery.isPending || managersQuery.isPending) {
    return <LoadingState label="Loading options…" />;
  }

  const departments = departmentsQuery.data?.data ?? [];
  const managers = managersQuery.data?.data ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!departmentId) {
      notify('error', 'Please select a department');
      return;
    }
    if (!hiringManagerId) {
      notify('error', 'Please select a hiring manager');
      return;
    }

    const skills = skillsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await createJob.mutateAsync({
        title,
        departmentId,
        hiringManagerId,
        openings,
        description,
        requiredSkills: skills,
        openingDate,
        closingDate: closingDate || null,
        status: status as Job['status'],
      });
      notify('success', 'Job created successfully');
      navigate(`/recruitment/jobs/${res.data.id}`);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to create job');
    }
  };

  return (
    <div>
      <PageHeader title="Post New Job Opening" subtitle="Create a new requisition" />

      <Card>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Job Title *</label>
            <input
              type="text"
              required
              placeholder="e.g. Senior Frontend Engineer"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Department *</label>
              <select
                required
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Hiring Manager *</label>
              <select
                required
                value={hiringManagerId}
                onChange={(e) => setHiringManagerId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select hiring manager</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName} ({m.designation ?? 'Manager'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Number of Openings *</label>
              <input
                type="number"
                min={1}
                max={500}
                required
                value={openings}
                onChange={(e) => setOpenings(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="Open">Open</option>
                <option value="Draft">Draft</option>
                <option value="On Hold">On Hold</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Opening Date *</label>
              <input
                type="date"
                required
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Closing Date (Optional)</label>
              <input
                type="date"
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Required Skills (comma-separated)
            </label>
            <input
              type="text"
              placeholder="e.g. React, TypeScript, Tailwind, GraphQL"
              value={skillsStr}
              onChange={(e) => setSkillsStr(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Description *</label>
            <textarea
              rows={5}
              required
              placeholder="Detailed description of the role, responsibilities, and qualifications..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => navigate('/recruitment/jobs')}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createJob.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {createJob.isPending ? 'Publishing…' : 'Publish Job'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
