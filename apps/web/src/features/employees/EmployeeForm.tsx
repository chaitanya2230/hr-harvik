import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import type { EmployeeDetail } from '../../api/types';
import { useCreateEmployee, useDepartments, useManagerOptions, useUpdateEmployee } from './api';
import { useToast } from '../../components/Toast';
import { Card, ErrorState, LoadingState, PageHeader } from '../../components/ui';

/**
 * AGENTS.md §9 — employee create/edit form. The Zod schema mirrors the backend
 * `createEmployeeSchema`/`updateEmployeeSchema` so invalid input is rejected
 * before it ever leaves the browser; the backend re-validates authoritatively.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const employeeFormSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^\+?[\d(][\d\s()+.-]{4,}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  dob: z.string().trim().regex(DATE_ONLY, 'Use YYYY-MM-DD').optional().or(z.literal('')),
  designation: z.string().trim().max(120).optional().or(z.literal('')),
  departmentId: z.string().optional().or(z.literal('')),
  reportingManagerId: z.string().optional().or(z.literal('')),
  employmentType: z.enum(['Full-Time', 'Intern', 'Freelancer', 'Contractor', 'Other']),
  dateOfJoining: z.string().trim().regex(DATE_ONLY, 'Use YYYY-MM-DD'),
  probationEndDate: z.string().trim().regex(DATE_ONLY, 'Use YYYY-MM-DD').optional().or(z.literal('')),
});

type EmployeeFormValues = z.infer<typeof employeeFormSchema>;

const fieldClass =
  'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500';
const labelClass = 'block text-sm font-medium text-slate-700';

const toPayload = (values: EmployeeFormValues): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    email: values.email.trim().toLowerCase(),
    employmentType: values.employmentType,
    dateOfJoining: values.dateOfJoining,
  };
  if (values.phone?.trim()) payload.phone = values.phone.trim();
  if (values.dob?.trim()) payload.dob = values.dob.trim();
  if (values.designation?.trim()) payload.designation = values.designation.trim();
  if (values.departmentId?.trim()) payload.departmentId = values.departmentId.trim();
  if (values.reportingManagerId?.trim()) payload.reportingManagerId = values.reportingManagerId.trim();
  if (values.probationEndDate?.trim()) payload.probationEndDate = values.probationEndDate.trim();
  return payload;
};

export function EmployeeForm({ initial }: { initial?: EmployeeDetail }) {
  const navigate = useNavigate();
  const notify = useToast();
  const isEdit = Boolean(initial);

  const departmentsQuery = useDepartments();
  const managersQuery = useManagerOptions();
  const createMutation = useCreateEmployee();
  const updateMutation = useUpdateEmployee(initial?.id ?? '');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      firstName: initial?.firstName ?? '',
      lastName: initial?.lastName ?? '',
      email: initial?.email ?? '',
      phone: initial?.phone ?? '',
      dob: initial?.dob ?? '',
      designation: initial?.designation ?? '',
      departmentId: initial?.department?.id ?? '',
      reportingManagerId: initial?.reportingManager?.id ?? '',
      employmentType: initial?.employmentType ?? 'Full-Time',
      dateOfJoining: initial?.dateOfJoining ?? '',
      probationEndDate: initial?.probationEndDate ?? '',
    },
  });

  const mutationError =
    createMutation.error ?? updateMutation.error ?? null;

  const onSubmit = async (values: EmployeeFormValues): Promise<void> => {
    try {
      if (isEdit && initial) {
        await updateMutation.mutateAsync(toPayload(values));
        notify('success', 'Employee updated');
        navigate(`/employees/${initial.id}`);
      } else {
        const created = await createMutation.mutateAsync(toPayload(values));
        notify('success', `Employee ${created.data.employeeCode} created`);
        navigate(`/employees/${created.data.id}`);
      }
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Save failed. Please try again.');
    }
  };

  const onInvalid = (fieldErrors: FieldErrors<EmployeeFormValues>): void => {
    const first = Object.values(fieldErrors)[0]?.message;
    if (typeof first === 'string') notify('error', first);
  };

  if (departmentsQuery.isPending || managersQuery.isPending) {
    return <LoadingState label="Loading form options…" />;
  }

  if (departmentsQuery.isError || managersQuery.isError) {
    return (
      <ErrorState
        error={departmentsQuery.error ?? managersQuery.error}
        onRetry={() => {
          void departmentsQuery.refetch();
          void managersQuery.refetch();
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader title={isEdit ? 'Edit employee' : 'Add employee'} />

      {mutationError ? <ErrorState error={mutationError} /> : null}

      <form
        onSubmit={(event) => void handleSubmit(onSubmit, onInvalid)(event)}
        className="space-y-6"
        noValidate
      >
        <Card title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="firstName" className={labelClass}>First name *</label>
              <input id="firstName" {...register('firstName')} className={fieldClass} />
              {errors.firstName ? <p className="mt-1 text-xs text-red-600">{errors.firstName.message}</p> : null}
            </div>
            <div>
              <label htmlFor="lastName" className={labelClass}>Last name *</label>
              <input id="lastName" {...register('lastName')} className={fieldClass} />
              {errors.lastName ? <p className="mt-1 text-xs text-red-600">{errors.lastName.message}</p> : null}
            </div>
            <div>
              <label htmlFor="email" className={labelClass}>Work email *</label>
              <input id="email" type="email" {...register('email')} className={fieldClass} />
              {errors.email ? <p className="mt-1 text-xs text-red-600">{errors.email.message}</p> : null}
            </div>
            <div>
              <label htmlFor="phone" className={labelClass}>Phone</label>
              <input id="phone" {...register('phone')} placeholder="+91 98000 10001" className={fieldClass} />
              {errors.phone ? <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p> : null}
            </div>
            <div>
              <label htmlFor="dob" className={labelClass}>Date of birth</label>
              <input id="dob" type="date" {...register('dob')} className={fieldClass} />
              {errors.dob ? <p className="mt-1 text-xs text-red-600">{errors.dob.message}</p> : null}
            </div>
          </div>
        </Card>

        <Card title="Employment">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="designation" className={labelClass}>Designation</label>
              <input id="designation" {...register('designation')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="employmentType" className={labelClass}>Employment type *</label>
              <select id="employmentType" {...register('employmentType')} className={fieldClass}>
                <option value="Full-Time">Full-Time</option>
                <option value="Intern">Intern</option>
                <option value="Freelancer">Freelancer</option>
                <option value="Contractor">Contractor</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="departmentId" className={labelClass}>Department</label>
              <select id="departmentId" {...register('departmentId')} className={fieldClass}>
                <option value="">No department</option>
                {departmentsQuery.data.data.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="reportingManagerId" className={labelClass}>Reporting manager</label>
              <select id="reportingManagerId" {...register('reportingManagerId')} className={fieldClass}>
                <option value="">No manager</option>
                {managersQuery.data.data.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.fullName} ({option.employeeCode})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dateOfJoining" className={labelClass}>Date of joining *</label>
              <input id="dateOfJoining" type="date" {...register('dateOfJoining')} className={fieldClass} />
              {errors.dateOfJoining ? <p className="mt-1 text-xs text-red-600">{errors.dateOfJoining.message}</p> : null}
            </div>
            <div>
              <label htmlFor="probationEndDate" className={labelClass}>Probation end date</label>
              <input id="probationEndDate" type="date" {...register('probationEndDate')} className={fieldClass} />
              {errors.probationEndDate ? <p className="mt-1 text-xs text-red-600">{errors.probationEndDate.message}</p> : null}
            </div>
          </div>
        </Card>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting || createMutation.isPending || updateMutation.isPending
              ? 'Saving…'
              : isEdit
                ? 'Save changes'
                : 'Create employee'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
