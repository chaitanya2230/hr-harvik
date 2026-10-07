import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../../components/ui';
import { useAuth } from '../auth/auth-context';
import { useEmployeeList } from '../employees/api';
import {
  useCreateUser,
  useResetUserPassword,
  useSettings,
  useUpdateSettings,
  useUpdateUser,
  useUserList,
  type SystemSettings,
  type UserRow,
  type UserRole,
} from './api';

/**
 * AGENTS.md §9 — `/settings`: system configuration (company, timezone,
 * employment rules) plus user/role management (§6 "HR Admin → manage users /
 * manage roles / system settings").
 *
 * Frontend validation mirrors the backend Zod schemas exactly; the backend
 * remains authoritative (`manageSettings` / `manageUsers` gates every write).
 */

const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const systemSettingsSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(120),
  timezone: z
    .string()
    .trim()
    .min(1, 'Timezone is required')
    .max(64)
    .refine(isValidTimezone, 'Must be a valid IANA timezone such as Asia/Kolkata'),
  minAgeIntern: z.coerce
    .number()
    .int('Use a whole number')
    .min(10, 'Minimum age must be at least 10')
    .max(60, 'Maximum age is 60'),
  minAgeOther: z.coerce
    .number()
    .int('Use a whole number')
    .min(10, 'Minimum age must be at least 10')
    .max(60, 'Maximum age is 60'),
  probationDefault: z.boolean(),
});

type SystemSettingsValues = z.infer<typeof systemSettingsSchema>;

const passwordPolicy = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter');

const createUserSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(200, 'Email must be at most 200 characters'),
  password: passwordPolicy,
  role: z.enum(['HR Admin', 'HR Manager', 'Manager', 'Employee']),
  employeeId: z.string().regex(/^[a-f\d]{24}$/i, 'Choose a valid employee'),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

const resetPasswordSchema = z
  .object({
    password: passwordPolicy,
    confirm: z.string().min(1, 'Confirm the new password'),
  })
  .refine((values) => values.password === values.confirm, {
    message: 'Passwords must match',
    path: ['confirm'],
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

const fieldClass =
  'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500';
const labelClass = 'block text-sm font-medium text-slate-700';
const primaryButton =
  'rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButton =
  'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60';
const destructiveButton =
  'rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60';

const ROLE_OPTIONS: UserRole[] = ['HR Admin', 'HR Manager', 'Manager', 'Employee'];

function RoleBadge({ role }: { role: UserRole }) {
  const tone: Record<UserRole, string> = {
    'HR Admin': 'bg-purple-100 text-purple-800',
    'HR Manager': 'bg-blue-100 text-blue-800',
    Manager: 'bg-amber-100 text-amber-800',
    Employee: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone[role]}`}>
      {role}
    </span>
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SystemSettingsForm({ initial }: { initial: SystemSettings }) {
  const notify = useToast();
  const updateMutation = useUpdateSettings();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SystemSettingsValues>({
    resolver: zodResolver(systemSettingsSchema),
    defaultValues: initial,
  });

  const onSubmit = async (values: SystemSettingsValues): Promise<void> => {
    try {
      await updateMutation.mutateAsync(values);
      notify('success', 'Settings saved');
    } catch (caught) {
      notify(
        'error',
        caught instanceof ApiError ? caught.message : 'Saving settings failed. Please try again.',
      );
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} className="space-y-6" noValidate>
      <Card title="Company">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="companyName" className={labelClass}>
              Company name *
            </label>
            <input id="companyName" {...register('companyName')} className={fieldClass} />
            {errors.companyName ? (
              <p className="mt-1 text-xs text-red-600">{errors.companyName.message}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="timezone" className={labelClass}>
              Timezone (IANA) *
            </label>
            <input
              id="timezone"
              placeholder="Asia/Kolkata"
              {...register('timezone')}
              className={fieldClass}
            />
            <p className="mt-1 text-xs text-slate-500">
              Used for dates, holidays and reminder schedules.
            </p>
            {errors.timezone ? (
              <p className="mt-1 text-xs text-red-600">{errors.timezone.message}</p>
            ) : null}
          </div>
        </div>
      </Card>

      <Card title="Employment rules">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="minAgeIntern" className={labelClass}>
              Minimum age — Intern *
            </label>
            <input
              id="minAgeIntern"
              type="number"
              min={10}
              max={60}
              {...register('minAgeIntern')}
              className={fieldClass}
            />
            <p className="mt-1 text-xs text-slate-500">AGENTS.md §8.2: Intern age ≥ 16.</p>
            {errors.minAgeIntern ? (
              <p className="mt-1 text-xs text-red-600">{errors.minAgeIntern.message}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="minAgeOther" className={labelClass}>
              Minimum age — other types *
            </label>
            <input
              id="minAgeOther"
              type="number"
              min={10}
              max={60}
              {...register('minAgeOther')}
              className={fieldClass}
            />
            <p className="mt-1 text-xs text-slate-500">
              Applies to Full-Time, Freelancer, Contractor and Other.
            </p>
            {errors.minAgeOther ? (
              <p className="mt-1 text-xs text-red-600">{errors.minAgeOther.message}</p>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                {...register('probationDefault')}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                <span className="text-sm font-medium text-slate-700">
                  Start Full-Time hires on Probation
                </span>
                <span className="block text-xs text-slate-500">
                  When on, new Full-Time employees are created with status Probation instead of
                  Active.
                </span>
              </span>
            </label>
          </div>
        </div>
      </Card>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting || updateMutation.isPending}
          className={primaryButton}
        >
          {isSubmitting || updateMutation.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

function SystemSettingsSection() {
  const settingsQuery = useSettings();

  if (settingsQuery.isPending) return <LoadingState label="Loading settings…" />;
  if (settingsQuery.isError) {
    return <ErrorState error={settingsQuery.error} onRetry={() => void settingsQuery.refetch()} />;
  }
  return <SystemSettingsForm initial={settingsQuery.data.data} />;
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const notify = useToast();
  const createMutation = useCreateUser();
  const employeeQuery = useEmployeeList({ page: 1, limit: 100 });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', password: '', role: 'Employee', employeeId: '' },
  });

  const onSubmit = async (values: CreateUserValues): Promise<void> => {
    try {
      await createMutation.mutateAsync({
        email: values.email,
        password: values.password,
        role: values.role,
        ...(values.employeeId ? { employeeId: values.employeeId } : {}),
      });
      notify('success', `Login created for ${values.email}`);
      onClose();
    } catch (caught) {
      notify(
        'error',
        caught instanceof ApiError ? caught.message : 'Creating the login failed.',
      );
    }
  };

  return (
    <Dialog title="Add user login" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} className="space-y-4" noValidate>
        <div>
          <label htmlFor="new-email" className={labelClass}>
            Email *
          </label>
          <input id="new-email" type="email" autoComplete="off" {...register('email')} className={fieldClass} />
          {errors.email ? <p className="mt-1 text-xs text-red-600">{errors.email.message}</p> : null}
        </div>
        <div>
          <label htmlFor="new-password" className={labelClass}>
            Temporary password *
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            {...register('password')}
            className={fieldClass}
          />
          <p className="mt-1 text-xs text-slate-500">
            At least 8 characters with one letter and one number.
          </p>
          {errors.password ? (
            <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="new-role" className={labelClass}>
            Role *
          </label>
          <select id="new-role" {...register('role')} className={fieldClass}>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          {errors.role ? <p className="mt-1 text-xs text-red-600">{errors.role.message}</p> : null}
        </div>
        <div>
          <label htmlFor="new-employee" className={labelClass}>
            Link to employee
          </label>
          <select id="new-employee" {...register('employeeId')} className={fieldClass}>
            <option value="">Not linked</option>
            {employeeQuery.data?.data.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName} ({emp.employeeCode})
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Linking gives the person access to their own HR data.
          </p>
          {errors.employeeId ? (
            <p className="mt-1 text-xs text-red-600">{errors.employeeId.message}</p>
          ) : null}
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={isSubmitting || createMutation.isPending}
            className={primaryButton}
          >
            {isSubmitting || createMutation.isPending ? 'Creating…' : 'Create login'}
          </button>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({ row, onClose }: { row: UserRow; onClose: () => void }) {
  const notify = useToast();
  const resetMutation = useResetUserPassword(row.id);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = async (values: ResetPasswordValues): Promise<void> => {
    try {
      await resetMutation.mutateAsync({ password: values.password });
      notify('success', `Password reset for ${row.email}`);
      onClose();
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Password reset failed.');
    }
  };

  return (
    <Dialog title={`Reset password — ${row.email}`} onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} className="space-y-4" noValidate>
        <div>
          <label htmlFor="reset-password" className={labelClass}>
            New password *
          </label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            {...register('password')}
            className={fieldClass}
          />
          {errors.password ? (
            <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="reset-confirm" className={labelClass}>
            Confirm password *
          </label>
          <input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            {...register('confirm')}
            className={fieldClass}
          />
          {errors.confirm ? (
            <p className="mt-1 text-xs text-red-600">{errors.confirm.message}</p>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Resetting also signs the user out of any active sessions.
        </p>
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={isSubmitting || resetMutation.isPending}
            className={primaryButton}
          >
            {isSubmitting || resetMutation.isPending ? 'Resetting…' : 'Reset password'}
          </button>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function UserRowActions({ row, selfUserId }: { row: UserRow; selfUserId: string }) {
  const notify = useToast();
  const updateMutation = useUpdateUser(row.id);
  const [showReset, setShowReset] = useState(false);
  const isSelf = row.id === selfUserId;

  const showError = (caught: unknown, fallback: string): void => {
    notify('error', caught instanceof ApiError ? caught.message : fallback);
  };

  const handleRoleChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ): void => {
    const next = event.target.value as UserRole;
    if (next === row.role) return;
    if (!isSelf && !confirm(`Change the role of ${row.email} to "${next}"?`)) {
      event.target.value = row.role;
      return;
    }
    updateMutation
      .mutateAsync({ role: next })
      .then(() => notify('success', `Role updated to ${next}`))
      .catch((caught: unknown) => {
        event.target.value = row.role;
        showError(caught, 'Role change failed');
      });
  };

  const handleToggleActive = (): void => {
    if (row.isActive && !confirm(`Disable the login for ${row.email}?`)) return;
    updateMutation
      .mutateAsync({ isActive: !row.isActive })
      .then(() =>
        notify('success', row.isActive ? `Login disabled for ${row.email}` : `Login re-enabled for ${row.email}`),
      )
      .catch((caught: unknown) => showError(caught, 'Update failed'));
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor={`role-${row.id}`}>
          Role for {row.email}
        </label>
        <select
          id={`role-${row.id}`}
          value={row.role}
          disabled={isSelf || updateMutation.isPending}
          onChange={handleRoleChange}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={isSelf || updateMutation.isPending}
          onClick={handleToggleActive}
          className={row.isActive ? destructiveButton : secondaryButton}
          title={isSelf ? 'You cannot disable your own login' : undefined}
        >
          {row.isActive ? 'Disable' : 'Enable'}
        </button>
        <button
          type="button"
          disabled={updateMutation.isPending}
          onClick={() => setShowReset(true)}
          className={secondaryButton}
        >
          Reset password
        </button>
      </div>
      {showReset ? <ResetPasswordDialog row={row} onClose={() => setShowReset(false)} /> : null}
    </>
  );
}

function UsersSection({ selfUserId }: { selfUserId: string }) {
  const [search, setSearch] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | UserRole>('');
  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const limit = 20;

  const listQuery = useUserList({
    page,
    limit,
    ...(appliedQuery ? { q: appliedQuery } : {}),
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(activeFilter ? { isActive: activeFilter === 'true' } : {}),
  });

  const total = listQuery.data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const rows = listQuery.data?.data ?? [];
  const hasFilters = Boolean(appliedQuery || roleFilter || activeFilter);

  const applyFilters = (event: React.FormEvent): void => {
    event.preventDefault();
    setAppliedQuery(search.trim());
    setPage(1);
  };

  const clearFilters = (): void => {
    setSearch('');
    setAppliedQuery('');
    setRoleFilter('');
    setActiveFilter('');
    setPage(1);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-2" role="search">
          <div>
            <label htmlFor="user-q" className="block text-xs font-medium text-slate-600">
              Search
            </label>
            <input
              id="user-q"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Email or name"
              className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500"
            />
          </div>
          <div>
            <label htmlFor="user-role" className="block text-xs font-medium text-slate-600">
              Role
            </label>
            <select
              id="user-role"
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value as '' | UserRole);
                setPage(1);
              }}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
            >
              <option value="">All roles</option>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="user-active" className="block text-xs font-medium text-slate-600">
              Status
            </label>
            <select
              id="user-active"
              value={activeFilter}
              onChange={(event) => {
                setActiveFilter(event.target.value as '' | 'true' | 'false');
                setPage(1);
              }}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
            >
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Disabled</option>
            </select>
          </div>
          <button type="submit" className={secondaryButton}>
            Search
          </button>
          {hasFilters ? (
            <button type="button" onClick={clearFilters} className={secondaryButton}>
              Clear
            </button>
          ) : null}
        </form>
        <button type="button" onClick={() => setShowCreate(true)} className={primaryButton}>
          Add user
        </button>
      </div>

      {listQuery.isPending ? (
        <LoadingState label="Loading users…" />
      ) : listQuery.isError ? (
        <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No users found"
          hint={hasFilters ? 'Try different search filters.' : undefined}
        />
      ) : (
        <Card>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th scope="col" className="px-4 py-2.5">
                  Email
                </th>
                <th scope="col" className="px-4 py-2.5">
                  Employee
                </th>
                <th scope="col" className="px-4 py-2.5">
                  Role
                </th>
                <th scope="col" className="px-4 py-2.5">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5">
                  Last login
                </th>
                <th scope="col" className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="text-slate-700">
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {row.email}
                    {row.id === selfUserId ? (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.employee ? (
                      <span>
                        {row.employee.name}{' '}
                        <span className="text-xs text-slate-400">{row.employee.employeeCode}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Not linked</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <RoleBadge role={row.role} />
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={row.isActive ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-2.5">
                    <UserRowActions row={row} selfUserId={selfUserId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <nav aria-label="User pagination" className="mt-4 flex items-center justify-between text-sm">
            <p className="text-slate-500">
              {total} user{total === 1 ? '' : 's'} · Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className={secondaryButton}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
                className={secondaryButton}
              >
                Next
              </button>
            </div>
          </nav>
        </Card>
      )}

      {showCreate ? <CreateUserDialog onClose={() => setShowCreate(false)} /> : null}
    </div>
  );
}

export function SettingsPage() {
  const { account } = useAuth();
  const canManageUsers = account?.permissions.includes('manageUsers') ?? false;
  const [tab, setTab] = useState<'system' | 'users'>('system');

  const activeTab: 'system' | 'users' = tab === 'users' && !canManageUsers ? 'system' : tab;

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="System configuration, employment rules and account management"
      />

      <div role="tablist" aria-label="Settings sections" className="mb-4 flex gap-1 border-b border-slate-200">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'system'}
          onClick={() => setTab('system')}
          className={`rounded-t-md px-4 py-2 text-sm font-medium ${
            activeTab === 'system'
              ? 'border-b-2 border-brand-600 text-brand-700'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          System
        </button>
        {canManageUsers ? (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'users'}
            onClick={() => setTab('users')}
            className={`rounded-t-md px-4 py-2 text-sm font-medium ${
              activeTab === 'users'
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Users &amp; roles
          </button>
        ) : null}
      </div>

      <div role="tabpanel">
        {activeTab === 'system' ? (
          <SystemSettingsSection />
        ) : (
          <UsersSection selfUserId={account?.userId ?? ''} />
        )}
      </div>
    </div>
  );
}
