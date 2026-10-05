import type { RequestHandler } from 'express';
import { ROLE_PERMISSIONS, type Permission, type Role } from '../config/constants';
import { forbidden, unauthorized } from '../utils/errors';

export const hasPermission = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

/** AGENTS.md §6 — allow-list check for a set of roles. */
export const requireRoles =
  (...roles: readonly Role[]): RequestHandler =>
  (req, _res, next) => {
    const user = req.user;
    if (!user) throw unauthorized('Authentication required');

    if (!roles.includes(user.role)) {
      throw forbidden(
        `This action requires one of the following roles: ${roles.join(', ')}`,
      );
    }

    next();
  };

/**
 * AGENTS.md §6 — capability check. Preferred over `requireRoles` for HR
 * operations so permissions stay readable and auditable in one place
 * (`ROLE_PERMISSIONS`).
 */
export const requirePermission =
  (...permissions: readonly Permission[]): RequestHandler =>
  (req, _res, next) => {
    const user = req.user;
    if (!user) throw unauthorized('Authentication required');

    const granted = ROLE_PERMISSIONS[user.role];
    if (!permissions.some((permission) => granted.includes(permission))) {
      throw forbidden('You do not have permission to perform this action');
    }

    next();
  };