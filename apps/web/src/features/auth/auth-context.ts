import { createContext, useContext } from 'react';
import type { AuthAccount } from './api';

export interface AuthContextValue {
  account: AuthAccount | null;
  /** False while the initial `/auth/me` probe is still in flight. */
  initialising: boolean;
  signIn: (email: string, password: string) => Promise<AuthAccount>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}