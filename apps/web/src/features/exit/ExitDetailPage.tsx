import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import {
  useExitForEmployee,
  useUpdateChecklistItem,
  useProvideClearance,
  useUpdateSettlement,
  useRelieveEmployee,
  useWithdrawExit,
} from './api';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../../components/Toast';
import { Card, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import type { ChecklistStatus, ClearanceStatus, ExitChecklistItem, ExitStage, FinalSettlementStatus } from '../../api/types';

/**
 * AGENTS.md §8.10 P3 — Exit / Offboarding detail page.
 *
 * Provides:
 *  - Checklist with live completion actions
 *  - Clearance actions (manager/hr/finance) with RBAC
 *  - Settlement status
 *  - Relieve (normal + force for HR Admin)
 *  - Withdrawal (On Notice → Active)
 *  - Blocker display
 */

const STAGE_ORDER: ExitStage[] = [
  'Resignation',
  'Notice Period',
  'Clearance',
  'Asset Return',
  'Software Revocation',
  'Final Settlement',
  'Documents',
  'Relieved',
];

const checklistStatusClass = (status: ChecklistStatus): string => {
  switch (status) {
    case 'Completed':
      return 'bg-green-100 text-green-800';
    case 'Waived':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-orange-100 text-orange-800';
  }
};

const clearanceStatusClass = (status: ClearanceStatus): string => {
  switch (status) {
    case 'Approved':
      return 'text-green-700';
    case 'Rejected':
      return 'text-red-700';
    default:
      return 'text-orange-600';
  }
};

export function ExitDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { account } = useAuth();
  const notify = useToast();

  const exitQuery = useExitForEmployee(employeeId);

  const updateChecklist = useUpdateChecklistItem(employeeId ?? '');
  const provideClearance = useProvideClearance(employeeId ?? '');
  const updateSettlement = useUpdateSettlement(employeeId ?? '');
  const relieveMut = useRelieveEmployee(employeeId ?? '');
  const withdrawMut = useWithdrawExit(employeeId ?? '');

  const [clearanceComments, setClearanceComments] = useState('');
  const [settlementNote, setSettlementNote] = useState('');
  const [forceReason, setForceReason] = useState('');
  const [confirmingRelieve, setConfirmingRelieve] = useState(false);
  const [confirmingForceRelieve, setConfirmingForceRelieve] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);

  const isHrAdmin = account?.role === 'HR Admin';
  const isHrOrAdmin = isHrAdmin || account?.role === 'HR Manager';
  const isManager = account?.role === 'Manager';
  const canRelieve = isHrOrAdmin;
  const canForceRelieve = isHrAdmin;
  const canWithdraw = isHrOrAdmin;

  if (exitQuery.isPending) return <LoadingState label="Loading exit details…" />;
  if (exitQuery.isError) {
    const err = exitQuery.error as Error;
    if (err instanceof ApiError && err.status === 404) {
      return (
        <div className="py-12 text-center">
          <p className="text-slate-500">No active exit process found for this employee.</p>
          <Link to="/exit" className="mt-4 inline-block text-brand-600 hover:underline">
            ← Back to exits
          </Link>
        </div>
      );
    }
    return <ErrorState error={exitQuery.error} onRetry={() => void exitQuery.refetch()} />;
  }

  const exit = exitQuery.data.data;
  const isRelieved = exit.stage === 'Relieved';
  const isCancelled = exit.stage === 'Cancelled';

  const onChecklistAction = async (item: ExitChecklistItem, newStatus: ChecklistStatus): Promise<void> => {
    try {
      await updateChecklist.mutateAsync({ itemId: item.id, status: newStatus });
      notify('success', `${item.title} marked ${newStatus}`);
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Failed to update checklist item');
    }
  };

  const onClearance = async (dept: 'manager' | 'hr' | 'finance', status: 'Approved' | 'Rejected'): Promise<void> => {
    try {
      await provideClearance.mutateAsync({ department: dept, status, comments: clearanceComments || undefined });
      notify('success', `${dept.charAt(0).toUpperCase() + dept.slice(1)} clearance ${status}`);
      setClearanceComments('');
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Failed to provide clearance');
    }
  };

  const onSettlement = async (status: FinalSettlementStatus): Promise<void> => {
    try {
      await updateSettlement.mutateAsync({ status, notes: settlementNote || undefined });
      notify('success', `Settlement status set to ${status}`);
      setSettlementNote('');
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Failed to update settlement');
    }
  };

  const onRelieve = async (force = false): Promise<void> => {
    try {
      await relieveMut.mutateAsync({ force, forceReason: force ? forceReason : undefined });
      notify('success', 'Employee relieved successfully');
      setConfirmingRelieve(false);
      setConfirmingForceRelieve(false);
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Failed to relieve employee');
      setConfirmingRelieve(false);
      setConfirmingForceRelieve(false);
    }
  };

  const onWithdraw = async (): Promise<void> => {
    try {
      await withdrawMut.mutateAsync();
      notify('success', 'Exit withdrawn — employee restored to Active');
      setConfirmingWithdraw(false);
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : 'Failed to withdraw exit');
      setConfirmingWithdraw(false);
    }
  };

  const byCategory = (cat: string) => exit.checklist.filter((c) => c.category === cat);

  return (
    <div>
      <PageHeader
        title={`Exit: ${exit.employeeName}`}
        subtitle={`${exit.employeeCode} · LWD ${exit.lastWorkingDay}`}
        actions={
          <Link to="/exit" className="text-sm text-brand-600 hover:underline">
            ← Back to exits
          </Link>
        }
      />

      {/* Stage progress */}
      <div className="mb-6 overflow-x-auto">
        <div className="flex min-w-max gap-0">
          {STAGE_ORDER.filter((s) => s !== 'Resignation').map((s, idx) => {
            const currentIdx = STAGE_ORDER.indexOf(exit.stage);
            const thisIdx = STAGE_ORDER.indexOf(s);
            const done = thisIdx < currentIdx;
            const active = s === exit.stage;
            return (
              <div key={s} className="flex items-center">
                {idx > 0 && (
                  <div className={`h-0.5 w-8 ${done || active ? 'bg-brand-500' : 'bg-slate-200'}`} />
                )}
                <div
                  className={`flex h-8 items-center rounded-full px-3 text-xs font-medium whitespace-nowrap ${
                    active
                      ? 'bg-brand-600 text-white'
                      : done
                        ? 'bg-green-100 text-green-800'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {s}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Blockers */}
      {exit.blockers.length > 0 && !isRelieved && !isCancelled && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="mb-2 text-sm font-semibold text-red-700">
            {exit.blockers.length} blocker{exit.blockers.length !== 1 ? 's' : ''} preventing relieve:
          </p>
          <ul className="list-inside list-disc space-y-1">
            {exit.blockers.map((b, i) => (
              <li key={i} className="text-sm text-red-700">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isRelieved && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            ✓ Employee relieved{exit.completedAt ? ` on ${new Date(exit.completedAt).toLocaleDateString()}` : ''}
            {exit.forceRelieved && (
              <span className="ml-2 text-xs text-green-600">(force-relieved: {exit.forceReason})</span>
            )}
          </p>
        </div>
      )}

      {isCancelled && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-600">Exit process was withdrawn / cancelled.</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — checklist */}
        <div className="lg:col-span-2 space-y-4">

          {/* Exit details */}
          <Card title="Exit details">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-slate-500">Reason</dt><dd className="text-slate-900">{exit.reason}</dd></div>
              <div><dt className="text-slate-500">Resignation date</dt><dd className="text-slate-900">{exit.resignationDate}</dd></div>
              <div><dt className="text-slate-500">Notice period</dt><dd className="text-slate-900">{exit.noticePeriodDays} days</dd></div>
              <div><dt className="text-slate-500">Last working day</dt><dd className="font-medium text-slate-900">{exit.lastWorkingDay}</dd></div>
              {exit.reasonNote && (
                <div className="col-span-2"><dt className="text-slate-500">Note</dt><dd className="text-slate-700">{exit.reasonNote}</dd></div>
              )}
            </dl>
          </Card>

          {/* Assets */}
          {byCategory('asset').length > 0 && (
            <Card title={`Assets (${byCategory('asset').filter((c) => c.status === 'Pending').length} pending)`}>
              <ul className="divide-y divide-slate-100">
                {byCategory('asset').map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{item.title}</p>
                      {item.details && <p className="text-xs text-slate-500">{item.details}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${checklistStatusClass(item.status)}`}>
                        {item.status}
                      </span>
                      {!isRelieved && !isCancelled && item.status === 'Pending' && isHrOrAdmin && (
                        <button
                          type="button"
                          disabled={updateChecklist.isPending}
                          onClick={() => void onChecklistAction(item, 'Completed')}
                          className="rounded-md border border-green-300 px-2 py-0.5 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
                        >
                          Mark returned
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Licenses */}
          {byCategory('license').length > 0 && (
            <Card title={`Licenses (${byCategory('license').filter((c) => c.status === 'Pending').length} pending)`}>
              <ul className="divide-y divide-slate-100">
                {byCategory('license').map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{item.title}</p>
                      {item.details && <p className="text-xs text-slate-500">{item.details}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${checklistStatusClass(item.status)}`}>
                        {item.status}
                      </span>
                      {!isRelieved && !isCancelled && item.status === 'Pending' && isHrOrAdmin && (
                        <button
                          type="button"
                          disabled={updateChecklist.isPending}
                          onClick={() => void onChecklistAction(item, 'Completed')}
                          className="rounded-md border border-orange-300 px-2 py-0.5 text-xs text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Access */}
          {byCategory('access').length > 0 && (
            <Card title={`Access (${byCategory('access').filter((c) => c.status === 'Pending').length} pending)`}>
              <ul className="divide-y divide-slate-100">
                {byCategory('access').map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{item.title}</p>
                      {item.details && <p className="text-xs text-slate-500">{item.details}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${checklistStatusClass(item.status)}`}>
                        {item.status}
                      </span>
                      {!isRelieved && !isCancelled && item.status === 'Pending' && isHrOrAdmin && (
                        <button
                          type="button"
                          disabled={updateChecklist.isPending}
                          onClick={() => void onChecklistAction(item, 'Completed')}
                          className="rounded-md border border-orange-300 px-2 py-0.5 text-xs text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                        >
                          Revoke access
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Documents checklist items */}
          {byCategory('document').length > 0 && (
            <Card title={`Documents (${byCategory('document').filter((c) => c.status === 'Pending').length} pending)`}>
              <ul className="divide-y divide-slate-100">
                {byCategory('document').map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <p className="font-medium text-slate-900">{item.title}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${checklistStatusClass(item.status)}`}>
                      {item.status}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Right column — clearances, settlement, actions */}
        <div className="space-y-4">

          {/* Clearances */}
          <Card title="Clearances">
            {(['manager', 'hr', 'finance'] as const).map((dept) => {
              const clr = exit.clearances[dept];
              const canApprove =
                !isRelieved &&
                !isCancelled &&
                clr.status === 'Pending' &&
                (dept === 'manager' ? isManager || isHrOrAdmin : isHrOrAdmin);
              return (
                <div key={dept} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between text-sm">
                    <p className="font-medium text-slate-700 capitalize">{dept}</p>
                    <span className={`text-xs font-medium ${clearanceStatusClass(clr.status)}`}>
                      {clr.status}
                    </span>
                  </div>
                  {clr.comments && (
                    <p className="mt-0.5 text-xs text-slate-500">{clr.comments}</p>
                  )}
                  {canApprove && (
                    <div className="mt-2 space-y-2">
                      <textarea
                        aria-label={`${dept} clearance comments`}
                        rows={2}
                        value={clearanceComments}
                        onChange={(e) => setClearanceComments(e.target.value)}
                        placeholder="Comments (optional)"
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={provideClearance.isPending}
                          onClick={() => void onClearance(dept, 'Approved')}
                          className="flex-1 rounded-md border border-green-400 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={provideClearance.isPending}
                          onClick={() => void onClearance(dept, 'Rejected')}
                          className="flex-1 rounded-md border border-red-400 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>

          {/* Final settlement */}
          <Card title="Final settlement">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">Status</span>
              <span
                className={`text-xs font-medium ${
                  exit.finalSettlementStatus === 'Completed'
                    ? 'text-green-700'
                    : exit.finalSettlementStatus === 'Processing'
                      ? 'text-blue-700'
                      : 'text-orange-600'
                }`}
              >
                {exit.finalSettlementStatus}
              </span>
            </div>
            {!isRelieved && !isCancelled && isHrOrAdmin && (
              <div className="space-y-2">
                <textarea
                  aria-label="Settlement notes"
                  rows={2}
                  value={settlementNote}
                  onChange={(e) => setSettlementNote(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <div className="flex gap-2">
                  {(['Pending', 'Processing', 'Completed'] as const)
                    .filter((s) => s !== exit.finalSettlementStatus)
                    .map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={updateSettlement.isPending}
                        onClick={() => void onSettlement(s)}
                        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </Card>

          {/* Actions */}
          {!isRelieved && !isCancelled && (
            <Card title="Actions">
              <div className="space-y-2">
                {/* Relieve */}
                {canRelieve && (
                  <button
                    type="button"
                    disabled={exit.blockers.length > 0 || relieveMut.isPending}
                    onClick={() => setConfirmingRelieve(true)}
                    className="w-full rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Relieve Employee
                  </button>
                )}
                {/* Force relieve */}
                {canForceRelieve && exit.blockers.length > 0 && (
                  <button
                    type="button"
                    disabled={relieveMut.isPending}
                    onClick={() => setConfirmingForceRelieve(true)}
                    className="w-full rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Force Relieve (HR Admin)
                  </button>
                )}
                {/* Withdraw */}
                {canWithdraw && (
                  <button
                    type="button"
                    disabled={withdrawMut.isPending}
                    onClick={() => setConfirmingWithdraw(true)}
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Withdraw Exit
                  </button>
                )}
              </div>
            </Card>
          )}

          {/* Employee link */}
          <div className="text-center">
            <Link
              to={`/employees/${exit.employeeId}`}
              className="text-sm text-brand-600 hover:underline"
            >
              View employee profile →
            </Link>
          </div>
        </div>
      </div>

      {/* Confirm relieve dialog */}
      {confirmingRelieve && (
        <div
          role="alertdialog"
          aria-label="Confirm relieve"
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">Relieve {exit.employeeName}?</h2>
            <p className="mt-1 text-sm text-slate-500">
              This will mark the employee as Relieved, disable their login, and close the employment
              history. This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingRelieve(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={relieveMut.isPending}
                onClick={() => void onRelieve(false)}
                className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                {relieveMut.isPending ? 'Processing…' : 'Confirm Relieve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm force relieve dialog */}
      {confirmingForceRelieve && (
        <div
          role="alertdialog"
          aria-label="Confirm force relieve"
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-6">
            <h2 className="text-base font-semibold text-red-700">Force Relieve (HR Admin)</h2>
            <p className="mt-1 text-sm text-slate-500">
              Override all pending blockers. A mandatory reason is required and will be audited.
            </p>
            <label htmlFor="force-reason" className="mt-3 block text-sm font-medium text-slate-700">
              Force reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="force-reason"
              rows={3}
              value={forceReason}
              onChange={(e) => setForceReason(e.target.value)}
              placeholder="Mandatory reason for force relieve…"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingForceRelieve(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!forceReason.trim() || relieveMut.isPending}
                onClick={() => void onRelieve(true)}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {relieveMut.isPending ? 'Processing…' : 'Force Relieve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm withdraw dialog */}
      {confirmingWithdraw && (
        <div
          role="alertdialog"
          aria-label="Confirm withdraw exit"
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">Withdraw exit?</h2>
            <p className="mt-1 text-sm text-slate-500">
              The exit process will be cancelled and {exit.employeeName} will be restored to Active status.
              Assets and licenses are not affected.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingWithdraw(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={withdrawMut.isPending}
                onClick={() => void onWithdraw()}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {withdrawMut.isPending ? 'Withdrawing…' : 'Withdraw Exit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
