import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEmployeeList, type EmployeeListParams } from './api';
import { useAuth } from '../auth/auth-context';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../../components/ui';

/**
 * AGENTS.md §9 — employee directory with server-side pagination, sorting and
 * filtering. Every control maps to a backend query parameter; nothing is
 * filtered client-side, so the counts always match the API.
 */

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { value: '-dateOfJoining', label: 'Newest first' },
  { value: 'dateOfJoining', label: 'Oldest first' },
  { value: 'firstName', label: 'First name A–Z' },
  { value: 'lastName', label: 'Last name A–Z' },
  { value: 'employeeCode', label: 'Employee code' },
] as const;

const inputClass =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500';

export function EmployeeListPage() {
  const { account } = useAuth();
  const canCreate = account?.permissions.includes('createEmployee') ?? false;

  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [sort, setSort] = useState<string>('-dateOfJoining');
  const [employmentType, setEmploymentType] = useState('');
  const [status, setStatus] = useState('');

  const params: EmployeeListParams = {
    page,
    limit: PAGE_SIZE,
    ...(submittedQ ? { q: submittedQ } : {}),
    ...(sort ? { sort } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(status ? { status } : {}),
  };

  const listQuery = useEmployeeList(params);
  const total = listQuery.data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={listQuery.data ? `${total} employee${total === 1 ? '' : 's'}` : undefined}
        actions={
          canCreate ? (
            <Link
              to="/employees/new"
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Add Employee
            </Link>
          ) : null
        }
      />

      <form
        className="mb-4 flex flex-wrap gap-2"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSubmittedQ(q.trim());
        }}
      >
        <label htmlFor="employee-search" className="sr-only">
          Search by name, email, code or phone
        </label>
        <input
          id="employee-search"
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search name, email, code, phone…"
          className={`${inputClass} w-64`}
        />
        <select
          aria-label="Employment type"
          value={employmentType}
          onChange={(event) => {
            setEmploymentType(event.target.value);
            setPage(1);
          }}
          className={inputClass}
        >
          <option value="">All types</option>
          <option value="Full-Time">Full-Time</option>
          <option value="Intern">Intern</option>
          <option value="Freelancer">Freelancer</option>
          <option value="Contractor">Contractor</option>
          <option value="Other">Other</option>
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className={inputClass}
        >
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Probation">Probation</option>
          <option value="On Notice">On Notice</option>
          <option value="Resigned">Resigned</option>
          <option value="Relieved">Relieved</option>
          <option value="Inactive">Inactive</option>
        </select>
        <select
          aria-label="Sort order"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            setPage(1);
          }}
          className={inputClass}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
        >
          Search
        </button>
      </form>

      {listQuery.isPending ? (
        <LoadingState label="Loading employees…" />
      ) : listQuery.isError ? (
        <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      ) : listQuery.data.data.length === 0 ? (
        <EmptyState
          title="No employees found"
          hint="Try widening the search or clearing the filters."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-4 py-2.5">Code</th>
                  <th scope="col" className="px-4 py-2.5">Name</th>
                  <th scope="col" className="px-4 py-2.5">Department</th>
                  <th scope="col" className="px-4 py-2.5">Type</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5">Joined</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.data.data.map((employee) => (
                  <tr key={employee.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                      {employee.employeeCode}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/employees/${employee.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {employee.fullName}
                      </Link>
                      <div className="text-xs text-slate-500">{employee.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {employee.department?.name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{employee.employmentType}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={employee.status} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{employee.dateOfJoining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
            <p className="text-slate-500">
              Page {listQuery.data.meta.page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
