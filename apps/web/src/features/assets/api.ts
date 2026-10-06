import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';
import type { AssetAssignmentItem, AssetItem, ItemResponse, ListResponse } from '../../api/types';

/** AGENTS.md P2 — asset data access against the real API. */

export interface AssetListParams {
  page: number;
  limit: number;
  q?: string;
  sort?: string;
  type?: string;
  status?: string;
  overdue?: boolean;
}

export interface AssetAssignmentParams {
  page: number;
  limit: number;
  sort?: string;
  assetId?: string;
  employeeId?: string;
  active?: boolean;
  overdue?: boolean;
}

const toSearchParams = (params: object): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
};

export const assetKeys = {
  all: ['assets'] as const,
  list: (params: AssetListParams) => ['assets', 'list', params] as const,
  detail: (id: string) => ['assets', 'detail', id] as const,
  history: (id: string) => ['assets', 'history', id] as const,
  assignments: (params: AssetAssignmentParams) => ['assets', 'assignments', params] as const,
};

export function useAssetList(params: AssetListParams, enabled = true): UseQueryResult<ListResponse<AssetItem>> {
  return useQuery({
    queryKey: assetKeys.list(params),
    queryFn: () => apiRequest<ListResponse<AssetItem>>(`/assets?${toSearchParams(params)}`),
    enabled,
  });
}

export function useAsset(id: string | undefined): UseQueryResult<ItemResponse<AssetItem>> {
  return useQuery({
    queryKey: assetKeys.detail(id ?? ''),
    queryFn: () => apiRequest<ItemResponse<AssetItem>>(`/assets/${id}`),
    enabled: Boolean(id),
  });
}

export function useAssetHistory(id: string | undefined): UseQueryResult<ItemResponse<AssetAssignmentItem[]>> {
  return useQuery({
    queryKey: assetKeys.history(id ?? ''),
    queryFn: () => apiRequest<ItemResponse<AssetAssignmentItem[]>>(`/assets/${id}/history`),
    enabled: Boolean(id),
  });
}

export function useAssetAssignments(params: AssetAssignmentParams, enabled = true): UseQueryResult<ListResponse<AssetAssignmentItem>> {
  return useQuery({
    queryKey: assetKeys.assignments(params),
    queryFn: () => apiRequest<ListResponse<AssetAssignmentItem>>(`/assets/assignments?${toSearchParams(params)}`),
    enabled,
  });
}

export type AssetPayload = Record<string, unknown>;

function useInvalidateAssets() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: assetKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateAsset() {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (body: AssetPayload) => apiRequest<ItemResponse<AssetItem>>('/assets', { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateAsset(id: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (body: AssetPayload) =>
      apiRequest<ItemResponse<AssetItem>>(`/assets/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteAsset() {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (assetId: string) => apiRequest<void>(`/assets/${assetId}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  });
}

export function useAssignAsset(id: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (body: AssetPayload) =>
      apiRequest<ItemResponse<AssetAssignmentItem>>(`/assets/${id}/assign`, { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useReturnAsset(id: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (body: AssetPayload) =>
      apiRequest<ItemResponse<AssetAssignmentItem>>(`/assets/${id}/return`, { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useRepairAsset(id: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (body: AssetPayload) =>
      apiRequest<ItemResponse<AssetItem>>(`/assets/${id}/repair`, { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useRetireAsset(id: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (body: AssetPayload) =>
      apiRequest<ItemResponse<AssetItem>>(`/assets/${id}/retire`, { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}
