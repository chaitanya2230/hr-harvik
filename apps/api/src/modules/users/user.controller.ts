import type { NextFunction, Request, Response } from 'express';
import {
  createUser,
  getUser,
  listUsers,
  resetUserPassword,
  updateUser,
} from './user.service';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
} from './user.validation';
import { unauthorized } from '../../utils/errors';
import { recordAuditFromRequest } from '../audit/audit.service';

const requireUser = (req: Request) => {
  if (!req.user) throw unauthorized('Authentication required');
  return req.user;
};

export async function listUsersHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requireUser(req);
    const query = listUsersQuerySchema.parse(req.query);
    const result = await listUsers(query);
    res.json({ data: result.data, meta: result.meta });
  } catch (error) {
    next(error);
  }
}

export async function getUserHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requireUser(req);
    const view = await getUser(req.params.id ?? '');
    res.json({ data: view });
  } catch (error) {
    next(error);
  }
}

export async function createUserHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = requireUser(req);
    const body = createUserSchema.parse(req.body);
    const view = await createUser(body, { actorId: actor.userId, actorRole: actor.role });

    await recordAuditFromRequest(req, {
      actorId: actor.userId,
      action: 'user.create',
      entityType: 'User',
      entityId: view.id,
      // §11 — never audit credentials; only the safe projection.
      after: { email: view.email, role: view.role, isActive: view.isActive },
    });

    res.status(201).json({ data: view });
  } catch (error) {
    next(error);
  }
}

export async function updateUserHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = requireUser(req);
    const body = updateUserSchema.parse(req.body);
    const result = await updateUser(req.params.id ?? '', body, {
      actorId: actor.userId,
      actorRole: actor.role,
    });

    await recordAuditFromRequest(req, {
      actorId: actor.userId,
      action: 'user.update',
      entityType: 'User',
      entityId: result.view.id,
      before: result.before,
      after: result.after,
    });

    res.json({ data: result.view });
  } catch (error) {
    next(error);
  }
}

export async function resetPasswordHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = requireUser(req);
    const body = resetPasswordSchema.parse(req.body);
    const view = await resetUserPassword(req.params.id ?? '', body.password);

    await recordAuditFromRequest(req, {
      actorId: actor.userId,
      action: 'user.password_reset',
      entityType: 'User',
      entityId: view.id,
      // §11 — the password itself is never recorded anywhere but bcrypt.
      after: { passwordChanged: true, sessionsRevoked: true },
    });

    res.json({ data: view });
  } catch (error) {
    next(error);
  }
}
