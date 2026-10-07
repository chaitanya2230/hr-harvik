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
  approverId?: { _id: string; email: string } | null;
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

/** MIME whitelist mirroring the backend document storage (§8.6 / §13). */
export const LEAVE_DOC_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
] as const;

/** Mirrors the backend's default `MAX_UPLOAD_MB=10`. */
export const LEAVE_DOC_MAX_BYTES = 10 * 1024 * 1024;

export interface LeaveDocumentUpload {
  documentId: string;
  title: string;
  employeeId: string;
  originalName: string;
  mimeType: string;
  size: number;
}

/**
 * AGENTS.md §8.6 — supporting-document upload for leave requests
 * (`POST /leave/documents`, multipart). The resulting `documentId` is passed
 * to `useApplyLeave`, where the backend re-validates ownership and the
 * `requiresDocument` rule.
 */
export function useUploadLeaveDocument() {
  return useMutation({
    mutationFn: ({ file, employeeId }: { file: File; employeeId?: string }) => {
      const form = new FormData();
      form.append('file', file);
      if (employeeId) form.append('employeeId', employeeId);
      return apiRequest<{ data: LeaveDocumentUpload }>('/leave/documents', {
        method: 'POST',
        body: form,
      });
    },
  });
}
