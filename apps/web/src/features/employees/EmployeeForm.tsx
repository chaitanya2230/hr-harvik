import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import type { EmployeeDetail } from '../../api/types';
import { useCreateEmployee, useDepartments, useManagerOptions, useUpdateEmployee } from './api';
import { useAuth } from '../auth/auth-context';
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
  photoUrl: z.string().trim().url('Photo must be a valid URL').max(500).optional().or(z.literal('')),
  designation: z.string().trim().max(120).optional().or(z.literal('')),
  departmentId: z.string().optional().or(z.literal('')),
  reportingManagerId: z.string().optional().or(z.literal('')),
  employmentType: z.enum(['Full-Time', 'Intern', 'Freelancer', 'Contractor', 'Other']),
  dateOfJoining: z.string().trim().regex(DATE_ONLY, 'Use YYYY-MM-DD'),
  probationEndDate: z.string().trim().regex(DATE_ONLY, 'Use YYYY-MM-DD').optional().or(z.literal('')),
  addressLine1: z.string().trim().max(200).optional().or(z.literal('')),
  addressLine2: z.string().trim().max(200).optional().or(z.literal('')),
  addressCity: z.string().trim().max(120).optional().or(z.literal('')),
  addressState: z.string().trim().max(120).optional().or(z.literal('')),
  addressPostalCode: z.string().trim().max(20).optional().or(z.literal('')),
  addressCountry: z.string().trim().max(120).optional().or(z.literal('')),
  emergencyName: z.string().trim().max(120).optional().or(z.literal('')),
  emergencyRelation: z.string().trim().max(60).optional().or(z.literal('')),
  emergencyPhone: z
    .string()
    .trim()
    .max(32)
    .regex(/^\+?[\d(][\d\s()+.-]{4,}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  compensationAmount: z.coerce.number().min(0, 'Amount cannot be negative').optional(),
  compensationCurrency: z.string().trim().max(8).optional().or(z.literal('')),
  compensationPeriod: z.enum(['monthly', 'hourly', 'fixed']).optional().or(z.literal('')),
  bankAccountHolder: z.string().trim().max(120).optional().or(z.literal('')),
  bankAccountNumber: z.string().trim().min(4, 'Account number looks too short').max(64).optional().or(z.literal('')),
  bankIfscOrRouting: z.string().trim().max(64).optional().or(z.literal('')),
  bankName: z.string().trim().max(120).optional().or(z.literal('')),
  // §8.2 — "Creating employee can optionally create login". Presence of the
  // password is enforced in onSubmit; the policy mirrors the backend `loginSchema`.
  createLogin: z.boolean().optional().default(false),
  loginEmail: z.string().trim().toLowerCase().email('Enter a valid email address').optional().or(z.literal('')),
  loginPassword: z
    .string()
    .refine(
      (value) =>
        value === '' || (value.length >= 8 && /[0-9]/.test(value) && /[A-Za-z]/.test(value)),
      'At least 8 characters with one letter and one number',
    )
    .optional()
    .or(z.literal('')),
  loginRole: z.enum(['HR Admin', 'HR Manager', 'Manager', 'Employee']).optional().default('Employee'),
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
  if (values.photoUrl?.trim()) payload.photoUrl = values.photoUrl.trim();
  if (values.designation?.trim()) payload.designation = values.designation.trim();
  if (values.departmentId?.trim()) payload.departmentId = values.departmentId.trim();
  if (values.reportingManagerId?.trim()) payload.reportingManagerId = values.reportingManagerId.trim();
  if (values.probationEndDate?.trim()) payload.probationEndDate = values.probationEndDate.trim();

  const address: Record<string, string> = {};
  if (values.addressLine1?.trim()) address.line1 = values.addressLine1.trim();
  if (values.addressLine2?.trim()) address.line2 = values.addressLine2.trim();
  if (values.addressCity?.trim()) address.city = values.addressCity.trim();
  if (values.addressState?.trim()) address.state = values.addressState.trim();
  if (values.addressPostalCode?.trim()) address.postalCode = values.addressPostalCode.trim();
  if (values.addressCountry?.trim()) address.country = values.addressCountry.trim();
  if (Object.keys(address).length > 0) payload.address = address;

  const emergencyContact: Record<string, string> = {};
  if (values.emergencyName?.trim()) emergencyContact.name = values.emergencyName.trim();
  if (values.emergencyRelation?.trim()) emergencyContact.relation = values.emergencyRelation.trim();
  if (values.emergencyPhone?.trim()) emergencyContact.phone = values.emergencyPhone.trim();
  if (Object.keys(emergencyContact).length > 0) payload.emergencyContact = emergencyContact;

  const compensation: Record<string, unknown> = {};
  if (values.compensationAmount !== undefined) compensation.amount = values.compensationAmount;
  if (values.compensationCurrency?.trim()) compensation.currency = values.compensationCurrency.trim().toUpperCase();
  if (values.compensationPeriod?.trim()) compensation.period = values.compensationPeriod.trim();
  if (Object.keys(compensation).length > 0) payload.compensation = compensation;

  const bankDetails: Record<string, string> = {};
  if (values.bankAccountHolder?.trim()) bankDetails.accountHolder = values.bankAccountHolder.trim();
  if (values.bankAccountNumber?.trim()) bankDetails.accountNumber = values.bankAccountNumber.trim();
  if (values.bankIfscOrRouting?.trim()) bankDetails.ifscOrRouting = values.bankIfscOrRouting.trim();
  if (values.bankName?.trim()) bankDetails.bankName = values.bankName.trim();
  if (Object.keys(bankDetails).length > 0) payload.bankDetails = bankDetails;

  return payload;
};

export function EmployeeForm({ initial }: { initial?: EmployeeDetail }) {
  const navigate = useNavigate();
  const notify = useToast();
  const { account } = useAuth();
  const isEdit = Boolean(initial);
  const isHrAdmin = account?.role === 'HR Admin';

  const departmentsQuery = useDepartments();
  const managersQuery = useManagerOptions();
  const createMutation = useCreateEmployee();
  const updateMutation = useUpdateEmployee(initial?.id ?? '');

  const {
    register,
    watch,
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
      photoUrl: initial?.photoUrl ?? '',
      designation: initial?.designation ?? '',
      departmentId: initial?.department?.id ?? '',
      reportingManagerId: initial?.reportingManager?.id ?? '',
      employmentType: initial?.employmentType ?? 'Full-Time',
      dateOfJoining: initial?.dateOfJoining ?? '',
      probationEndDate: initial?.probationEndDate ?? '',
      addressLine1: initial?.address?.line1 ?? '',
      addressLine2: initial?.address?.line2 ?? '',
      addressCity: initial?.address?.city ?? '',
      addressState: initial?.address?.state ?? '',
      addressPostalCode: initial?.address?.postalCode ?? '',
      addressCountry: initial?.address?.country ?? '',
      emergencyName: initial?.emergencyContact?.name ?? '',
      emergencyRelation: initial?.emergencyContact?.relation ?? '',
      emergencyPhone: initial?.emergencyContact?.phone ?? '',
      compensationAmount: initial?.compensation?.amount,
      compensationCurrency: initial?.compensation?.currency ?? '',
      compensationPeriod: (initial?.compensation?.period as 'monthly' | 'hourly' | 'fixed' | '' | undefined) ?? '',
      bankAccountHolder: initial?.bankDetails?.accountHolder ?? '',
      bankAccountNumber: '',
      bankIfscOrRouting: initial?.bankDetails?.ifscOrRouting ?? '',
      bankName: initial?.bankDetails?.bankName ?? '',
      createLogin: false,
      loginEmail: '',
      loginPassword: '',
      loginRole: 'Employee',
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
        const payload = toPayload(values);
        // §8.2 — optional login created together with the employee. The backend
        // re-validates the password policy, uniqueness and role permissions.
        if (values.createLogin) {
          if (!values.loginPassword) {
            notify('error', 'Enter a temporary password for the new login');
            return;
          }
          payload.createLogin = {
            email: values.loginEmail?.trim() || values.email,
            password: values.loginPassword,
            role: values.loginRole ?? 'Employee',
          };
        }
        const created = await createMutation.mutateAsync(payload);
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
            <div>
              <label htmlFor="photoUrl" className={labelClass}>Profile photo URL</label>
              <input id="photoUrl" type="url" {...register('photoUrl')} placeholder="https://…" className={fieldClass} />
              {errors.photoUrl ? <p className="mt-1 text-xs text-red-600">{errors.photoUrl.message}</p> : null}
            </div>
          </div>
        </Card>

        <Card title="Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="addressLine1" className={labelClass}>Address line 1</label>
              <input id="addressLine1" {...register('addressLine1')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="addressLine2" className={labelClass}>Address line 2</label>
              <input id="addressLine2" {...register('addressLine2')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="addressCity" className={labelClass}>City</label>
              <input id="addressCity" {...register('addressCity')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="addressState" className={labelClass}>State</label>
              <input id="addressState" {...register('addressState')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="addressPostalCode" className={labelClass}>Postal code</label>
              <input id="addressPostalCode" {...register('addressPostalCode')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="addressCountry" className={labelClass}>Country</label>
              <input id="addressCountry" {...register('addressCountry')} className={fieldClass} />
            </div>
          </div>
        </Card>

        <Card title="Emergency contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="emergencyName" className={labelClass}>Name</label>
              <input id="emergencyName" {...register('emergencyName')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="emergencyRelation" className={labelClass}>Relation</label>
              <input id="emergencyRelation" {...register('emergencyRelation')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="emergencyPhone" className={labelClass}>Phone</label>
              <input id="emergencyPhone" {...register('emergencyPhone')} className={fieldClass} />
              {errors.emergencyPhone ? <p className="mt-1 text-xs text-red-600">{errors.emergencyPhone.message}</p> : null}
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

        <Card title="Compensation">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="compensationAmount" className={labelClass}>Amount</label>
              <input id="compensationAmount" type="number" min={0} step="any" {...register('compensationAmount')} className={fieldClass} />
              {errors.compensationAmount ? <p className="mt-1 text-xs text-red-600">{errors.compensationAmount.message}</p> : null}
            </div>
            <div>
              <label htmlFor="compensationCurrency" className={labelClass}>Currency</label>
              <input id="compensationCurrency" {...register('compensationCurrency')} placeholder="INR" className={fieldClass} />
            </div>
            <div>
              <label htmlFor="compensationPeriod" className={labelClass}>Period</label>
              <select id="compensationPeriod" {...register('compensationPeriod')} className={fieldClass}>
                <option value="">Select…</option>
                <option value="monthly">Monthly</option>
                <option value="hourly">Hourly</option>
                <option value="fixed">Fixed</option>
              </select>
            </div>
          </div>
        </Card>

        <Card title="Bank details">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="bankAccountHolder" className={labelClass}>Account holder</label>
              <input id="bankAccountHolder" {...register('bankAccountHolder')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="bankAccountNumber" className={labelClass}>
                Account number{isEdit ? ' (leave blank to keep existing)' : ''}
              </label>
              <input id="bankAccountNumber" {...register('bankAccountNumber')} autoComplete="off" className={fieldClass} />
              {errors.bankAccountNumber ? <p className="mt-1 text-xs text-red-600">{errors.bankAccountNumber.message}</p> : null}
            </div>
            <div>
              <label htmlFor="bankIfscOrRouting" className={labelClass}>IFSC / routing</label>
              <input id="bankIfscOrRouting" {...register('bankIfscOrRouting')} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="bankName" className={labelClass}>Bank name</label>
              <input id="bankName" {...register('bankName')} className={fieldClass} />
            </div>
          </div>
        </Card>

        {!isEdit && (
          <Card title="Login account">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                {...register('createLogin')}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                <span className="text-sm font-medium text-slate-700">Create a login now</span>
                <span className="block text-xs text-slate-500">
                  The person can sign in immediately — share the temporary password securely.
                </span>
              </span>
            </label>
            {watch('createLogin') ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="loginEmail" className={labelClass}>Login email</label>
                  <input
                    id="loginEmail"
                    type="email"
                    placeholder="Defaults to the employee email"
                    {...register('loginEmail')}
                    className={fieldClass}
                  />
                  {errors.loginEmail ? (
                    <p className="mt-1 text-xs text-red-600">{errors.loginEmail.message}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="loginPassword" className={labelClass}>
                    Temporary password *
                  </label>
                  <input
                    id="loginPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Min 8 chars, 1 letter + 1 number"
                    {...register('loginPassword')}
                    className={fieldClass}
                  />
                  {errors.loginPassword ? (
                    <p className="mt-1 text-xs text-red-600">{errors.loginPassword.message}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="loginRole" className={labelClass}>Role</label>
                  <select id="loginRole" {...register('loginRole')} className={fieldClass}>
                    {(isHrAdmin
                      ? ['HR Admin', 'HR Manager', 'Manager', 'Employee']
                      : ['Manager', 'Employee']
                    ).map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    {isHrAdmin
                      ? 'HR Admins can grant any role.'
                      : 'Only HR Admins can create HR Admin logins.'}
                  </p>
                </div>
              </div>
            ) : null}
          </Card>
        )}

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
