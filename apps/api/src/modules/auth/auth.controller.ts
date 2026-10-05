import type { Request, Response } from 'express';
import { REFRESH_COOKIE_NAME } from '../../config/constants';
import { env, isProduction } from '../../config/env';
import { parseDurationMs } from '../../utils/dates';
import { unauthorized } from '../../utils/errors';
import { requestMeta } from '../audit/audit.service';
import * as authService from './auth.service';
import type { ChangePasswordBody, LoginBody } from './auth.schema';

/**
 * AGENTS.md §6 — the refresh token is delivered only through an httpOnly
 * cookie. It is deliberately never returned in the JSON body, so page scripts
 * cannot read it.
 */
const COOKIE_PATH = '/api/v1/auth';

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax' as const,
  path: COOKIE_PATH,
};

const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...cookieOptions,
    maxAge: parseDurationMs(env.JWT_REFRESH_TTL),
  });
};

const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
};

/** Cookie first (browser), body second (CLI / integration tests). */
const refreshTokenFrom = (req: Request): string | undefined => {
  const cookies = req.cookies as Record<string, string> | undefined;
  const fromCookie = cookies?.[REFRESH_COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const body = req.body as { refreshToken?: unknown } | undefined;
  return typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
}

const sessionPayload = (result: authService.AuthResult) => ({
  account: {
    ...result.account,
    // §6 — RBAC is decided server-side; the permission list only lets the UI
    // hide what would be refused anyway.
    permissions: authService.permissionsFor(result.account.role),
  },
  accessToken: result.tokens.accessToken,
  expiresIn: result.tokens.accessTokenExpiresIn,
});

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginBody, requestMeta(req));
  setRefreshCookie(res, result.tokens.refreshToken);
  res.status(200).json({ data: sessionPayload(result) });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const presented = refreshTokenFrom(req);
  if (!presented) throw unauthorized('No active session');

  const result = await authService.rotateRefreshToken(presented, requestMeta(req));
  setRefreshCookie(res, result.tokens.refreshToken);
  res.status(200).json({ data: sessionPayload(result) });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(refreshTokenFrom(req), requestMeta(req));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function me(req: Request, res: Response): Promise<void> {
  const account = req.user;
  if (!account) throw unauthorized('Authentication required');

  res.status(200).json({
    data: { ...account, permissions: authService.permissionsFor(account.role) },
  });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const account = req.user;
  if (!account) throw unauthorized('Authentication required');

  await authService.changePassword(
    account.userId,
    req.body as ChangePasswordBody,
    requestMeta(req),
  );

  // All sessions were invalidated server-side; drop the now-dead cookie too.
  clearRefreshCookie(res);
  res.status(200).json({ data: { changed: true } });
}