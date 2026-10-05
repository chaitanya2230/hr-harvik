/**
 * AGENTS.md §10 — API conventions.
 *
 * The access token lives in memory only (AGENTS.md §6); the refresh token is an
 * httpOnly cookie the browser sends automatically. A 401 triggers exactly one
 * refresh attempt, and concurrent 401s share that single attempt so a burst of
 * parallel requests cannot rotate the refresh token more than once.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Raised when the session cannot be recovered; the caller must show /login. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

const BASE = '/api/v1';

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const getAccessToken = (): string | null => accessToken;

async function parseError(response: Response): Promise<never> {
  let body: ApiErrorBody | undefined;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    /* Non-JSON error body; fall through to the status text. */
  }

  throw new ApiError(
    response.status,
    body?.error?.code ?? 'UNKNOWN',
    body?.error?.message ?? response.statusText ?? 'Request failed',
    body?.error?.details,
  );
}

async function attemptRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) return false;

      const payload = (await response.json()) as {
        data?: { accessToken?: string };
      };
      if (!payload.data?.accessToken) return false;

      accessToken = payload.data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set for the login call itself — there is no session to refresh yet. */
  skipRefresh?: boolean;
}

export async function apiRequest<T>(
  path: string,
  { body, skipRefresh, headers, ...rest }: RequestOptions = {},
): Promise<T> {
  const send = async (): Promise<Response> =>
    fetch(`${BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  let response = await send();

  if (response.status === 401 && !skipRefresh) {
    if (await attemptRefresh()) {
      response = await send();
    } else {
      accessToken = null;
      throw new SessionExpiredError();
    }
  }

  if (!response.ok) return parseError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}