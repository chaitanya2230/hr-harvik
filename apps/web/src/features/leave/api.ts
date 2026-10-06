import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';

export interface LeaveTypeRecord {
  id: string;
  name: string;
  code: string;
  annualAllocation: number;
  carryForward: boolean;
  maxCarryForward: number;
  isPaid: boolean;
  requiresDocument: boolean;
  applicableEmploymentTypes: string[];
  isActive: boolean;
}

export interface LeaveBalanceRecord {
  id: string;
  employeeId: {
    _id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
  };
  leaveTypeId: {
    _id: string;
    name: string;
    code: string;
    annualAllocation: number;
    isPaid: boolean;
  };
  year: number;
  allocated: number;
  used: number;
  pending: number;
  carriedForward: number;
}

export interface LeaveRequestRecord {
  id: string;
  employeeId: {
    _id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation?: string;
  };
  leaveTypeId: {
    _id: string;
    name: string;
    code: string;
    isPaid: boolean;
  };
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  documentId?: string | null;
  decisionNote?: string | null;
  createdAt: string;
}

export interface CalendarLeaveRecord {
  id: string;
  employee: {
    id: string;
    name: string;
    employeeCode: string;
  };
  leaveType: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  status: string;
}

export function useLeaveTypes(includeInactive = false) {
  const query = includeInactive ? '?includeInactive=true' : '';
  return useQuery({
    queryKey: ['leave', 'types', includeInactive],
    queryFn: () => apiRequest<{ data: LeaveTypeRecord[] }>(`/leave/types${query}`).then((r) => r.data),
  });
}

export function useCreateLeaveType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<LeaveTypeRecord>) =>
      apiRequest<{ data: LeaveTypeRecord }>('/leave/types', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leave', 'types'] });
    },
  });
}

export function useLeaveBalances(params?: { employeeId?: string; year?: number }) {
  const query = new URLSearchParams();
  if (params?.employeeId) query.set('employeeId', params.employeeId);
  if (params?.year) query.set('year', String(params.year));

  return useQuery({
    queryKey: ['leave', 'balances', params],
    queryFn: () =>
      apiRequest<{ data: LeaveBalanceRecord[] }>(`/leave/balances?${query.toString()}`).then((r) => r.data),
  });
}

export function useLeaveRequests(params: {
  employeeId?: string;
  status?: string;
  leaveTypeId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params.employeeId) query.set('employeeId', params.employeeId);
  if (params.status) query.set('status', params.status);
  if (params.leaveTypeId) query.set('leaveTypeId', params.leaveTypeId);
  if (params.fromDate) query.set('fromDate', params.fromDate);
  if (params.toDate) query.set('toDate', params.toDate);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));

  return useQuery({
    queryKey: ['leave', 'requests', params],
    queryFn: () =>
      apiRequest<{ data: LeaveRequestRecord[]; meta: { total: number; page: number; limit: number } }>(
        `/leave/requests?${query.toString()}`,
      ),
  });
}

export function useApplyLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      employeeId?: string;
      leaveTypeId: string;
      fromDate: string;
      toDate: string;
      halfDay?: boolean;
      reason: string;
      documentId?: string | null;
    }) => apiRequest<{ data: LeaveRequestRecord }>('/leave/requests', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leave'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useReviewLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      status: 'Approved' | 'Rejected';
      decisionNote?: string | null;
    }) =>
      apiRequest<{ data: LeaveRequestRecord }>(`/leave/requests/${id}/review`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leave'] });
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCancelLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ data: LeaveRequestRecord }>(`/leave/requests/${id}/cancel`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leave'] });
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useTeamCalendar(month: string) {
  return useQuery({
    queryKey: ['leave', 'calendar', month],
    queryFn: () =>
      apiRequest<{ data: CalendarLeaveRecord[] }>(`/leave/calendar?month=${month}`).then((r) => r.data),
  });
}
