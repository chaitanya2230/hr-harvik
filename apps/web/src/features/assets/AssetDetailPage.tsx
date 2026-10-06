import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import {
  useAssignAsset,
  useAsset,
  useAssetHistory,
  useDeleteAsset,
  useRepairAsset,
  useRetireAsset,
  useReturnAsset,
} from './api';
import { useAuth } from '../auth/auth-context';
import { useManagerOptions } from '../employees/api';
import { useToast } from '../../components/Toast';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';

/** AGENTS.md §8.8 — asset detail with lifecycle actions and full history. */

const inputClass =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500';

export function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { account } = useAuth();
  const navigate = useNavigate();
  const notify = useToast();

  const [assigneeId, setAssigneeId] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [repairTarget, setRepairTarget] = useState('');
  const [retireReason, setRetireReason] = useState('');

  const detailQuery = useAsset(id);
  const historyQuery = useAssetHistory(id);
  const managersQuery = useManagerOptions();
  const assignMutation = useAssignAsset(id ?? '');
  const returnMutation = useReturnAsset(id ?? '');
  const repairMutation = useRepairAsset(id ?? '');
  const retireMutation = useRetireAsset(id ?? '');
  const deleteMutation = useDeleteAsset();

  const canManage = account?.permissions.includes('manageAssets') ?? false;

  if (detailQuery.isPending) return <LoadingState label="Loading asset…" />;
  if (detailQuery.isError) {
    return <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  }

  const asset = detailQuery.data.data;

  const mutate =
    (label: string) =>
    async (work: Promise<unknown>): Promise<boolean> => {
      try {
        await work;
        notify('success', label);
        return true;
      } catch (caught) {
        notify('error', caught instanceof ApiError ? caught.message : `${label} failed.`);
        return false;
      }
    };

  return (
    <div>
      <PageHeader
        title={`${asset.name} (${asset.assetCode})`}
        subtitle={`${asset.type} · ${asset.serialNumber}`}
        actions={
          canManage ? (
            <>
              <Link
                to={`/assets/${asset.id}/edit`}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Edit
              </Link>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          ) : null
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Details">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Status</dt><dd className="text-slate-900">{asset.status}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Brand / Model</dt><dd className="text-slate-900">{[asset.brand, asset.model].filter(Boolean).join(' ') || '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Condition</dt><dd className="text-slate-900">{asset.condition ?? '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Purchased</dt><dd className="text-slate-900">{asset.purchaseDate ?? '—'}{asset.purchaseCost != null ? ` · ${asset.purchaseCost}` : ''}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Holder</dt><dd className="text-slate-900">{asset.activeAssignment?.employee.fullName ?? '—'}</dd></div>
          </dl>
        </Card>

        {canManage && asset.status === 'Available' ? (
          <Card title="Assign">
            <div className="flex flex-wrap gap-2">
              <label htmlFor="assignee" className="sr-only">Employee</label>
              <select
                id="assignee"
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                className={inputClass}
              >
                <option value="">Select employee…</option>
                {(managersQuery.data?.data ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.fullName} ({option.employeeCode})
                  </option>
                ))}
              </select>
              <input
                aria-label="Expected return date"
                type="date"
                value={expectedReturnDate}
                onChange={(event) => setExpectedReturnDate(event.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                disabled={!assigneeId || assignMutation.isPending}
                onClick={() =>
                  void mutate('Asset assigned')(
                    assignMutation.mutateAsync({
                      employeeId: assigneeId,
                      ...(expectedReturnDate ? { expectedReturnDate } : {}),
                    }),
                  )
                }
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {assignMutation.isPending ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </Card>
        ) : null}

        {canManage && asset.status === 'Assigned' ? (
          <Card title="Return">
            <button
              type="button"
              disabled={returnMutation.isPending}
              onClick={() => void mutate('Asset returned')(returnMutation.mutateAsync({}))}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {returnMutation.isPending ? 'Returning…' : 'Mark returned'}
            </button>
          </Card>
        ) : null}

        {canManage && asset.status !== 'Assigned' && asset.status !== 'Retired' ? (
          <Card title="Repair / condition">
            <div className="flex flex-wrap gap-2">
              <label htmlFor="repair-target" className="sr-only">New condition status</label>
              <select
                id="repair-target"
                value={repairTarget}
                onChange={(event) => setRepairTarget(event.target.value)}
                className={inputClass}
              >
                <option value="">Select status…</option>
                {['Available', 'Under Repair', 'Lost', 'Damaged'].filter((s) => s !== asset.status).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!repairTarget || repairMutation.isPending}
                onClick={() =>
                  void mutate('Asset status updated')(repairMutation.mutateAsync({ status: repairTarget }))
                }
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                Apply
              </button>
            </div>
          </Card>
        ) : null}

        {canManage && asset.status !== 'Retired' && asset.status !== 'Assigned' ? (
          <Card title="Retire">
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Retirement reason"
                value={retireReason}
                onChange={(event) => setRetireReason(event.target.value)}
                placeholder="Reason"
                className={inputClass}
              />
              <button
                type="button"
                disabled={retireMutation.isPending}
                onClick={() =>
                  void mutate('Asset retired')(retireMutation.mutateAsync({ reason: retireReason || undefined }))
                }
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                Retire
              </button>
            </div>
          </Card>
        ) : null}
      </div>

      <div className="mt-4">
        <Card title="Assignment history">
          {historyQuery.isPending ? (
            <LoadingState label="Loading history…" />
          ) : historyQuery.isError ? (
            <ErrorState error={historyQuery.error} onRetry={() => void historyQuery.refetch()} />
          ) : (historyQuery.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="No assignments yet" />
          ) : (
            <ol className="space-y-3">
              {historyQuery.data?.data.map((row) => (
                <li key={row.id} className="text-sm text-slate-700">
                  <p>
                    <span className="font-medium text-slate-900">{row.employee?.fullName ?? '—'}</span>
                    {' '}· assigned {new Date(row.assignedAt).toLocaleDateString()}
                    {row.actualReturnDate ? ` · returned ${row.actualReturnDate}` : ' · still held'}
                    {row.overdue ? <span className="ml-1 font-medium text-red-600">overdue</span> : null}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {confirmingDelete ? (
        <div role="alertdialog" aria-label="Confirm delete" className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">Delete asset?</h2>
            <p className="mt-1 text-sm text-slate-500">
              Only assets without assignment history can be deleted. This is a soft delete.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  void mutate('Asset deleted')(deleteMutation.mutateAsync(asset.id)).then((ok) => {
                    if (ok) navigate('/assets');
                  });
                }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
