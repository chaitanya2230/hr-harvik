import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';
import type { ItemResponse, ListResponse } from '../../api/types';

/**
 * AGENTS.md §6 — "HR Admin → manage users / manage roles / system settings",
 * §9 — `/settings`. Reads are open to every signed-in role on the backend;
 * writes are gated by `manageSettings` / `manageUsers` and re-checked there.
 */

export interface SystemSettings {
  companyName: string;
  timezone: string;
  minAgeIntern: number;
  minAgeOther: number;
  probationDefault: boolean;
}

export type UserRole = 'HR Admin' | 'HR Manager' | 'Manager' | 'Employee';

export const USER_ROLES: UserRole[] = ['HR Admin', 'HR Manager', 'Manager', 'Employee'];

export interface UserRow {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  employee: { id: string; name: string; employeeCode: string } | null;
}

export interface UserListParams {
  page: number;
  limit: number;
  q?: string;
  role?: UserRole;
  isActive?: boolean;
}

export const settingsKeys = {
  all: ['settings'] as const,
  system: ['settings', 'system'] as const,
};

export const userKeys = {
  all: ['users'] as const,
  list: (params: UserListParams) => ['users', 'list', params] as const,
};

export function useSettings(): UseQueryResult<ItemResponse<SystemSettings>> {
  return useQuery({
    queryKey: settingsKeys.system,
    queryFn: () => apiRequest<ItemResponse<SystemSettings>>('/settings'),
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<SystemSettings>) =>
      apiRequest<ItemResponse<SystemSettings>>('/settings', {
        method: 'PATCH',
        body: payload,
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(settingsKeys.system, result);
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}

const toSearchParams = (params: UserListParams): string => {
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('limit', String(params.limit));
  if (params.q) search.set('q', params.q);
  if (params.role) search.set('role', params.role);
  if (params.isActive !== undefined) search.set('isActive', String(params.isActive));
  return search.toString();
};

export function useUserList(params: UserListParams): UseQueryResult<ListResponse<UserRow>> {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => apiRequest<ListResponse<UserRow>>(`/users?${toSearchParams(params)}`),
  });
}

export interface CreateUserPayload {
  email: string;
  password: string;
  role: UserRole;
  employeeId?: string;
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: userKeys.all });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (payload: CreateUserPayload) =>
      apiRequest<ItemResponse<UserRow>>('/users', {
        method: 'POST',
        body: payload,
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateUser(userId: string) {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (payload: { role?: UserRole; isActive?: boolean }) =>
      apiRequest<ItemResponse<UserRow>>(`/users/${userId}`, {
        method: 'PATCH',
        body: payload,
      }),
    onSuccess: invalidate,
  });
}

export function useResetUserPassword(userId: string) {
  return useMutation({
    mutationFn: (payload: { password: string }) =>
      apiRequest<ItemResponse<{ id: string }>>(`/users/${userId}/password`, {
        method: 'POST',
        body: payload,
      }),
  });
}
