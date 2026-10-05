import request from 'supertest';
import type { Express } from 'express';
import type { Role } from '../../src/config/constants';
import { createApp } from '../../src/app';
import { DEMO_PASSWORD } from '../../src/modules/auth/auth.schema';
import { runSeed } from '../../src/seed';

/**
 * Shared helpers for the integration suites.
 */

let cachedApp: Express | null = null;

/** One app instance per test file (Express middleware is stateless here). */
export const getApp = (): Express => {
  cachedApp ??= createApp();
  return cachedApp;
};

export interface Session {
  accessToken: string;
  /** Raw `Set-Cookie` header carrying the httpOnly refresh cookie. */
  refreshCookie: string;
  account: { userId: string; email: string; role: Role; employeeId: string | null };
  permissions: string[];
}

export interface LoginResult {
  status: number;
  body: {
    data?: {
      /** `permissions` lives inside `account` — see auth.controller sessionPayload. */
      account: Session['account'] & { permissions: string[] };
      accessToken: string;
      expiresIn: string;
    };
    error?: { code: string; message: string; details?: unknown };
  };
  /** `name=value` pair only, ready to use as a `Cookie` request header. */
  refreshCookie: string;
}

export async function loginAs(email: string, password: string = DEMO_PASSWORD): Promise<Session> {
  const result = await login(email, password);
  if (result.status !== 200 || !result.body.data) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(result.body)}`);
  }
  const { account, accessToken } = result.body.data;
  const { permissions, ...identity } = account;

  return {
    accessToken,
    refreshCookie: result.refreshCookie,
    account: identity,
    permissions,
  };
}

export const bearer = (accessToken: string): [string, string] => [
  'Authorization',
  `Bearer ${accessToken}`,
];

export const REFRESH_COOKIE_NAME = 'hr_refresh_token';

/** Stable IP for tests that must reuse one bucket (e.g. rate-limit specs). */
export const FIXED_CLIENT_IP = '203.0.113.7';

let ipCounter = 0;

/**
 * Throwaway per-call client IP so the per-IP login limiter never leaks across
 * tests. Wraps inside 198.51.100.1-198.51.100.254 (TEST-NET-2, unassignable) so
 * the octet stays valid however many logins a suite performs. Never collides
 * with `FIXED_CLIENT_IP` (203.0.113.7) or the loopback socket address.
 */
export const nextClientIp = (): string => {
  ipCounter = (ipCounter % 254) + 1;
  return `198.51.100.${ipCounter}`;
};

/** `X-Forwarded-For` header value for the simulated client IP. */
export const fromIp = (ip: string): [string, string] => ['X-Forwarded-For', ip];

export interface LoginOptions {
  /** Simulated client IP; defaults to a fresh one per call. */
  clientIp?: string;
}

/** Log in and capture both the access token and the refresh cookie. */
export async function login(
  email: string,
  password: string = DEMO_PASSWORD,
  options: LoginOptions = {},
): Promise<LoginResult> {
  const response = await request(getApp())
    .post('/api/v1/auth/login')
    .set(...fromIp(options.clientIp ?? nextClientIp()))
    .send({ email, password });

  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');

  return {
    status: response.status,
    body: response.body,
    // Strip cookie attributes (Path/HttpOnly/...) — those are client-side only.
    refreshCookie: raw.split(';')[0] ?? '',
  };
}

export const DEMO_ACCOUNTS = {
  admin: 'admin@harviktech.com',
  hrManager: 'hrmanager@harviktech.com',
  manager: 'manager@harviktech.com',
  employee: 'employee@harviktech.com',
} as const;

export const seedDatabase = (): Promise<unknown> => runSeed({ reset: true });