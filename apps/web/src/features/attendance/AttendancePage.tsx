import { useMemo, useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../../components/Toast';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../../components/ui';
import {
  useAttendanceCorrections,
  useAttendanceList,
  useCreateHoliday,
  useHolidays,
  useMarkAttendance,
  useMonthlyAttendanceGrid,
  useRequestCorrection,
  useReviewCorrection,
  type AttendanceRecord,
} from './api';

/**
 * AGENTS.md §8.5 — status → badge colours shared by the Daily, Calendar and
 * History views so a status always renders the same colour everywhere.
 */
const STATUS_BADGE_CLASSES: Record<string, string> = {
  Present: 'bg-emerald-100 text-emerald-800',
  Absent: 'bg-rose-100 text-rose-800',
  'Half Day': 'bg-blue-100 text-blue-800',
  Leave: 'bg-amber-100 text-amber-800',
  Holiday: 'bg-purple-100 text-purple-800',
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * AGENTS.md §8.5 — pure `YYYY-MM` helpers for the Calendar tab's month
 * navigation. Uses UTC arithmetic so daylight-saving shifts can never move a
 * date across a month boundary.
 */
function shiftMonth(yearMonth: string, delta: number): string {
  const year = parseInt(yearMonth.slice(0, 4), 10);
  const month = parseInt(yearMonth.slice(5, 7), 10);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(yearMonth: string): string {
  const monthIndex = parseInt(yearMonth.slice(5, 7), 10) - 1;
  return `${MONTH_LABELS[monthIndex] ?? ''} ${yearMonth.slice(0, 4)}`;
}

/**
 * AGENTS.md §9 — employee picker for the Calendar/History tabs. The option
 * roster comes from the team-scoped monthly grid (§8.5), so a Manager only
 * ever sees their own reporting hierarchy and an Employee never sees a picker
 * at all; the backend remains the authority on scope (§6).
 */
function EmployeePicker({
  id,
  label,
  value,
  onChange,
  options,
  allowAll,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; employeeCode: string; name: string }>;
  allowAll: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      >
        {allowAll && <option value="">All employees</option>}
        {options.length === 0 && <option value="">No employees available</option>}
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.name} ({opt.employeeCode})
          </option>
        ))}
      </select>
    </div>
  );
}

export function AttendancePage() {
  const { account } = useAuth();
  const notify = useToast();
  const isHr = account?.role === 'HR Admin' || account?.role === 'HR Manager';
  const isManager = account?.role === 'Manager' || isHr;

  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

  const [activeTab, setActiveTab] = useState<
    'daily' | 'monthly' | 'calendar' | 'history' | 'corrections' | 'holidays'
  >('daily');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [page, setPage] = useState(1);

  // Calendar tab (AGENTS.md §8.5) — one month, one selected employee.
  const [calendarMonth, setCalendarMonth] = useState(currentMonth);
  const [calendarEmployeeId, setCalendarEmployeeId] = useState('');

  // History tab (AGENTS.md §8.5) — filterable, server-paginated chronology.
  const [historyMonth, setHistoryMonth] = useState(currentMonth);
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyEmployeeId, setHistoryEmployeeId] = useState('');
  const [historyPage, setHistoryPage] = useState(1);

  // Modals
  const [showMarkModal, setShowMarkModal] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState<string | null>(null);
  const [showHolidayModal, setShowHolidayModal] = useState(false);

  // Form states
  const [markForm, setMarkForm] = useState({
    date: today,
    status: 'Present',
    workMode: 'Office',
    checkIn: '09:00',
    checkOut: '18:00',
    note: '',
  });

  const [correctionForm, setCorrectionForm] = useState({
    date: today,
    requestedStatus: 'Present',
    requestedWorkMode: 'Office',
    reason: '',
  });

  const [reviewNote, setReviewNote] = useState('');
  const [holidayForm, setHolidayForm] = useState({ date: today, name: '' });

  // Queries & Mutations
  const listQuery = useAttendanceList({
    date: activeTab === 'daily' ? selectedDate : undefined,
    page,
    limit: 20,
  });

  const monthlyQuery = useMonthlyAttendanceGrid(selectedMonth);
  const correctionsQuery = useAttendanceCorrections();
  const holidaysQuery = useHolidays(parseInt(selectedMonth.slice(0, 4), 10));

  // --- Calendar & History tabs (AGENTS.md §8.5, §6) ------------------------
  // The monthly grid returns one row per employee in the caller's scope
  // (HR → everybody, Manager → reporting hierarchy, Employee → self), so it
  // doubles as the picker roster without calling the HR-only /employees list.
  const isSelfScoped = account?.role === 'Employee';
  const roster = monthlyQuery.data?.records.map((r) => r.employee) ?? [];

  // Calendar always targets exactly one employee: the viewer's own record
  // when one exists, otherwise the first employee of the scoped roster.
  const defaultEmployeeId =
    roster.find((e) => e.id === account?.employeeId)?.id ??
    roster[0]?.id ??
    account?.employeeId ??
    '';
  const calendarTargetId = calendarEmployeeId || defaultEmployeeId;

  // AGENTS.md §10 — only parameters the backend actually implements are sent:
  // month (YYYY-MM), status, employeeId, page and limit (capped at 100).
  const calendarQuery = useAttendanceList(
    { month: calendarMonth, employeeId: calendarTargetId || undefined, limit: 100 },
    Boolean(calendarTargetId),
  );
  const historyQuery = useAttendanceList({
    month: historyMonth || undefined,
    status: historyStatus || undefined,
    // The Employee role is self-scoped server-side; never send a picker id.
    employeeId: isSelfScoped ? undefined : historyEmployeeId || undefined,
    page: historyPage,
    limit: 20,
  });

  const historyMeta = historyQuery.data?.meta;
  const historyPageCount = historyMeta
    ? Math.max(1, Math.ceil(historyMeta.total / historyMeta.limit))
    : 1;
  const historyRows = historyQuery.data?.data ?? [];
  // Omit the Employee column for the self-scoped Employee view when the
  // payload carries no employee info (AGENTS.md §6 RBAC / §8.5 views).
  const showEmployeeColumn = !isSelfScoped || historyRows.some((row) => row.employeeId != null);

  // Month view data: attendance records keyed by date, plus a fixed 6-week
  // (42-cell) grid of days for the selected month.
  const calendarRecordsByDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const record of calendarQuery.data?.data ?? []) {
      map.set(record.date, record);
    }
    return map;
  }, [calendarQuery.data]);

  const calendarCells = useMemo(() => {
    const year = parseInt(calendarMonth.slice(0, 4), 10);
    const month = parseInt(calendarMonth.slice(5, 7), 10);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const cells: Array<{ date: string; day: number; weekday: number } | null> = [];
    for (let i = 0; i < startWeekday; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({
        date: `${calendarMonth}-${String(day).padStart(2, '0')}`,
        day,
        weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
      });
    }
    while (cells.length < 42) cells.push(null);
    return cells;
  }, [calendarMonth]);

  const markMutation = useMarkAttendance();
  const correctionMutation = useRequestCorrection();
  const reviewMutation = useReviewCorrection();
  const holidayMutation = useCreateHoliday();

  const handleMarkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await markMutation.mutateAsync({
        date: markForm.date,
        status: markForm.status,
        workMode: markForm.status === 'Present' || markForm.status === 'Half Day' ? markForm.workMode : null,
        checkIn: markForm.checkIn || null,
        checkOut: markForm.checkOut || null,
        note: markForm.note || null,
      });
      notify('success', 'Attendance marked successfully');
      setShowMarkModal(false);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to mark attendance');
    }
  };

  const handleCorrectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await correctionMutation.mutateAsync({
        date: correctionForm.date,
        requestedStatus: correctionForm.requestedStatus,
        requestedWorkMode:
          correctionForm.requestedStatus === 'Present' || correctionForm.requestedStatus === 'Half Day'
            ? correctionForm.requestedWorkMode
            : null,
        reason: correctionForm.reason,
      });
      notify('success', 'Correction request submitted');
      setShowCorrectionModal(false);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to submit correction');
    }
  };

  const handleReview = async (id: string, status: 'Approved' | 'Rejected') => {
    try {
      await reviewMutation.mutateAsync({ id, status, reviewNote: reviewNote || null });
      notify('success', `Correction ${status.toLowerCase()} successfully`);
      setShowReviewModal(null);
      setReviewNote('');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to review correction');
    }
  };

  const handleHolidaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await holidayMutation.mutateAsync(holidayForm);
      notify('success', 'Holiday added successfully');
      setShowHolidayModal(false);
      setHolidayForm({ date: today, name: '' });
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to add holiday');
    }
  };

  return (
    <div>
      <PageHeader
        title="Attendance Management"
        subtitle="Track daily employee attendance, monthly matrices, and correction requests"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowMarkModal(true)}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 shadow-sm"
            >
              Punch / Mark Attendance
            </button>
            <button
              type="button"
              onClick={() => setShowCorrectionModal(true)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Request Correction
            </button>
            {isHr && (
              <button
                type="button"
                onClick={() => setShowHolidayModal(true)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                + Add Holiday
              </button>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="mb-6 flex border-b border-slate-200">
        {(
          [
            { id: 'daily', label: 'Daily Attendance' },
            { id: 'monthly', label: 'Monthly Grid' },
            { id: 'calendar', label: 'Calendar' },
            { id: 'history', label: 'History' },
            { id: 'corrections', label: 'Corrections' },
            { id: 'holidays', label: 'Holidays' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
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

      {/* Daily Attendance Tab */}
      {activeTab === 'daily' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 bg-white p-3 rounded-lg border border-slate-200">
            <label className="text-sm font-medium text-slate-700">Date:</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>

          {listQuery.isPending ? (
            <LoadingState label="Loading attendance records..." />
          ) : listQuery.isError ? (
            <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
          ) : listQuery.data.data.length === 0 ? (
            <EmptyState title="No attendance records found for this date" hint="Mark attendance or run sync to view records." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Employee</th>
                    <th className="px-4 py-3 text-left font-medium">Designation</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Work Mode</th>
                    <th className="px-4 py-3 text-left font-medium">Check In</th>
                    <th className="px-4 py-3 text-left font-medium">Check Out</th>
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {listQuery.data.data.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {row.employeeId ? `${row.employeeId.firstName} ${row.employeeId.lastName}` : '—'}
                        <span className="block text-xs text-slate-500">{row.employeeId?.employeeCode}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.employeeId?.designation ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            row.status === 'Present'
                              ? 'bg-emerald-100 text-emerald-800'
                              : row.status === 'Absent'
                                ? 'bg-rose-100 text-rose-800'
                                : row.status === 'Leave'
                                  ? 'bg-amber-100 text-amber-800'
                                  : row.status === 'Holiday'
                                    ? 'bg-purple-100 text-purple-800'
                                    : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.workMode ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{row.checkIn ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{row.checkOut ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Monthly Grid Tab */}
      {activeTab === 'monthly' && (
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

          {monthlyQuery.isPending ? (
            <LoadingState label="Loading monthly grid..." />
          ) : monthlyQuery.isError ? (
            <ErrorState error={monthlyQuery.error} onRetry={() => void monthlyQuery.refetch()} />
          ) : monthlyQuery.data.records.length === 0 ? (
            <EmptyState title="No records found for this month" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm p-4">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-700 sticky left-0 bg-slate-50">
                      Employee
                    </th>
                    <th className="px-2 py-2 text-center font-medium text-emerald-700">P</th>
                    <th className="px-2 py-2 text-center font-medium text-rose-700">A</th>
                    <th className="px-2 py-2 text-center font-medium text-blue-700">HD</th>
                    <th className="px-2 py-2 text-center font-medium text-amber-700">L</th>
                    <th className="px-2 py-2 text-center font-medium text-purple-700">H</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {monthlyQuery.data.records.map((rec) => (
                    <tr key={rec.employee.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900 sticky left-0 bg-white">
                        {rec.employee.name}
                        <span className="block text-[10px] text-slate-500">{rec.employee.employeeCode}</span>
                      </td>
                      <td className="px-2 py-2 text-center font-semibold text-emerald-700">{rec.summary.present}</td>
                      <td className="px-2 py-2 text-center font-semibold text-rose-700">{rec.summary.absent}</td>
                      <td className="px-2 py-2 text-center font-semibold text-blue-700">{rec.summary.halfDay}</td>
                      <td className="px-2 py-2 text-center font-semibold text-amber-700">{rec.summary.leave}</td>
                      <td className="px-2 py-2 text-center font-semibold text-purple-700">{rec.summary.holiday}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Calendar Tab — AGENTS.md §8.5 month view for one selected employee */}
      {activeTab === 'calendar' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCalendarMonth((m) => shiftMonth(m, -1))}
                aria-label="Previous month"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                ‹
              </button>
              <span className="min-w-36 text-center text-sm font-semibold text-slate-800">
                {formatMonthLabel(calendarMonth)}
              </span>
              <button
                type="button"
                onClick={() => setCalendarMonth((m) => shiftMonth(m, 1))}
                aria-label="Next month"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setCalendarMonth(currentMonth)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Today
              </button>
            </div>
            {/* §6 — Employee role is self-scoped; the picker is never rendered. */}
            {!isSelfScoped && (
              <EmployeePicker
                id="calendar-employee-picker"
                label="Employee:"
                value={calendarTargetId}
                onChange={setCalendarEmployeeId}
                options={roster}
                allowAll={false}
              />
            )}
          </div>

          {!calendarTargetId ? (
            <EmptyState
              title="No employee selected"
              hint="Waiting for the employee list to load — pick an employee to see their calendar."
            />
          ) : calendarQuery.isPending ? (
            <LoadingState label="Loading calendar..." />
          ) : calendarQuery.isError ? (
            <ErrorState error={calendarQuery.error} onRetry={() => void calendarQuery.refetch()} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <table className="w-full table-fixed border-collapse text-xs">
                  <caption className="sr-only">
                    {`Attendance calendar for ${formatMonthLabel(calendarMonth)}`}
                  </caption>
                  <thead>
                    <tr>
                      {WEEKDAY_LABELS.map((label) => (
                        <th
                          key={label}
                          scope="col"
                          className="border border-slate-200 bg-slate-50 px-2 py-2 text-center font-medium text-slate-700"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 6 }, (_, week) => (
                      <tr key={week}>
                        {calendarCells.slice(week * 7, week * 7 + 7).map((cell, cellIndex) => {
                          if (!cell) {
                            return (
                              <td
                                key={`${week}-${cellIndex}`}
                                aria-hidden="true"
                                className="h-16 border border-slate-200 bg-slate-50/60"
                              />
                            );
                          }
                          const record = calendarRecordsByDate.get(cell.date);
                          const isWeekend = cell.weekday === 0 || cell.weekday === 6;
                          const title = record
                            ? `${record.date}: ${record.status}${
                                record.workMode ? ` · ${record.workMode}` : ''
                              }${record.checkIn ? ` · in ${record.checkIn}` : ''}${
                                record.checkOut ? ` · out ${record.checkOut}` : ''
                              }`
                            : isWeekend
                              ? `${cell.date}: weekend — no attendance record expected`
                              : `${cell.date}: no attendance record`;
                          return (
                            <td
                              key={cell.date}
                              title={title}
                              className="h-16 border border-slate-200 p-1 align-top"
                            >
                              <span
                                className={`block text-[10px] font-medium ${
                                  isWeekend && !record ? 'text-slate-400' : 'text-slate-500'
                                }`}
                              >
                                {cell.day}
                              </span>
                              {record ? (
                                <span
                                  className={`mt-1 block truncate rounded px-1 py-0.5 text-center text-[10px] font-medium ${
                                    STATUS_BADGE_CLASSES[record.status] ?? 'bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {record.status}
                                </span>
                              ) : isWeekend ? (
                                <span className="mt-1 block rounded bg-slate-100 px-1 py-0.5 text-center text-[10px] text-slate-500">
                                  Weekend
                                </span>
                              ) : (
                                <span
                                  className="mt-1 block text-center text-[10px] text-slate-400"
                                  aria-label="No attendance record"
                                >
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Legend — §9 accessibility: statuses are explained below the grid. */}
              <ul
                className="flex flex-wrap items-center gap-4 text-xs text-slate-600"
                aria-label="Calendar legend"
              >
                <li className="flex items-center gap-1.5">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                    Present
                  </span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-800">
                    Absent
                  </span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-800">
                    Half Day
                  </span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                    Leave
                  </span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-800">
                    Holiday
                  </span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
                    Weekend
                  </span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-slate-400">— No record</span>
                </li>
              </ul>
            </>
          )}
        </div>
      )}

      {/* History Tab — AGENTS.md §8.5 filterable chronological attendance table */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <label htmlFor="history-month" className="text-sm font-medium text-slate-700">
                Month:
              </label>
              <input
                id="history-month"
                type="month"
                value={historyMonth}
                onChange={(e) => {
                  setHistoryMonth(e.target.value);
                  setHistoryPage(1);
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="history-status" className="text-sm font-medium text-slate-700">
                Status:
              </label>
              <select
                id="history-status"
                value={historyStatus}
                onChange={(e) => {
                  setHistoryStatus(e.target.value);
                  setHistoryPage(1);
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="">All statuses</option>
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
                <option value="Half Day">Half Day</option>
                <option value="Leave">Leave</option>
                <option value="Holiday">Holiday</option>
              </select>
            </div>
            {!isSelfScoped && (
              <EmployeePicker
                id="history-employee-picker"
                label="Employee:"
                value={historyEmployeeId}
                onChange={(v) => {
                  setHistoryEmployeeId(v);
                  setHistoryPage(1);
                }}
                options={roster}
                allowAll
              />
            )}
          </div>

          {historyQuery.isPending ? (
            <LoadingState label="Loading attendance history..." />
          ) : historyQuery.isError ? (
            <ErrorState error={historyQuery.error} onRetry={() => void historyQuery.refetch()} />
          ) : historyQuery.data.data.length === 0 ? (
            <EmptyState
              title="No attendance records match these filters"
              hint="Adjust the month, status or employee filter and try again."
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      {showEmployeeColumn && (
                        <th className="px-4 py-3 text-left font-medium">Employee</th>
                      )}
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-left font-medium">Work Mode</th>
                      <th className="px-4 py-3 text-left font-medium">Check In</th>
                      <th className="px-4 py-3 text-left font-medium">Check Out</th>
                      <th className="px-4 py-3 text-left font-medium">Source</th>
                      <th className="px-4 py-3 text-left font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {historyRows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{row.date}</td>
                        {showEmployeeColumn && (
                          <td className="px-4 py-3 text-slate-700">
                            {row.employeeId
                              ? `${row.employeeId.firstName} ${row.employeeId.lastName}`
                              : '—'}
                            <span className="block text-xs text-slate-500">
                              {row.employeeId?.employeeCode}
                            </span>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              STATUS_BADGE_CLASSES[row.status] ?? 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{row.workMode ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{row.checkIn ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{row.checkOut ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{row.source}</td>
                        <td className="max-w-xs truncate px-4 py-3 text-slate-600">
                          {row.note ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Server-side pagination — §10 max limit 100, meta from the API. */}
              {historyMeta && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
                  <span className="text-slate-600">
                    {`Page ${historyMeta.page} of ${historyPageCount} · ${historyMeta.total} records`}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={historyPage >= historyPageCount}
                      onClick={() => setHistoryPage((p) => p + 1)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Corrections Tab */}
      {activeTab === 'corrections' && (
        <div className="space-y-4">
          {correctionsQuery.isPending ? (
            <LoadingState label="Loading correction requests..." />
          ) : correctionsQuery.isError ? (
            <ErrorState error={correctionsQuery.error} onRetry={() => void correctionsQuery.refetch()} />
          ) : correctionsQuery.data.length === 0 ? (
            <EmptyState title="No correction requests found" hint="Requests submitted will show here for approval." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Employee</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Requested Status</th>
                    <th className="px-4 py-3 text-left font-medium">Requested Work Mode</th>
                    <th className="px-4 py-3 text-left font-medium">Reason</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    {isManager && <th className="px-4 py-3 text-right font-medium">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {correctionsQuery.data.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {c.employeeId ? `${c.employeeId.firstName} ${c.employeeId.lastName}` : '—'}
                        <span className="block text-xs text-slate-500">{c.employeeId?.employeeCode}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{c.date}</td>
                      <td className="px-4 py-3">{c.requestedStatus}</td>
                      <td className="px-4 py-3">{c.requestedWorkMode ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{c.reason}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            c.status === 'Approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : c.status === 'Rejected'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      {isManager && (
                        <td className="px-4 py-3 text-right">
                          {c.status === 'Pending' ? (
                            <button
                              type="button"
                              onClick={() => setShowReviewModal(c.id)}
                              className="text-xs font-medium text-brand-600 hover:text-brand-800"
                            >
                              Review
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">Done</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Holidays Tab */}
      {activeTab === 'holidays' && (
        <div className="space-y-4">
          {holidaysQuery.isPending ? (
            <LoadingState label="Loading holidays..." />
          ) : holidaysQuery.isError ? (
            <ErrorState error={holidaysQuery.error} onRetry={() => void holidaysQuery.refetch()} />
          ) : holidaysQuery.data.length === 0 ? (
            <EmptyState title="No holidays configured" hint="Add company holidays to exempt them from attendance." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {holidaysQuery.data.map((h) => (
                <div key={h.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded">
                    Holiday
                  </span>
                  <h3 className="mt-2 text-base font-medium text-slate-900">{h.name}</h3>
                  <p className="text-sm text-slate-500 mt-1">{h.date}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mark Attendance Modal */}
      {showMarkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Mark Attendance</h2>
            <form onSubmit={handleMarkSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  required
                  max={today}
                  value={markForm.date}
                  onChange={(e) => setMarkForm({ ...markForm, date: e.target.value })}
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={markForm.status}
                  onChange={(e) => setMarkForm({ ...markForm, status: e.target.value })}
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                >
                  <option value="Present">Present</option>
                  <option value="Absent">Absent</option>
                  <option value="Half Day">Half Day</option>
                </select>
              </div>
              {(markForm.status === 'Present' || markForm.status === 'Half Day') && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Work Mode</label>
                  <select
                    value={markForm.workMode}
                    onChange={(e) => setMarkForm({ ...markForm, workMode: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                  >
                    <option value="Office">Office</option>
                    <option value="WFH">WFH</option>
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Check In</label>
                  <input
                    type="time"
                    value={markForm.checkIn}
                    onChange={(e) => setMarkForm({ ...markForm, checkIn: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Check Out</label>
                  <input
                    type="time"
                    value={markForm.checkOut}
                    onChange={(e) => setMarkForm({ ...markForm, checkOut: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={markForm.note}
                  onChange={(e) => setMarkForm({ ...markForm, note: e.target.value })}
                  placeholder="Notes..."
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMarkModal(false)}
                  className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={markMutation.isPending}
                  className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  {markMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Request Correction Modal */}
      {showCorrectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Request Attendance Correction</h2>
            <form onSubmit={handleCorrectionSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  required
                  max={today}
                  value={correctionForm.date}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, date: e.target.value })}
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Requested Status</label>
                <select
                  value={correctionForm.requestedStatus}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, requestedStatus: e.target.value })}
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                >
                  <option value="Present">Present</option>
                  <option value="Half Day">Half Day</option>
                  <option value="Absent">Absent</option>
                </select>
              </div>
              {(correctionForm.requestedStatus === 'Present' || correctionForm.requestedStatus === 'Half Day') && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Requested Work Mode</label>
                  <select
                    value={correctionForm.requestedWorkMode}
                    onChange={(e) => setCorrectionForm({ ...correctionForm, requestedWorkMode: e.target.value })}
                    className="w-full rounded border border-slate-300 p-2 text-sm"
                  >
                    <option value="Office">Office</option>
                    <option value="WFH">WFH</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Reason</label>
                <textarea
                  required
                  rows={3}
                  value={correctionForm.reason}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
                  placeholder="Explain why correction is requested..."
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCorrectionModal(false)}
                  className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={correctionMutation.isPending}
                  className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  {correctionMutation.isPending ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Correction Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Review Correction Request</h2>
            <p className="text-sm text-slate-500 mb-4">Choose to approve or reject this request.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Decision Note</label>
                <textarea
                  rows={2}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Optional note for approval or required for rejection..."
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReviewModal(null)}
                  className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleReview(showReviewModal, 'Rejected')}
                  className="rounded border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => handleReview(showReviewModal, 'Approved')}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Holiday Modal */}
      {showHolidayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Company Holiday</h2>
            <form onSubmit={handleHolidaySubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={holidayForm.date}
                  onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Holiday Name</label>
                <input
                  type="text"
                  required
                  value={holidayForm.name}
                  onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                  placeholder="e.g. Independence Day"
                  className="w-full rounded border border-slate-300 p-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowHolidayModal(false)}
                  className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={holidayMutation.isPending}
                  className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  {holidayMutation.isPending ? 'Saving...' : 'Add Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
