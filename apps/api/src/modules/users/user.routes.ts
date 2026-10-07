import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import {
  createUserHandler,
  getUserHandler,
  listUsersHandler,
  resetPasswordHandler,
  updateUserHandler,
} from './user.controller';
import { createUserSchema, listUsersQuerySchema, resetPasswordSchema, updateUserSchema } from './user.validation';

/**
 * AGENTS.md §6 — "HR Admin: manage users / manage roles"; "HR Manager:
 * cannot manage users". Every route is gated by the `manageUsers`
 * permission (HR Admin only) — the frontend hiding is cosmetic.
 */
export const userRouter = Router();

userRouter.use(requireAuth);

userRouter.get('/', requirePermission('manageUsers'), validate({ query: listUsersQuerySchema }), listUsersHandler);
userRouter.get('/:id', requirePermission('manageUsers'), getUserHandler);
userRouter.post('/', requirePermission('manageUsers'), validate({ body: createUserSchema }), createUserHandler);
userRouter.patch('/:id', requirePermission('manageUsers'), validate({ body: updateUserSchema }), updateUserHandler);
userRouter.post('/:id/password', requirePermission('manageUsers'), validate({ body: resetPasswordSchema }), resetPasswordHandler);
