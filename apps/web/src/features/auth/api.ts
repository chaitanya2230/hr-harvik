import { apiRequest, setAccessToken } from '../../api/client';

/**
 * AGENTS.md §6 — the session payload the API returns. `permissions` is advisory
 * only: the backend re-checks every capability on every request.
 */
export interface AuthAccount {
  userId: string;
  email: string;
  role: 'HR Admin' | 'HR Manager' | 'Manager' | 'Employee';
  employeeId: string | null;
  permissions: string[];
}

export interface SessionPayload {
  account: AuthAccount;
  accessToken: string;
  expiresIn: string;
}

export async function loginRequest(
  email: string,
  password: string,
): Promise<AuthAccount> {
  const response = await apiRequest<{ data: SessionPayload }>('/auth/login', {
    method: 'POST',
    body: { email, password },
    skipRefresh: true,
  });

  setAccessToken(response.data.accessToken);
  return response.data.account;
}

export async function meRequest(): Promise<AuthAccount> {
  const response = await apiRequest<{ data: AuthAccount }>('/auth/me');
  return response.data;
}

export async function logoutRequest(): Promise<void> {
  try {
    await apiRequest<void>('/auth/logout', { method: 'POST' });
  } finally {
    // Clear locally even if the network call failed.
    setAccessToken(null);
  }
}