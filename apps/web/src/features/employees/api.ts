import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';
import type {
  DepartmentRow,
  EmployeeDetail,
  EmployeeHistory,
  EmployeeSummary,
  ItemResponse,
  ListResponse,
  ManagerOption,
} from '../../api/types';

/**
 * AGENTS.md P1 — employee data access. Every read goes through TanStack Query
 * against the real API; there are no local fixtures anywhere in this feature.
 */

export interface EmployeeListParams {
  page: number;
  limit: number;
  q?: string;
  sort?: string;
  departmentId?: string;
  employmentType?: string;
  status?: string;
  reportingManagerId?: string;
  joinedFrom?: string;
  joinedTo?: string;
}

const toSearchParams = (params: EmployeeListParams): string => {
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('limit', String(params.limit));
  for (const [key, value] of Object.entries(params)) {
    if (key === 'page' || key === 'limit') continue;
    if (value) search.set(key, String(value));
  }
  return search.toString();
};

export const employeeKeys = {
  all: ['employees'] as const,
  list: (params: EmployeeListParams) => ['employees', 'list', params] as const,
  detail: (id: string) => ['employees', 'detail', id] as const,
  history: (id: string) => ['employees', 'history', id] as const,
  departments: ['departments'] as const,
  managerOptions: ['departments', 'manager-options'] as const,
};

export function useEmployeeList(
  params: EmployeeListParams,
  enabled = true,
): UseQueryResult<ListResponse<EmployeeSummary>> {
  return useQuery({
    queryKey: employeeKeys.list(params),
    queryFn: () => apiRequest<ListResponse<EmployeeSummary>>(`/employees?${toSearchParams(params)}`),
    enabled,
  });
}

export function useEmployee(id: string | undefined): UseQueryResult<ItemResponse<EmployeeDetail>> {
  return useQuery({
    queryKey: employeeKeys.detail(id ?? ''),
    queryFn: () => apiRequest<ItemResponse<EmployeeDetail>>(`/employees/${id}`),
    enabled: Boolean(id),
  });
}

export function useEmployeeHistory(
  id: string | undefined,
): UseQueryResult<ItemResponse<EmployeeHistory>> {
  return useQuery({
    queryKey: employeeKeys.history(id ?? ''),
    queryFn: () => apiRequest<ItemResponse<EmployeeHistory>>(`/employees/${id}/history`),
    enabled: Boolean(id),
  });
}

export function useDepartments(): UseQueryResult<ItemResponse<DepartmentRow[]>> {
  return useQuery({
    queryKey: employeeKeys.departments,
    queryFn: () => apiRequest<ItemResponse<DepartmentRow[]>>('/departments'),
  });
}

export function useManagerOptions(): UseQueryResult<ItemResponse<ManagerOption[]>> {
  return useQuery({
    queryKey: employeeKeys.managerOptions,
    queryFn: () => apiRequest<ItemResponse<ManagerOption[]>>('/departments/manager-options'),
  });
}

export type EmployeePayload = Record<string, unknown>;

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EmployeePayload) =>
      apiRequest<ItemResponse<EmployeeDetail>>('/employees', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: employeeKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateEmployee(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EmployeePayload) =>
      apiRequest<ItemResponse<EmployeeDetail>>(`/employees/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: employeeKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useChangeEmployeeStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { status: string; note?: string; lastWorkingDay?: string; reason?: string }) =>
      apiRequest<ItemResponse<EmployeeDetail>>(`/employees/${id}/status`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: employeeKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (employeeId: string) =>
      apiRequest<void>(`/employees/${employeeId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: employeeKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
