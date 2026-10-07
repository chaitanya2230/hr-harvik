import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAssetAssignments, useAssetList } from './api';
import { useAuth } from '../auth/auth-context';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';

/**
 * AGENTS.md §9 — /assets with server-side pagination, search, filter and sort.
 * Tabs: Inventory (HR) and Assignments (scoped ledger every role can read).
 */

const PAGE_SIZE = 20;
const inputClass =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500';

const ASSET_STATUS_TONES: Record<string, string> = {
  Available: 'bg-green-100 text-green-800',
  Assigned: 'bg-blue-100 text-blue-800',
  'Under Repair': 'bg-amber-100 text-amber-800',
  Lost: 'bg-red-100 text-red-800',
  Damaged: 'bg-orange-100 text-orange-800',
  Returned: 'bg-slate-200 text-slate-700',
  Retired: 'bg-slate-100 text-slate-500',
};

function AssetStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ASSET_STATUS_TONES[status] ?? 'bg-slate-100 text-slate-600'}`}
    >
      {status}
    </span>
  );
}

export function AssetListPage() {
  const { account } = useAuth();
  const [searchParams] = useSearchParams();
  const canManage = account?.permissions.includes('manageAssets') ?? false;

  const [tab, setTab] = useState<'inventory' | 'assignments'>(
    // Deep links (dashboard cards) land on the right tab: /assets?tab=assignments&active=true
    searchParams.get('tab') === 'assignments' ? 'assignments' : 'inventory',
  );
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [overdueOnly, setOverdueOnly] = useState(searchParams.get('overdue') === 'true');
  const [activeOnly, setActiveOnly] = useState(searchParams.get('active') === 'true');

  const inventoryQuery = useAssetList(
    {
      page,
      limit: PAGE_SIZE,
      ...(submittedQ ? { q: submittedQ } : {}),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(overdueOnly ? { overdue: true } : {}),
    },
    tab === 'inventory',
  );

  const assignmentsQuery = useAssetAssignments(
    {
      page,
      limit: PAGE_SIZE,
      ...(activeOnly ? { active: true } : {}),
      ...(overdueOnly ? { overdue: true } : {}),
    },
    tab === 'assignments',
  );

  return (
    <div>
      <PageHeader
        title="Assets"
        subtitle="Hardware inventory and assignment ledger"
        actions={
          canManage && tab === 'inventory' ? (
            <Link
              to="/assets/new"
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Add Asset
            </Link>
          ) : null
        }
      />

      <div role="tablist" aria-label="Asset sections" className="mb-4 flex gap-1 border-b border-slate-200">
        {(['inventory', 'assignments'] as const).map((value) => (
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
            {value === 'inventory' ? 'Inventory' : 'Assignments'}
          </button>
        ))}
      </div>

      {tab === 'inventory' ? (
        !canManage ? (
          <EmptyState
            title="No inventory access"
            hint="The hardware inventory is visible to HR. Your assignments are on the Assignments tab."
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
              <label htmlFor="asset-search" className="sr-only">Search assets</label>
              <input
                id="asset-search"
                type="search"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search name, code, serial, brand…"
                className={`${inputClass} w-64`}
              />
              <input
                aria-label="Type"
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                  setPage(1);
                }}
                placeholder="Type (e.g. Laptop)"
                className={inputClass}
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
                {Object.keys(ASSET_STATUS_TONES).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={(event) => {
                    setOverdueOnly(event.target.checked);
                    setPage(1);
                  }}
                />
                Overdue only
              </label>
              <button
                type="submit"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Search
              </button>
            </form>

            {inventoryQuery.isPending ? (
              <LoadingState label="Loading assets…" />
            ) : inventoryQuery.isError ? (
              <ErrorState error={inventoryQuery.error} onRetry={() => void inventoryQuery.refetch()} />
            ) : inventoryQuery.data.data.length === 0 ? (
              <EmptyState title="No assets found" hint="Try widening the search or clearing the filters." />
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <th scope="col" className="px-4 py-2.5">Code</th>
                        <th scope="col" className="px-4 py-2.5">Asset</th>
                        <th scope="col" className="px-4 py-2.5">Type</th>
                        <th scope="col" className="px-4 py-2.5">Status</th>
                        <th scope="col" className="px-4 py-2.5">Holder</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventoryQuery.data.data.map((asset) => (
                        <tr key={asset.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{asset.assetCode}</td>
                          <td className="px-4 py-2.5">
                            <Link to={`/assets/${asset.id}`} className="font-medium text-brand-700 hover:underline">
                              {asset.name}
                            </Link>
                            <div className="text-xs text-slate-500">{asset.serialNumber}</div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{asset.type}</td>
                          <td className="px-4 py-2.5"><AssetStatusBadge status={asset.status} /></td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {asset.activeAssignment ? (
                              <>
                                {asset.activeAssignment.employee.fullName}
                                {asset.activeAssignment.overdue ? (
                                  <span className="ml-1 text-xs font-medium text-red-600">overdue</span>
                                ) : null}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={inventoryQuery.data.meta.page}
                  total={inventoryQuery.data.meta.total}
                  pageSize={PAGE_SIZE}
                  onPage={setPage}
                />
              </>
            )}
          </>
        )
      ) : assignmentsQuery.isPending ? (
        <LoadingState label="Loading assignments…" />
      ) : assignmentsQuery.isError ? (
        <ErrorState error={assignmentsQuery.error} onRetry={() => void assignmentsQuery.refetch()} />
      ) : assignmentsQuery.data.data.length === 0 ? (
        <EmptyState title="No assignments found" hint="Assigned hardware appears here." />
      ) : (
        <>
          <div className="mb-4 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5 text-slate-600">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(event) => {
                  setActiveOnly(event.target.checked);
                  setPage(1);
                }}
              />
              Active only
            </label>
            <label className="flex items-center gap-1.5 text-slate-600">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(event) => {
                  setOverdueOnly(event.target.checked);
                  setPage(1);
                }}
              />
              Overdue only
            </label>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-4 py-2.5">Asset</th>
                  <th scope="col" className="px-4 py-2.5">Holder</th>
                  <th scope="col" className="px-4 py-2.5">Assigned</th>
                  <th scope="col" className="px-4 py-2.5">Expected back</th>
                  <th scope="col" className="px-4 py-2.5">Returned</th>
                </tr>
              </thead>
              <tbody>
                {assignmentsQuery.data.data.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      {row.asset ? (
                        <Link to={`/assets/${row.asset.id}`} className="font-medium text-brand-700 hover:underline">
                          {row.asset.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                      <div className="text-xs text-slate-500">{row.asset?.assetCode}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.employee?.fullName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{new Date(row.assignedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {row.expectedReturnDate ?? '—'}
                      {row.overdue ? (
                        <span className="ml-1 text-xs font-medium text-red-600">overdue</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.actualReturnDate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={assignmentsQuery.data.meta.page}
            total={assignmentsQuery.data.meta.total}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

export function PaginationControls({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
      <p className="text-slate-500">Page {page} of {totalPages}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
