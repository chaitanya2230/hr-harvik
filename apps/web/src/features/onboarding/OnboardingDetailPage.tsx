import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../auth/auth-context';
import { useOnboardingDetail, useReopenOnboarding, useUpdateChecklistItem } from './api';
import type { OnboardingItemKey } from './types';

export function OnboardingDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const notify = useToast();
  const { account } = useAuth();

  const { data, isPending, isError, error, refetch } = useOnboardingDetail(employeeId ?? '');
  const updateItem = useUpdateChecklistItem(employeeId ?? '');
  const reopenOnboarding = useReopenOnboarding(employeeId ?? '');

  const [naKey, setNaKey] = useState<OnboardingItemKey | null>(null);
  const [naReason, setNaReason] = useState('');

  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const isHR = account?.role === 'HR Admin' || account?.role === 'HR Manager';
  const isSelf = account?.role === 'Employee' && account.employeeId === employeeId;

  if (isPending) return <LoadingState label="Loading onboarding checklist…" />;
  if (isError || !data?.data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const onb = data.data;

  const handleMarkComplete = async (key: OnboardingItemKey) => {
    try {
      await updateItem.mutateAsync({ itemKey: key, status: 'Completed' });
      notify('success', 'Item marked as completed');
      void refetch();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to update item');
    }
  };

  const handleMarkNa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!naKey) return;
    try {
      await updateItem.mutateAsync({
        itemKey: naKey,
        status: 'NA',
        naReason: naReason.trim() || undefined,
      });
      notify('success', 'Item marked as Not Applicable');
      setNaKey(null);
      setNaReason('');
      void refetch();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to mark NA');
    }
  };

  const handleResetPending = async (key: OnboardingItemKey) => {
    try {
      await updateItem.mutateAsync({ itemKey: key, status: 'Pending' });
      notify('success', 'Item reset to pending');
      void refetch();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to update item');
    }
  };

  const handleReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenReason.trim()) {
      notify('error', 'Reopen reason is mandatory');
      return;
    }
    try {
      await reopenOnboarding.mutateAsync({ reason: reopenReason });
      notify('success', 'Onboarding checklist reopened');
      setShowReopenModal(false);
      setReopenReason('');
      void refetch();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to reopen checklist');
    }
  };

  const canEditItem = (key: OnboardingItemKey): boolean => {
    if (isHR) return true;
    if (isSelf) return key === 'personalInfo' || key === 'policyAcknowledgement';
    return false;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${onb.employeeName} (${onb.employeeCode})`}
        subtitle={`Designation: ${onb.designation ?? '—'} · Department: ${onb.departmentName ?? '—'} · Joined: ${onb.dateOfJoining}`}
        actions={
          <div className="flex gap-2 items-center">
            <Link
              to={`/employees/${onb.employeeId}`}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Employee 360 →
            </Link>
            {isHR && onb.status === 'Completed' && (
              <button
                type="button"
                onClick={() => setShowReopenModal(true)}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
              >
                Reopen Checklist
              </button>
            )}
          </div>
        }
      />

      {/* Progress Card */}
      <Card title="Onboarding Lifecycle Status">
        <div className="space-y-3">
          <div className="flex justify-between items-center text-sm">
            <div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  onb.status === 'Completed'
                    ? 'bg-emerald-100 text-emerald-800'
                    : onb.status === 'In Progress'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-700'
                }`}
              >
                {onb.status}
              </span>
              {onb.completedAt && (
                <span className="ml-2 text-xs text-slate-500">
                  Completed on {onb.completedAt.split('T')[0]}
                </span>
              )}
              {onb.reopenedAt && (
                <span className="ml-2 text-xs text-amber-600">
                  (Reopened: {onb.reopenReason})
                </span>
              )}
            </div>
            <div className="font-semibold text-slate-900">
              {onb.completedItemsCount} of {onb.totalItemsCount} items verified ({onb.progressPercent}%)
            </div>
          </div>

          <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                onb.progressPercent === 100 ? 'bg-emerald-500' : 'bg-brand-600'
              }`}
              style={{ width: `${onb.progressPercent}%` }}
            />
          </div>
        </div>
      </Card>

      {/* 14-Item Checklist */}
      <Card title="14-Item Mandatory Onboarding Checklist">
        <div className="divide-y divide-slate-200">
          {onb.items.map((item, idx) => {
            const isDone = item.status === 'Completed';
            const isNA = item.status === 'NA';
            const editable = canEditItem(item.key);

            return (
              <div key={item.key} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400">{idx + 1}.</span>
                    <h4 className="text-sm font-semibold text-slate-900">{item.title}</h4>
                    {item.isRequired && (
                      <span className="text-[10px] uppercase font-bold tracking-wider text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">
                        Required
                      </span>
                    )}
                    <span className="text-xs text-slate-400 capitalize">· {item.category}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <Link
                      to={item.smartLink}
                      className="font-medium text-brand-600 hover:underline flex items-center gap-1"
                    >
                      Smart Link ↗
                    </Link>

                    {item.completedAt && (
                      <span>
                        Verified: {item.completedAt.split('T')[0]} ({item.completedSource ?? 'Manual'})
                      </span>
                    )}

                    {isNA && item.naReason && (
                      <span className="text-amber-700 italic">NA Reason: {item.naReason}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      isDone
                        ? 'bg-emerald-100 text-emerald-800 font-semibold'
                        : isNA
                          ? 'bg-slate-200 text-slate-700'
                          : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {item.status}
                  </span>

                  {editable && (
                    <div className="flex gap-1.5">
                      {!isDone && (
                        <button
                          type="button"
                          onClick={() => void handleMarkComplete(item.key)}
                          className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                        >
                          Complete
                        </button>
                      )}

                      {!isNA && isHR && (
                        <button
                          type="button"
                          onClick={() => {
                            setNaKey(item.key);
                            setNaReason('');
                          }}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Mark NA
                        </button>
                      )}

                      {(isDone || isNA) && (
                        <button
                          type="button"
                          onClick={() => void handleResetPending(item.key)}
                          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Mark NA Modal */}
      {naKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Mark Item as Not Applicable (NA)</h3>
            <p className="text-xs text-slate-500">
              Required items require an audited justification why this step is waived for this employee.
            </p>
            <form onSubmit={(e) => void handleMarkNa(e)} className="space-y-3">
              <textarea
                rows={3}
                required
                placeholder="Exemption justification..."
                value={naReason}
                onChange={(e) => setNaReason(e.target.value)}
                className="w-full rounded-md border border-slate-300 p-2 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNaKey(null)}
                  className="rounded px-3 py-1.5 text-xs border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateItem.isPending}
                  className="rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
                >
                  Confirm NA
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reopen Modal */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Reopen Onboarding Checklist</h3>
            <p className="text-xs text-slate-500">
              Document why this checklist is being reopened for auditing purposes.
            </p>
            <form onSubmit={(e) => void handleReopen(e)} className="space-y-3">
              <textarea
                rows={3}
                required
                placeholder="Reason for reopening onboarding..."
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                className="w-full rounded-md border border-slate-300 p-2 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowReopenModal(false)}
                  className="rounded px-3 py-1.5 text-xs border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reopenOnboarding.isPending}
                  className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
                >
                  Confirm Reopen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
