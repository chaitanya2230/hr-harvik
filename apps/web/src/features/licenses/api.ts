import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';
import type {
  AccessItemEntry,
  ItemResponse,
  LicenseAssignmentItem,
  LicenseItem,
  LicenseUtilization,
  ListResponse,
} from '../../api/types';

/** AGENTS.md P2 — license + access data access against the real API. */

export interface LicenseListParams {
  page: number;
  limit: number;
  q?: string;
  sort?: string;
  licenseType?: string;
  status?: string;
  provider?: string;
}

export interface LicenseAssignmentParams {
  page: number;
  limit: number;
  sort?: string;
  licenseId?: string;
  employeeId?: string;
  status?: string;
}

export interface AccessListParams {
  page: number;
  limit: number;
  sort?: string;
  employeeId?: string;
  system?: string;
  status?: string;
}

const toSearchParams = (params: object): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
};

export const licenseKeys = {
  all: ['licenses'] as const,
  list: (params: LicenseListParams) => ['licenses', 'list', params] as const,
  detail: (id: string) => ['licenses', 'detail', id] as const,
  utilization: (id: string) => ['licenses', 'utilization', id] as const,
  assignments: (params: LicenseAssignmentParams) => ['licenses', 'assignments', params] as const,
  access: (params: AccessListParams) => ['licenses', 'access', params] as const,
};

export function useLicenseList(params: LicenseListParams, enabled = true): UseQueryResult<ListResponse<LicenseItem>> {
  return useQuery({
    queryKey: licenseKeys.list(params),
    queryFn: () => apiRequest<ListResponse<LicenseItem>>(`/licenses?${toSearchParams(params)}`),
    enabled,
  });
}

export function useLicense(id: string | undefined): UseQueryResult<ItemResponse<LicenseItem>> {
  return useQuery({
    queryKey: licenseKeys.detail(id ?? ''),
    queryFn: () => apiRequest<ItemResponse<LicenseItem>>(`/licenses/${id}`),
    enabled: Boolean(id),
  });
}

export function useLicenseUtilization(id: string | undefined): UseQueryResult<ItemResponse<LicenseUtilization>> {
  return useQuery({
    queryKey: licenseKeys.utilization(id ?? ''),
    queryFn: () => apiRequest<ItemResponse<LicenseUtilization>>(`/licenses/${id}/utilization`),
    enabled: Boolean(id),
  });
}

export function useLicenseAssignments(params: LicenseAssignmentParams, enabled = true): UseQueryResult<ListResponse<LicenseAssignmentItem>> {
  return useQuery({
    queryKey: licenseKeys.assignments(params),
    queryFn: () =>
      apiRequest<ListResponse<LicenseAssignmentItem>>(`/licenses/assignments?${toSearchParams(params)}`),
    enabled,
  });
}

export function useAccessItems(params: AccessListParams, enabled = true): UseQueryResult<ListResponse<AccessItemEntry>> {
  return useQuery({
    queryKey: licenseKeys.access(params),
    queryFn: () => apiRequest<ListResponse<AccessItemEntry>>(`/access?${toSearchParams(params)}`),
    enabled,
  });
}

export type LicensePayload = Record<string, unknown>;

function useInvalidateLicenses() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: licenseKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateLicense() {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: (body: LicensePayload) =>
      apiRequest<ItemResponse<LicenseItem>>('/licenses', { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateLicense(id: string) {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: (body: LicensePayload) =>
      apiRequest<ItemResponse<LicenseItem>>(`/licenses/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteLicense() {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: (licenseId: string) => apiRequest<void>(`/licenses/${licenseId}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  });
}

export function useAssignLicense(id: string) {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: (body: LicensePayload) =>
      apiRequest<ItemResponse<LicenseAssignmentItem>>(`/licenses/${id}/assign`, { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useRevokeLicenseAssignment() {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: ({ assignmentId, revocationNote }: { assignmentId: string; revocationNote?: string }) =>
      apiRequest<ItemResponse<LicenseAssignmentItem>>(`/licenses/assignments/${assignmentId}/revoke`, {
        method: 'POST',
        body: { revocationNote },
      }),
    onSuccess: () => invalidate(),
  });
}

export function useRenewLicense(id: string) {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: (body: LicensePayload) =>
      apiRequest<ItemResponse<LicenseItem>>(`/licenses/${id}/renew`, { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useSuspendLicense(id: string) {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: (body: { suspend: boolean }) =>
      apiRequest<ItemResponse<LicenseItem>>(`/licenses/${id}/suspend`, { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useExpireLicense(id: string) {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: () => apiRequest<ItemResponse<LicenseItem>>(`/licenses/${id}/expire`, { method: 'POST' }),
    onSuccess: () => invalidate(),
  });
}

export function useRevokeLicense(id: string) {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: () => apiRequest<ItemResponse<LicenseItem>>(`/licenses/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => invalidate(),
  });
}

export function useCreateAccessItem() {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: (body: LicensePayload) =>
      apiRequest<ItemResponse<AccessItemEntry>>('/access', { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useRevokeAccessItem() {
  const invalidate = useInvalidateLicenses();
  return useMutation({
    mutationFn: (accessId: string) =>
      apiRequest<ItemResponse<AccessItemEntry>>(`/access/${accessId}/revoke`, { method: 'POST' }),
    onSuccess: () => invalidate(),
  });
}
