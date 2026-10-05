import { Router } from 'express';
import { asyncHandler } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { loginLimiter } from '../../middleware/rateLimit';
import { changePasswordSchema, loginSchema, refreshSchema } from './auth.schema';
import * as controller from './auth.controller';

export const authRouter = Router();

// AGENTS.md §11 — login limited to 5 attempts per minute per IP.
authRouter.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(controller.login),
);

authRouter.post('/refresh', validate({ body: refreshSchema }), asyncHandler(controller.refresh));
authRouter.post('/logout', asyncHandler(controller.logout));

authRouter.get('/me', requireAuth, asyncHandler(controller.me));

authRouter.post(
  '/change-password',
  requireAuth,
  validate({ body: changePasswordSchema }),
  asyncHandler(controller.changePassword),
);