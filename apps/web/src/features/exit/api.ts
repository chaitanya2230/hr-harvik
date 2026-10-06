import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';
import type {
  ExitView,
  ItemResponse,
  ListResponse,
} from '../../api/types';

/**
 * AGENTS.md §8.10 P3 — exit data access.
 * Every read goes through TanStack Query against the real API.
 * No mock data anywhere.
 */

export interface ExitListParams {
  page: number;
  limit: number;
  stage?: string;
  q?: string;
  departmentId?: string;
}

const toSearchParams = (params: object): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
};

export const exitKeys = {
  all: ['exit'] as const,
  list: (params: ExitListParams) => ['exit', 'list', params] as const,
  detail: (employeeId: string) => ['exit', 'detail', employeeId] as const,
};

export function useExitList(
  params: ExitListParams,
  enabled = true,
): UseQueryResult<ListResponse<ExitView>> {
  return useQuery({
    queryKey: exitKeys.list(params),
    queryFn: () => apiRequest<ListResponse<ExitView>>(`/exit?${toSearchParams(params)}`),
    enabled,
  });
}

export function useExitForEmployee(
  employeeId: string | undefined,
): UseQueryResult<ItemResponse<ExitView>> {
  return useQuery({
    queryKey: exitKeys.detail(employeeId ?? ''),
    queryFn: () => apiRequest<ItemResponse<ExitView>>(`/exit/${employeeId}`),
    enabled: Boolean(employeeId),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function useInvalidateExit() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: exitKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['employees'] });
  };
}

export function useInitiateExit(employeeId: string) {
  const invalidate = useInvalidateExit();
  return useMutation({
    mutationFn: (body: {
      reason: string;
      resignationDate?: string;
      noticePeriodDays?: number;
      lastWorkingDay?: string;
      reasonNote?: string;
    }) =>
      apiRequest<ItemResponse<ExitView>>(`/exit/${employeeId}/initiate`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateChecklistItem(employeeId: string) {
  const invalidate = useInvalidateExit();
  return useMutation({
    mutationFn: ({ itemId, status, notes }: { itemId: string; status: string; notes?: string }) =>
      apiRequest<ItemResponse<ExitView>>(
        `/exit/${employeeId}/checklist/${itemId}`,
        { method: 'PATCH', body: { status, notes } },
      ),
    onSuccess: () => invalidate(),
  });
}

export function useProvideClearance(employeeId: string) {
  const invalidate = useInvalidateExit();
  return useMutation({
    mutationFn: (body: {
      department: 'manager' | 'hr' | 'finance';
      status: 'Approved' | 'Rejected';
      comments?: string;
    }) =>
      apiRequest<ItemResponse<ExitView>>(`/exit/${employeeId}/clearance`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateSettlement(employeeId: string) {
  const invalidate = useInvalidateExit();
  return useMutation({
    mutationFn: (body: { status: 'Pending' | 'Processing' | 'Completed'; notes?: string }) =>
      apiRequest<ItemResponse<ExitView>>(`/exit/${employeeId}/settlement`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidate(),
  });
}

export function useRelieveEmployee(employeeId: string) {
  const invalidate = useInvalidateExit();
  return useMutation({
    mutationFn: (body: { force?: boolean; forceReason?: string }) =>
      apiRequest<ItemResponse<ExitView>>(`/exit/${employeeId}/relieve`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidate(),
  });
}

export function useWithdrawExit(employeeId: string) {
  const invalidate = useInvalidateExit();
  return useMutation({
    mutationFn: () =>
      apiRequest<ItemResponse<{ success: boolean; message: string }>>(
        `/exit/${employeeId}/withdraw`,
        { method: 'POST' },
      ),
    onSuccess: () => invalidate(),
  });
}
