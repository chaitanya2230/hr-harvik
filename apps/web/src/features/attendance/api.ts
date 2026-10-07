import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';

export interface AttendanceRecord {
  id: string;
  employeeId: {
    _id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation?: string;
  };
  date: string;
  status: 'Present' | 'Absent' | 'Half Day' | 'Holiday' | 'Leave';
  workMode: 'Office' | 'WFH' | null;
  checkIn: string | null;
  checkOut: string | null;
  source: 'Self' | 'Manual' | 'Correction' | 'LeaveSync' | 'NightlyJob';
  note: string | null;
  createdAt: string;
}

export interface MonthlyGridResponse {
  yearMonth: string;
  records: Array<{
    employee: { id: string; employeeCode: string; name: string };
    days: Record<string, { status: string; workMode: string | null }>;
    summary: { present: number; absent: number; halfDay: number; leave: number; holiday: number };
  }>;
}

export interface AttendanceCorrectionRecord {
  id: string;
  employeeId: {
    _id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation?: string;
  };
  date: string;
  requestedStatus: 'Present' | 'Absent' | 'Half Day' | 'Leave';
  requestedWorkMode: 'Office' | 'WFH' | null;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewNote: string | null;
  createdAt: string;
}

export interface HolidayRecord {
  id: string;
  date: string;
  name: string;
}

/**
 * AGENTS.md §8.5 / §10 — attendance list read. Mirrors `GET /api/v1/attendance`,
 * whose real query surface is `date`, `month` (YYYY-MM, enforced by the
 * controller), `status`, `employeeId`, `departmentId`, `page` and `limit`
 * (server-capped at 100); the response carries
 * `meta: { total, page, limit }` so tables can paginate server-side.
 *
 * `enabled` lets a view hold the request until it knows which employee to
 * ask for (e.g. the Calendar tab waiting on its picker) without inventing
 * backend parameters.
 */
export function useAttendanceList(
  params: {
    date?: string;
    month?: string;
    status?: string;
    employeeId?: string;
    page?: number;
    limit?: number;
  },
  enabled = true,
) {
  const query = new URLSearchParams();
  if (params.date) query.set('date', params.date);
  if (params.month) query.set('month', params.month);
  if (params.status) query.set('status', params.status);
  if (params.employeeId) query.set('employeeId', params.employeeId);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));

  return useQuery({
    queryKey: ['attendance', params],
    enabled,
    queryFn: () =>
      apiRequest<{ data: AttendanceRecord[]; meta: { total: number; page: number; limit: number } }>(
        `/attendance?${query.toString()}`,
      ),
  });
}

export function useMonthlyAttendanceGrid(yearMonth: string, departmentId?: string, employeeId?: string) {
  const query = new URLSearchParams({ month: yearMonth });
  if (departmentId) query.set('departmentId', departmentId);
  if (employeeId) query.set('employeeId', employeeId);

  return useQuery({
    queryKey: ['attendance', 'monthly', yearMonth, departmentId, employeeId],
    queryFn: () =>
      apiRequest<{ data: MonthlyGridResponse }>(`/attendance/monthly?${query.toString()}`).then(
        (r) => r.data,
      ),
  });
}

export function useMarkAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      employeeId?: string;
      date: string;
      status: string;
      workMode?: string | null;
      checkIn?: string | null;
      checkOut?: string | null;
      note?: string | null;
    }) => apiRequest<{ data: AttendanceRecord }>('/attendance', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useAttendanceCorrections(status?: string, employeeId?: string) {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (employeeId) query.set('employeeId', employeeId);

  return useQuery({
    queryKey: ['attendance', 'corrections', status, employeeId],
    queryFn: () =>
      apiRequest<{ data: AttendanceCorrectionRecord[] }>(
        `/attendance/corrections?${query.toString()}`,
      ).then((r) => r.data),
  });
}

export function useRequestCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      employeeId?: string;
      date: string;
      requestedStatus: string;
      requestedWorkMode?: string | null;
      reason: string;
    }) => apiRequest<{ data: AttendanceCorrectionRecord }>('/attendance/corrections', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance', 'corrections'] });
    },
  });
}

export function useReviewCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      status: 'Approved' | 'Rejected';
      reviewNote?: string | null;
    }) =>
      apiRequest<{ data: AttendanceCorrectionRecord }>(`/attendance/corrections/${id}/review`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useHolidays(year?: number) {
  const query = year ? `?year=${year}` : '';
  return useQuery({
    queryKey: ['attendance', 'holidays', year],
    queryFn: () => apiRequest<{ data: HolidayRecord[] }>(`/attendance/holidays${query}`).then((r) => r.data),
  });
}

export function useCreateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { date: string; name: string }) =>
      apiRequest<{ data: HolidayRecord }>('/attendance/holidays', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance', 'holidays'] });
    },
  });
}
