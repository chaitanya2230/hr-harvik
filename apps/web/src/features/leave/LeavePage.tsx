import { useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../../components/Toast';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../../components/ui';
import {
  useApplyLeave,
  useCancelLeave,
  useCreateLeaveType,
  useLeaveBalances,
  useLeaveRequests,
  useLeaveTypes,
  useReviewLeave,
  useTeamCalendar,
} from './api';

export function LeavePage() {
  const { account } = useAuth();
  const notify = useToast();
  const isHr = account?.role === 'HR Admin' || account?.role === 'HR Manager';
  const isManager = account?.role === 'Manager' || isHr;

  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const currentYear = new Date().getUTCFullYear();

  const [activeTab, setActiveTab] = useState<'my' | 'approvals' | 'calendar' | 'types'>('my');
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  // Modals
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState<{ id: string; action: 'Approved' | 'Rejected' } | null>(null);
  const [showCreateTypeModal, setShowCreateTypeModal] = useState(false);

  // Form states
  const [applyForm, setApplyForm] = useState({
    leaveTypeId: '',
    fromDate: today,
    toDate: today,
    halfDay: false,
    reason: '',
  });

  const [reviewNote, setReviewNote] = useState('');

  const [typeForm, setTypeForm] = useState({
    name: '',
    code: '',
    annualAllocation: 12,
    carryForward: false,
    maxCarryForward: 0,
    isPaid: true,
    requiresDocument: false,
  });

  // Queries
  const typesQuery = useLeaveTypes(isHr);
  const balancesQuery = useLeaveBalances({ year: currentYear });
  const myRequestsQuery = useLeaveRequests({
    employeeId: account?.role === 'Employee' ? account.employeeId ?? undefined : undefined,
  });
  const approvalsQuery = useLeaveRequests(
    isManager
      ? { status: 'Pending' }
      : { status: 'Pending', employeeId: '000000000000000000000000' }, // dummy if not manager
  );
  const calendarQuery = useTeamCalendar(selectedMonth);

  // Mutations
  const applyMutation = useApplyLeave();
  const reviewMutation = useReviewLeave();
  const cancelMutation = useCancelLeave();
  const createTypeMutation = useCreateLeaveType();

  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyForm.leaveTypeId) {
      notify('error', 'Please select a leave type');
      return;
    }
    try {
      await applyMutation.mutateAsync(applyForm);
      notify('success', 'Leave applied successfully');
      setShowApplyModal(false);
      setApplyForm({
        leaveTypeId: '',
        fromDate: today,
        toDate: today,
        halfDay: false,
        reason: '',
      });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to apply leave');
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showReviewModal) return;
    if (showReviewModal.action === 'Rejected' && (!reviewNote || !reviewNote.trim())) {
      notify('error', 'Decision note is required when rejecting leave');
      return;
    }
    try {
      await reviewMutation.mutateAsync({
        id: showReviewModal.id,
        status: showReviewModal.action,
        decisionNote: reviewNote || null,
      });
      notify('success', `Leave request ${showReviewModal.action.toLowerCase()}`);
      setShowReviewModal(null);
      setReviewNote('');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to review leave');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this leave request?')) return;
    try {
      await cancelMutation.mutateAsync(id);
      notify('success', 'Leave request cancelled');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to cancel leave');
    }
  };

  const handleCreateTypeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createTypeMutation.mutateAsync(typeForm);
      notify('success', 'Leave type created successfully');
      setShowCreateTypeModal(false);
      setTypeForm({
        name: '',
        code: '',
        annualAllocation: 12,
        carryForward: false,
        maxCarryForward: 0,
        isPaid: true,
        requiresDocument: false,
      });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to create leave type');
    }
  };

  return (
    <div>
      <PageHeader
        title="Leave Management"
        subtitle="Manage leave balances, applications, approvals, and team calendars"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowApplyModal(true)}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 shadow-sm"
            >
              + Apply Leave
            </button>
            {isHr && (
              <button
                type="button"
                onClick={() => setShowCreateTypeModal(true)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                + New Leave Type
              </button>
            )}
          </div>
        }
      />

      {/* Leave Balances Cards */}
      <div className="mb-6">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Leave Balances ({currentYear})</h2>
        {balancesQuery.isPending ? (
          <LoadingState label="Loading leave balances..." />
        ) : balancesQuery.isError ? (
          <ErrorState error={balancesQuery.error} onRetry={() => void balancesQuery.refetch()} />
        ) : balancesQuery.data.length === 0 ? (
          <p className="text-sm text-slate-500">No leave balances allocated for this year.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {balancesQuery.data.map((bal) => {
              const available =
                bal.allocated + bal.carriedForward - bal.used - bal.pending;
              return (
                <Card key={bal.id}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        {bal.leaveTypeId?.name ?? 'Leave'}
                      </p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{available} days</p>
                      <p className="text-xs text-slate-500">Available to take</p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-medium ${
                        bal.leaveTypeId?.isPaid
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {bal.leaveTypeId?.isPaid ? 'Paid' : 'Unpaid'}
                    </span>
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <span className="block text-slate-400">Allocated</span>
                      <span className="font-semibold text-slate-700">{bal.allocated}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400">Used</span>
                      <span className="font-semibold text-rose-600">{bal.used}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400">Pending</span>
                      <span className="font-semibold text-amber-600">{bal.pending}</span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 flex border-b border-slate-200">
        {(
          [
            { id: 'my', label: 'My Leave Requests' },
            ...(isManager ? [{ id: 'approvals', label: 'Pending Approvals' }] : []),
            { id: 'calendar', label: 'Team Calendar' },
            ...(isHr ? [{ id: 'types', label: 'Leave Types Configuration' }] : []),
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-brand-600 text-brand-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* My Leave Requests Tab */}
      {activeTab === 'my' && (
        <div className="space-y-4">
          {myRequestsQuery.isPending ? (
            <LoadingState label="Loading leave requests..." />
          ) : myRequestsQuery.isError ? (
            <ErrorState error={myRequestsQuery.error} onRetry={() => void myRequestsQuery.refetch()} />
          ) : myRequestsQuery.data.data.length === 0 ? (
            <EmptyState title="No leave requests found" hint="Use '+ Apply Leave' above to submit a request." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Leave Type</th>
                    <th className="px-4 py-3 text-left font-medium">From</th>
                    <th className="px-4 py-3 text-left font-medium">To</th>
                    <th className="px-4 py-3 text-left font-medium">Days</th>
                    <th className="px-4 py-3 text-left font-medium">Reason</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {myRequestsQuery.data.data.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{req.leaveTypeId?.name}</td>
                      <td className="px-4 py-3 text-slate-700">{req.fromDate}</td>
                      <td className="px-4 py-3 text-slate-700">{req.toDate}</td>
                      <td className="px-4 py-3 text-slate-700 font-semibold">
                        {req.days} {req.halfDay ? '(Half Day)' : ''}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{req.reason}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            req.status === 'Approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : req.status === 'Rejected'
                                ? 'bg-rose-100 text-rose-800'
                                : req.status === 'Cancelled'
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(req.status === 'Pending' || (req.status === 'Approved' && req.fromDate > today)) && (
                          <button
                            type="button"
                            onClick={() => void handleCancel(req.id)}
                            className="text-xs font-medium text-rose-600 hover:text-rose-800"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pending Approvals Tab (Managers/HR) */}
      {activeTab === 'approvals' && (
        <div className="space-y-4">
          {approvalsQuery.isPending ? (
            <LoadingState label="Loading approval queue..." />
          ) : approvalsQuery.isError ? (
            <ErrorState error={approvalsQuery.error} onRetry={() => void approvalsQuery.refetch()} />
          ) : approvalsQuery.data.data.length === 0 ? (
            <EmptyState title="No pending approvals" hint="All team leave requests have been reviewed." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Employee</th>
                    <th className="px-4 py-3 text-left font-medium">Leave Type</th>
                    <th className="px-4 py-3 text-left font-medium">Period</th>
                    <th className="px-4 py-3 text-left font-medium">Days</th>
                    <th className="px-4 py-3 text-left font-medium">Reason</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {approvalsQuery.data.data.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {req.employeeId ? `${req.employeeId.firstName} ${req.employeeId.lastName}` : '—'}
                        <span className="block text-xs text-slate-500">{req.employeeId?.employeeCode}</span>
                      </td>
                      <td className="px-4 py-3">{req.leaveTypeId?.name}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {req.fromDate} to {req.toDate}
                      </td>
                      <td className="px-4 py-3 font-semibold">{req.days}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{req.reason}</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => setShowReviewModal({ id: req.id, action: 'Approved' })}
                          className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowReviewModal({ id: req.id, action: 'Rejected' })}
                          className="rounded border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Team Calendar Tab */}
      {activeTab === 'calendar' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 bg-white p-3 rounded-lg border border-slate-200">
            <label className="text-sm font-medium text-slate-700">Month:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>

          {calendarQuery.isPending ? (
            <LoadingState label="Loading team calendar..." />
          ) : calendarQuery.isError ? (
            <ErrorState error={calendarQuery.error} onRetry={() => void calendarQuery.refetch()} />
          ) : calendarQuery.data.length === 0 ? (
            <EmptyState title="No approved leaves for this month" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {calendarQuery.data.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      {c.leaveType}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      {c.days} {c.days === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-medium text-slate-900">{c.employee.name}</h3>
                  <p className="text-xs text-slate-500">{c.employee.employeeCode}</p>
                  <p className="text-xs text-slate-700 mt-2 font-mono">
                    {c.fromDate} {c.fromDate !== c.toDate ? `→ ${c.toDate}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Leave Types Configuration Tab (HR Admin) */}
      {activeTab === 'types' && (
        <div className="space-y-4">
          {typesQuery.isPending ? (
            <LoadingState label="Loading leave types..." />
          ) : typesQuery.isError ? (
            <ErrorState error={typesQuery.error} onRetry={() => void typesQuery.refetch()} />
          ) : typesQuery.data.length === 0 ? (
            <EmptyState title="No leave types configured" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Code</th>
                    <th className="px-4 py-3 text-left font-medium">Annual Allocation</th>
                    <th className="px-4 py-3 text-left font-medium">Carry Forward</th>
                    <th className="px-4 py-3 text-left font-medium">Paid</th>
                    <th className="px-4 py-3 text-left font-medium">Doc Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {typesQuery.data.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{t.name}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{t.code}</td>
                      <td className="px-4 py-3">{t.annualAllocation} days</td>
                      <td className="px-4 py-3">
                        {t.carryForward ? `Yes (Max: ${t.maxCarryForward})` : 'No'}
                      </td>
                      <td className="px-4 py-3">{t.isPaid ? 'Yes' : 'No (Unpaid)'}</td>
                      <td className="px-4 py-3">{t.requiresDocument ? 'Required' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Apply Leave Modal */}
      {showApplyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Apply for Leave</h2>
            <form onSubmit={handleApplySubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Leave Type</label>
                <select
                  required
                  value={applyForm.leaveTypeId}
                  onChange={(e) => setApplyForm({ ...applyForm, leaveTypeId: e.target.value })}
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                >
                  <option value="">Select a leave type...</option>
                  {typesQuery.data?.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name} ({lt.isPaid ? 'Paid' : 'Unpaid'})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">From Date</label>
                  <input
                    type="date"
                    required
                    value={applyForm.fromDate}
                    onChange={(e) => {
                      const from = e.target.value;
                      setApplyForm({
                        ...applyForm,
                        fromDate: from,
                        toDate: applyForm.toDate < from ? from : applyForm.toDate,
                      });
                    }}
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">To Date</label>
                  <input
                    type="date"
                    required
                    min={applyForm.fromDate}
                    value={applyForm.toDate}
                    onChange={(e) => setApplyForm({ ...applyForm, toDate: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="halfDay"
                  checked={applyForm.halfDay}
                  onChange={(e) => {
                    const isHalf = e.target.checked;
                    setApplyForm({
                      ...applyForm,
                      halfDay: isHalf,
                      toDate: isHalf ? applyForm.fromDate : applyForm.toDate,
                    });
                  }}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="halfDay" className="text-xs font-medium text-slate-700">
                  Half-day leave (only applies to single day)
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Reason</label>
                <textarea
                  required
                  rows={3}
                  value={applyForm.reason}
                  onChange={(e) => setApplyForm({ ...applyForm, reason: e.target.value })}
                  placeholder="State the reason for leave..."
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowApplyModal(false)}
                  className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={applyMutation.isPending}
                  className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  {applyMutation.isPending ? 'Submitting...' : 'Apply'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Leave Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              {showReviewModal.action === 'Approved' ? 'Approve Leave Request' : 'Reject Leave Request'}
            </h2>
            <form onSubmit={handleReviewSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Decision Note {showReviewModal.action === 'Rejected' ? '(Required)' : '(Optional)'}
                </label>
                <textarea
                  rows={3}
                  required={showReviewModal.action === 'Rejected'}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder={
                    showReviewModal.action === 'Rejected'
                      ? 'Please state the reason for rejecting...'
                      : 'Add an optional approval note...'
                  }
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowReviewModal(null);
                    setReviewNote('');
                  }}
                  className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reviewMutation.isPending}
                  className={`rounded px-3 py-1.5 text-sm font-medium text-white ${
                    showReviewModal.action === 'Approved'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {reviewMutation.isPending ? 'Saving...' : `Confirm ${showReviewModal.action}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Leave Type Modal (HR Admin) */}
      {showCreateTypeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Create Leave Type</h2>
            <form onSubmit={handleCreateTypeSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={typeForm.name}
                  onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
                  placeholder="e.g. Maternity Leave"
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Code</label>
                <input
                  type="text"
                  required
                  value={typeForm.code}
                  onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. MATERNITY"
                  className="w-full rounded border border-slate-300 p-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Annual Allocation (Days)</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={typeForm.annualAllocation}
                  onChange={(e) => setTypeForm({ ...typeForm, annualAllocation: parseInt(e.target.value, 10) || 0 })}
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPaid"
                  checked={typeForm.isPaid}
                  onChange={(e) => setTypeForm({ ...typeForm, isPaid: e.target.checked })}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="isPaid" className="text-xs font-medium text-slate-700">
                  Paid Leave
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="carryForward"
                  checked={typeForm.carryForward}
                  onChange={(e) => setTypeForm({ ...typeForm, carryForward: e.target.checked })}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="carryForward" className="text-xs font-medium text-slate-700">
                  Carry Forward Unused Days
                </label>
              </div>
              {typeForm.carryForward && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Max Carry Forward Days</label>
                  <input
                    type="number"
                    min="0"
                    value={typeForm.maxCarryForward}
                    onChange={(e) => setTypeForm({ ...typeForm, maxCarryForward: parseInt(e.target.value, 10) || 0 })}
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="requiresDocument"
                  checked={typeForm.requiresDocument}
                  onChange={(e) => setTypeForm({ ...typeForm, requiresDocument: e.target.checked })}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="requiresDocument" className="text-xs font-medium text-slate-700">
                  Requires Supporting Document (e.g. Medical Certificate)
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateTypeModal(false)}
                  className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createTypeMutation.isPending}
                  className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  {createTypeMutation.isPending ? 'Saving...' : 'Create Type'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
