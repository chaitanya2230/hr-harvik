import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../../api/client';
import {
  useAssignLicense,
  useDeleteLicense,
  useExpireLicense,
  useLicense,
  useLicenseUtilization,
  useRenewLicense,
  useRevokeLicense,
  useSuspendLicense,
  useUpdateLicense,
} from './api';
import { useAuth } from '../auth/auth-context';
import { useManagerOptions } from '../employees/api';
import { useToast } from '../../components/Toast';
import { Card, ErrorState, LoadingState, PageHeader } from '../../components/ui';

/** AGENTS.md §8.9 — license detail: seats, lifecycle ops, utilization, key reveal. */

const inputClass =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500';

export function LicenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { account } = useAuth();
  const navigate = useNavigate();
  const notify = useToast();

  const [assigneeId, setAssigneeId] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const detailQuery = useLicense(id);
  const utilizationQuery = useLicenseUtilization(id);
  const managersQuery = useManagerOptions();
  const assignMutation = useAssignLicense(id ?? '');
  const renewMutation = useRenewLicense(id ?? '');
  const suspendMutation = useSuspendLicense(id ?? '');
  const expireMutation = useExpireLicense(id ?? '');
  const revokeMutation = useRevokeLicense(id ?? '');
  const deleteMutation = useDeleteLicense();
  const updateMutation = useUpdateLicense(id ?? '');

  const canManage = account?.permissions.includes('manageLicenses') ?? false;
  const canReveal = account?.role === 'HR Admin';

  if (detailQuery.isPending) return <LoadingState label="Loading license…" />;
  if (detailQuery.isError) {
    return <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  }

  const license = detailQuery.data.data;

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

  const onReveal = async (): Promise<void> => {
    try {
      const response = await apiRequest<{ data: { licenseKey: string } }>(
        `/licenses/${license.id}/key`,
      );
      setRevealedKey(response.data.licenseKey);
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Reveal failed.');
    }
  };

  return (
    <div>
      <PageHeader
        title={`${license.softwareName} (${license.licenseCode})`}
        subtitle={`${license.licenseType}${license.provider ? ` · ${license.provider}` : ''}`}
        actions={
          canManage ? (
            <>
              <Link
                to={`/licenses/${license.id}/edit`}
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
        <Card title="Pool">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Status</dt><dd className="text-slate-900">{license.status}{license.effectivelyExpired ? ' (renewal passed)' : ''}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Seats</dt><dd className="text-slate-900">{license.usedSeats} / {license.maxSeats} used ({license.availableSeats} free)</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Renews</dt><dd className="text-slate-900">{license.renewalDate ?? '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Key</dt><dd className="text-slate-900">{license.hasKey ? 'stored (encrypted)' : 'none'}</dd></div>
          </dl>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${utilizationQuery.data?.data.utilizationPct ?? 0}% of seats used`}>
            <div
              className="h-full bg-brand-600"
              style={{ width: `${utilizationQuery.data?.data.utilizationPct ?? 0}%` }}
            />
          </div>
          {canReveal && license.hasKey ? (
            <div className="mt-3">
              {revealedKey ? (
                <p className="rounded-md bg-slate-100 px-3 py-2 font-mono text-xs text-slate-900">{revealedKey}</p>
              ) : (
                <button
                  type="button"
                  onClick={() => void onReveal()}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Reveal key (audited)
                </button>
              )}
            </div>
          ) : null}
        </Card>

        {canManage && license.status !== 'Revoked' ? (
          <Card title="Assign a seat">
            <div className="flex flex-wrap gap-2">
              <label htmlFor="seat-assignee" className="sr-only">Employee</label>
              <select
                id="seat-assignee"
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
              <button
                type="button"
                disabled={!assigneeId || assignMutation.isPending}
                onClick={() =>
                  void mutate('Seat assigned')(assignMutation.mutateAsync({ employeeId: assigneeId }))
                }
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Assign
              </button>
            </div>
          </Card>
        ) : null}

        {canManage ? (
          <Card title="Lifecycle">
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="New renewal date"
                type="date"
                value={renewalDate}
                onChange={(event) => setRenewalDate(event.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                disabled={!renewalDate || renewMutation.isPending}
                onClick={() => void mutate('License renewed')(renewMutation.mutateAsync({ renewalDate }))}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                Renew
              </button>
              <button
                type="button"
                onClick={() =>
                  void mutate(license.status === 'Suspended' ? 'License reactivated' : 'License suspended')(
                    suspendMutation.mutateAsync({ suspend: license.status !== 'Suspended' }),
                  )
                }
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                {license.status === 'Suspended' ? 'Reactivate' : 'Suspend'}
              </button>
              <button
                type="button"
                onClick={() => void mutate('License expired')(expireMutation.mutateAsync())}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Expire
              </button>
              <button
                type="button"
                onClick={() => void mutate('License revoked')(revokeMutation.mutateAsync())}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                Revoke license
              </button>
            </div>
          </Card>
        ) : null}
      </div>

      {updateMutation.isError ? <div className="mt-4"><ErrorState error={updateMutation.error} /></div> : null}

      {confirmingDelete ? (
        <div role="alertdialog" aria-label="Confirm delete" className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">Delete license?</h2>
            <p className="mt-1 text-sm text-slate-500">
              Only licenses without assignment history can be deleted. This is a soft delete.
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
                  void mutate('License deleted')(deleteMutation.mutateAsync(license.id)).then((ok) => {
                    if (ok) navigate('/licenses');
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
