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

/**
 * AGENTS.md §6/§11 — a failed refresh means the session is gone. The client
 * raises `SessionExpiredError` for the failing caller, but the rest of the app
 * has to learn about it too so it can drop cached data and route to /login
 * instead of stranding the user on a dead page.
 */
const sessionExpiredListeners = new Set<() => void>();

/**
 * Subscribe to unrecoverable session expiry. Returns an unsubscribe function.
 * Listeners are invoked synchronously, immediately before the
 * `SessionExpiredError` is thrown, from both `apiRequest` and `apiDownload`.
 * The login call (`skipRefresh`) never refreshes, so it never notifies.
 */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function emitSessionExpired(): void {
  for (const listener of Array.from(sessionExpiredListeners)) {
    try {
      listener();
    } catch {
      // A misbehaving listener must not mask the SessionExpiredError contract.
    }
  }
}

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
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const send = async (): Promise<Response> =>
    fetch(`${BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(body === undefined || isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : isFormData ? { body } : { body: JSON.stringify(body) }),
    });

  let response = await send();

  if (response.status === 401 && !skipRefresh) {
    if (await attemptRefresh()) {
      response = await send();
    } else {
      accessToken = null;
      emitSessionExpired();
      throw new SessionExpiredError();
    }
  }

  if (!response.ok) return parseError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export async function apiDownload(path: string, fallbackFilename = 'document.pdf'): Promise<void> {
  const send = async (): Promise<Response> =>
    fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

  let response = await send();

  if (response.status === 401) {
    if (await attemptRefresh()) {
      response = await send();
    } else {
      accessToken = null;
      emitSessionExpired();
      throw new SessionExpiredError();
    }
  }

  if (!response.ok) return parseError(response);

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  const disp = response.headers.get('Content-Disposition');
  let filename = fallbackFilename;
  if (disp && disp.includes('filename=')) {
    const match = disp.match(/filename="?([^";]+)"?/);
    if (match && match[1]) filename = decodeURIComponent(match[1]);
  }

  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}