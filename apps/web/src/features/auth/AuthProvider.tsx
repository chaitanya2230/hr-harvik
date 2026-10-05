import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, SessionExpiredError, setAccessToken } from '../../api/client';
import { AuthContext, type AuthContextValue } from './auth-context';
import { loginRequest, logoutRequest, meRequest } from './api';
import type { AuthAccount } from './api';

/**
 * AGENTS.md §6 — the session is reconstructed from the httpOnly refresh cookie on
 * every page load. The access token is never persisted, so a reload has to call
 * `/auth/me` (which transparently refreshes) to learn who is signed in.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [initialising, setInitialising] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    meRequest()
      .then((me) => {
        if (!cancelled) setAccount(me);
      })
      .catch((error: unknown) => {
        // A missing/expired session is the normal first-visit case, not an error.
        if (!cancelled && !(error instanceof SessionExpiredError)) {
          // eslint-disable-next-line no-console -- never log credentials or tokens
          console.error('Session probe failed', error instanceof ApiError ? error.code : error);
        }
        if (!cancelled) setAccount(null);
      })
      .finally(() => {
        if (!cancelled) setInitialising(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const me = await loginRequest(email, password);
    setAccount(me);
    return me;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setAccount(null);
      setAccessToken(null);
      // Cached server data belongs to the previous identity.
      queryClient.clear();
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ account, initialising, signIn, signOut }),
    [account, initialising, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}