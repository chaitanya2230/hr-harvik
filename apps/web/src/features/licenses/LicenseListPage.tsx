import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useAccessItems, useLicenseAssignments, useLicenseList, useRevokeAccessItem, useRevokeLicenseAssignment } from './api';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../../components/Toast';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { PaginationControls } from '../assets/AssetListPage';

/**
 * AGENTS.md §9 — /licenses with tabs: Licenses (HR), Assignments (scoped),
 * Access items (scoped external accounts).
 */

const PAGE_SIZE = 20;
const inputClass =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500';

const LICENSE_TONES: Record<string, string> = {
  Available: 'bg-green-100 text-green-800',
  Assigned: 'bg-blue-100 text-blue-800',
  Expired: 'bg-red-100 text-red-800',
  Suspended: 'bg-amber-100 text-amber-800',
  Revoked: 'bg-slate-200 text-slate-700',
};

function LicenseBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${LICENSE_TONES[status] ?? 'bg-slate-100 text-slate-600'}`}
    >
      {status}
    </span>
  );
}

export function LicenseListPage() {
  const { account } = useAuth();
  const [searchParams] = useSearchParams();
  const notify = useToast();
  const canManage = account?.permissions.includes('manageLicenses') ?? false;

  const [tab, setTab] = useState<'licenses' | 'assignments' | 'access'>('licenses');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');

  const inventoryQuery = useLicenseList(
    {
      page,
      limit: PAGE_SIZE,
      ...(submittedQ ? { q: submittedQ } : {}),
      ...(status ? { status } : {}),
    },
    tab === 'licenses',
  );

  const assignmentsQuery = useLicenseAssignments(
    { page, limit: PAGE_SIZE },
    tab === 'assignments',
  );
  const accessQuery = useAccessItems({ page, limit: PAGE_SIZE }, tab === 'access');

  const revokeAssignmentMutation = useRevokeLicenseAssignment();
  const revokeAccessMutation = useRevokeAccessItem();

  const onRevokeAssignment = async (assignmentId: string): Promise<void> => {
    try {
      await revokeAssignmentMutation.mutateAsync({ assignmentId });
      notify('success', 'License revoked');
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Revoke failed.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Software licenses"
        subtitle="License pool, seat assignments and external access"
        actions={
          canManage && tab === 'licenses' ? (
            <Link
              to="/licenses/new"
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Add License
            </Link>
          ) : null
        }
      />

      <div role="tablist" aria-label="License sections" className="mb-4 flex gap-1 border-b border-slate-200">
        {(['licenses', 'assignments', 'access'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              setTab(value);
              setPage(1);
            }}
            className={`rounded-t-md px-4 py-2 text-sm font-medium ${
              tab === value
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {value === 'licenses' ? 'Licenses' : value === 'assignments' ? 'Assignments' : 'Access'}
          </button>
        ))}
      </div>

      {tab === 'licenses' ? (
        !canManage ? (
          <EmptyState
            title="No license inventory access"
            hint="The license pool is visible to HR. Your seats are on the Assignments tab."
          />
        ) : (
          <>
            <form
              className="mb-4 flex flex-wrap gap-2"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setSubmittedQ(q.trim());
              }}
            >
              <label htmlFor="license-search" className="sr-only">Search licenses</label>
              <input
                id="license-search"
                type="search"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search software, code, provider…"
                className={`${inputClass} w-64`}
              />
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
                {Object.keys(LICENSE_TONES).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Search
              </button>
            </form>

            {inventoryQuery.isPending ? (
              <LoadingState label="Loading licenses…" />
            ) : inventoryQuery.isError ? (
              <ErrorState error={inventoryQuery.error} onRetry={() => void inventoryQuery.refetch()} />
            ) : inventoryQuery.data.data.length === 0 ? (
              <EmptyState title="No licenses found" />
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <th scope="col" className="px-4 py-2.5">Code</th>
                        <th scope="col" className="px-4 py-2.5">Software</th>
                        <th scope="col" className="px-4 py-2.5">Seats</th>
                        <th scope="col" className="px-4 py-2.5">Status</th>
                        <th scope="col" className="px-4 py-2.5">Renews</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventoryQuery.data.data.map((license) => (
                        <tr key={license.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{license.licenseCode}</td>
                          <td className="px-4 py-2.5">
                            <Link to={`/licenses/${license.id}`} className="font-medium text-brand-700 hover:underline">
                              {license.softwareName}
                            </Link>
                            <div className="text-xs text-slate-500">{license.licenseType}{license.hasKey ? ' · key stored' : ''}</div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{license.usedSeats}/{license.maxSeats}</td>
                          <td className="px-4 py-2.5"><LicenseBadge status={license.status} /></td>
                          <td className="px-4 py-2.5 text-slate-600">{license.renewalDate ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationControls page={inventoryQuery.data.meta.page} total={inventoryQuery.data.meta.total} pageSize={PAGE_SIZE} onPage={setPage} />
              </>
            )}
          </>
        )
      ) : tab === 'assignments' ? (
        assignmentsQuery.isPending ? (
          <LoadingState label="Loading assignments…" />
        ) : assignmentsQuery.isError ? (
          <ErrorState error={assignmentsQuery.error} onRetry={() => void assignmentsQuery.refetch()} />
        ) : assignmentsQuery.data.data.length === 0 ? (
          <EmptyState title="No license assignments" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-4 py-2.5">License</th>
                  <th scope="col" className="px-4 py-2.5">Holder</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  {canManage ? <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {assignmentsQuery.data.data.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-900">{row.license?.softwareName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{row.employee?.fullName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{row.status}</td>
                    {canManage ? (
                      <td className="px-4 py-2.5">
                        {row.status === 'Assigned' ? (
                          <button
                            type="button"
                            onClick={() => void onRevokeAssignment(row.id)}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
                          >
                            Revoke
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : accessQuery.isPending ? (
        <LoadingState label="Loading access items…" />
      ) : accessQuery.isError ? (
        <ErrorState error={accessQuery.error} onRetry={() => void accessQuery.refetch()} />
      ) : accessQuery.data.data.length === 0 ? (
        <EmptyState title="No access items" hint="External accounts such as GitHub, Slack or VPN appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-4 py-2.5">System</th>
                <th scope="col" className="px-4 py-2.5">Holder</th>
                <th scope="col" className="px-4 py-2.5">Status</th>
                {canManage ? <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {accessQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-900">{row.system}</td>
                  <td className="px-4 py-2.5 text-slate-600">{row.employee?.fullName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{row.status}</td>
                  {canManage ? (
                    <td className="px-4 py-2.5">
                      {row.status === 'Active' ? (
                        <button
                          type="button"
                          onClick={() => {
                            void revokeAccessMutation.mutateAsync(row.id).then(
                              () => notify('success', 'Access revoked'),
                              (caught: unknown) =>
                                notify('error', caught instanceof ApiError ? caught.message : 'Revoke failed.'),
                            );
                          }}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
                        >
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
