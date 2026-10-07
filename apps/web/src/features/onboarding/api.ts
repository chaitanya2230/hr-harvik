import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';
import type { ListResponse } from '../../api/types';
import type { OnboardingItemKey, OnboardingRecord } from './types';

export function useOnboardings(params: {
  page?: number;
  limit?: number;
  departmentId?: string;
  status?: string;
  q?: string;
  enabled?: boolean;
}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.departmentId) query.set('departmentId', params.departmentId);
  if (params.status) query.set('status', params.status);
  if (params.q) query.set('q', params.q);

  return useQuery({
    queryKey: ['onboarding', 'list', params],
    queryFn: () => apiRequest<ListResponse<OnboardingRecord>>(`/onboarding?${query.toString()}`),
    enabled: params.enabled ?? true,
  });
}

export function useOnboardingDetail(employeeId: string) {
  return useQuery({
    queryKey: ['onboarding', 'detail', employeeId],
    queryFn: () => apiRequest<{ data: OnboardingRecord }>(`/onboarding/${employeeId}`),
    enabled: Boolean(employeeId),
  });
}

export function useUpdateChecklistItem(employeeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemKey,
      status,
      notes,
      naReason,
    }: {
      itemKey: OnboardingItemKey;
      status: 'Pending' | 'Completed' | 'NA';
      notes?: string;
      naReason?: string;
    }) =>
      apiRequest<{ data: OnboardingRecord }>(`/onboarding/${employeeId}/items/${itemKey}`, {
        method: 'PATCH',
        body: { status, notes, naReason },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useReopenOnboarding(employeeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason: string }) =>
      apiRequest<{ data: OnboardingRecord }>(`/onboarding/${employeeId}/reopen`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
