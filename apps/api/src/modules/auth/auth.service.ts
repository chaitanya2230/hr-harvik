import bcrypt from 'bcrypt';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import { ROLE_PERMISSIONS, type Permission, type Role } from '../../config/constants';
import { User } from '../users/user.model';
import { USER_PASSWORD_SELECT } from '../users/user.schema';
import { recordAudit } from '../audit/audit.service';
import { forbidden, unauthorized } from '../../utils/errors';
import { generateOpaqueToken, hashToken } from '../../utils/crypto';
import { getRedis } from '../../db/redis';
import { parseDurationMs } from '../../utils/dates';
import type { ChangePasswordBody, LoginBody } from './auth.schema';

/**
 * AGENTS.md §6 — authentication and session handling.
 *
 *  - Access token: signed JWT, 15m lifetime, held in memory by the frontend.
 *  - Refresh token: opaque random string, stored ONLY as a SHA-256 hash,
 *    delivered via httpOnly cookie, rotated on every refresh, and denylisted in
 *    Redis on logout so it cannot be replayed until it would have expired.
 */

/** §6 requires bcrypt cost >= 10; 12 is a reasonable internal-app default. */
export const BCRYPT_ROUNDS = 12;

const TOKEN_ISSUER = 'harvik-hr';
const TOKEN_AUDIENCE = 'harvik-hr-api';
const DENYLIST_PREFIX = 'auth:denylist:refresh:';

export interface AuthContext {
  ip: string | null;
  requestId: string | null;
}

export interface AuthAccount {
  userId: string;
  email: string;
  role: Role;
  employeeId: string | null;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
}

export interface AuthResult {
  account: AuthAccount;
  tokens: SessionTokens;
}

export const permissionsFor = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role];

/**
 * A bcrypt hash of an unguessable placeholder. Comparing against it keeps the
 * response time of "unknown email" indistinguishable from "wrong password",
 * defeating user enumeration.
 */
let dummyHash: string | null = null;
const getDummyHash = (): string => {
  dummyHash ??= bcrypt.hashSync(`harvik-credential-placeholder-${Math.random()}`, BCRYPT_ROUNDS);
  return dummyHash;
};

const refreshTokenLifetimeMs = (): number => parseDurationMs(env.JWT_REFRESH_TTL);

const refreshDenylistKey = (hash: string): string => `${DENYLIST_PREFIX}${hash}`;

async function isRefreshTokenDenylisted(hash: string): Promise<boolean> {
  const exists = await getRedis().exists(refreshDenylistKey(hash));
  return exists === 1;
}

async function denylistRefreshToken(hash: string, remainingMs: number): Promise<void> {
  const ttlSeconds = Math.ceil(remainingMs / 1000);
  if (ttlSeconds <= 0) return;
  // Only needs to outlive the token it revokes.
  await getRedis().set(refreshDenylistKey(hash), '1', 'EX', ttlSeconds);
}

function toAccount(user: {
  _id: unknown;
  email: string;
  role: Role;
  employeeId?: unknown;
}): AuthAccount {
  const employeeId = user.employeeId as { toString(): string } | null | undefined;
  return {
    userId: String(user._id),
    email: user.email,
    role: user.role,
    employeeId: employeeId ? employeeId.toString() : null,
  };
}

interface AccessClaims extends JwtPayload {
  role: Role;
  employeeId: string | null;
  typ: 'access';
}

function signAccessToken(account: AuthAccount): string {
  return jwt.sign(
    { role: account.role, employeeId: account.employeeId, typ: 'access' },
    env.JWT_ACCESS_SECRET,
    {
      subject: account.userId,
      expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      algorithm: 'HS256',
    },
  );
}

/** Verify an access token. Throws `unauthorized` for anything unexpected. */
export function verifyAccessToken(token: string): AccessClaims & { sub: string } {
  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      algorithms: ['HS256'],
    });
  } catch {
    // Do not echo the jwt library message; it can hint at the failure cause.
    throw unauthorized('Invalid or expired access token');
  }

  if (
    typeof decoded === 'string' ||
    decoded.typ !== 'access' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.role !== 'string'
  ) {
    throw unauthorized('Invalid access token payload');
  }

  return decoded as AccessClaims & { sub: string };
}

/**
 * Re-read the account from the database on every authenticated request so that
 * a disabled login (e.g. after an employee is Relieved) or a role change takes
 * effect immediately rather than when the 15m token expires.
 */
export async function loadActiveAccount(userId: string): Promise<AuthAccount | null> {
  if (!/^[a-f\d]{24}$/i.test(userId)) return null;

  const user = await User.findOne({ _id: userId, isDeleted: false })
    .select('email role employeeId isActive')
    .lean()
    .exec();

  if (!user || !user.isActive) return null;
  return toAccount(user);
}

export async function login(input: LoginBody, ctx: AuthContext): Promise<AuthResult> {
  const user = await User.findOne({ email: input.email, isDeleted: false })
    .select(USER_PASSWORD_SELECT)
    .exec();

  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? getDummyHash(),
  );

  if (!user || !passwordMatches) {
    await recordAudit({
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: null,
      after: { email: input.email },
      ...ctx,
    });
    // Identical message for unknown-email and wrong-password.
    throw unauthorized('Invalid email or password');
  }

  if (!user.isActive) {
    await recordAudit({
      actorId: user._id,
      action: 'auth.login.blocked',
      entityType: 'User',
      entityId: user._id,
      after: { reason: 'inactive' },
      ...ctx,
    });
    throw forbidden('This account is inactive. Contact HR to restore access.');
  }

  const refreshToken = generateOpaqueToken();
  user.refreshTokenHash = hashToken(refreshToken);
  user.refreshTokenExpiresAt = new Date(Date.now() + refreshTokenLifetimeMs());
  user.lastLoginAt = new Date();
  await user.save();

  await recordAudit({
    actorId: user._id,
    action: 'auth.login',
    entityType: 'User',
    entityId: user._id,
    ...ctx,
  });

  return {
    account: toAccount(user),
    tokens: {
      accessToken: signAccessToken(toAccount(user)),
      refreshToken,
      accessTokenExpiresIn: env.JWT_ACCESS_TTL,
    },
  };
}

/**
 * Refresh with rotation (§6). Presenting an already-revoked token is treated
 * as theft: the live session is destroyed.
 */
export async function rotateRefreshToken(
  presentedToken: string,
  ctx: AuthContext,
): Promise<AuthResult> {
  const presentedHash = hashToken(presentedToken);

  const user = await User.findOne({ refreshTokenHash: presentedHash, isDeleted: false })
    .select(USER_PASSWORD_SELECT)
    .exec();

  if (!user) throw unauthorized('Invalid or expired session');

  const expiresAt = user.refreshTokenExpiresAt?.getTime() ?? 0;
  if (expiresAt <= Date.now()) {
    await recordAudit({
      actorId: user._id,
      action: 'auth.refresh.expired',
      entityType: 'User',
      entityId: user._id,
      ...ctx,
    });
    throw unauthorized('Session expired, please sign in again');
  }

  if (await isRefreshTokenDenylisted(presentedHash)) {
    user.refreshTokenHash = null;
    user.refreshTokenExpiresAt = null;
    await user.save();
    await recordAudit({
      actorId: user._id,
      action: 'auth.refresh.reuse_detected',
      entityType: 'User',
      entityId: user._id,
      ...ctx,
    });
    throw unauthorized('Session invalid, please sign in again');
  }

  if (!user.isActive) {
    throw forbidden('This account is inactive. Contact HR to restore access.');
  }

  // Revoke the outgoing token so it cannot be replayed.
  await denylistRefreshToken(presentedHash, expiresAt - Date.now());

  const refreshToken = generateOpaqueToken();
  user.refreshTokenHash = hashToken(refreshToken);
  user.refreshTokenExpiresAt = new Date(Date.now() + refreshTokenLifetimeMs());
  await user.save();

  await recordAudit({
    actorId: user._id,
    action: 'auth.refresh',
    entityType: 'User',
    entityId: user._id,
    ...ctx,
  });

  return {
    account: toAccount(user),
    tokens: {
      accessToken: signAccessToken(toAccount(user)),
      refreshToken,
      accessTokenExpiresIn: env.JWT_ACCESS_TTL,
    },
  };
}

/** Denylist the presented refresh token and clear it from the user record. */
export async function logout(presentedToken: string | undefined, ctx: AuthContext): Promise<void> {
  if (!presentedToken) return;

  const hash = hashToken(presentedToken);
  const user = await User.findOne({ refreshTokenHash: hash, isDeleted: false })
    .select('+refreshTokenHash +refreshTokenExpiresAt')
    .exec();

  if (!user) return;

  const remainingMs = Math.max(0, (user.refreshTokenExpiresAt?.getTime() ?? 0) - Date.now());
  await denylistRefreshToken(hash, remainingMs);

  user.refreshTokenHash = null;
  user.refreshTokenExpiresAt = null;
  await user.save();

  await recordAudit({
    actorId: user._id,
    action: 'auth.logout',
    entityType: 'User',
    entityId: user._id,
    ...ctx,
  });
}

/**
 * Changing a password invalidates every outstanding session, including this one.
 */
export async function changePassword(
  userId: string,
  input: ChangePasswordBody,
  ctx: AuthContext,
): Promise<void> {
  const user = await User.findById(userId).select(USER_PASSWORD_SELECT).exec();
  if (!user || user.isDeleted) throw unauthorized('Account not found');

  const matches = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!matches) throw unauthorized('Current password is incorrect');

  if (await bcrypt.compare(input.newPassword, user.passwordHash)) {
    throw forbidden('New password must be different from the current password');
  }

  const previousHash = user.refreshTokenHash;
  user.passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

  if (previousHash) {
    const remainingMs = Math.max(0, (user.refreshTokenExpiresAt?.getTime() ?? 0) - Date.now());
    await denylistRefreshToken(previousHash, remainingMs);
  }
  user.refreshTokenHash = null;
  user.refreshTokenExpiresAt = null;
  await user.save();

  // `before` holds only a hash and is redacted by recordAudit anyway.
  await recordAudit({
    actorId: user._id,
    action: 'auth.password.changed',
    entityType: 'User',
    entityId: user._id,
    before: { passwordHash: previousHash },
    ...ctx,
  });
}

/** Used by the seed script to reuse the exact production hashing policy. */
export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, BCRYPT_ROUNDS);