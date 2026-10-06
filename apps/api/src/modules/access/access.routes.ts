import { Router } from 'express';
import { asyncHandler } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../config/constants';
import {
  accessParamsSchema,
  createAccessItemSchema,
  listAccessItemsQuerySchema,
} from './access.validation';
import * as controller from './access.controller';

/**
 * AGENTS.md §7 — Access Items routes.
 *
 * Creation and revocation require `manageLicenses` (HR Admin, HR Manager);
 * reads are `requireAuth` + scope so Employees see their own access (§6).
 */
export const accessRouter = Router();

const params = validate({ params: accessParamsSchema });
const manage = [requireAuth, requirePermission(PERMISSIONS.manageLicenses)] as const;

accessRouter.get(
  '/',
  requireAuth,
  validate({ query: listAccessItemsQuerySchema }),
  asyncHandler(controller.list),
);

accessRouter.post('/', ...manage, validate({ body: createAccessItemSchema }), asyncHandler(controller.create));

accessRouter.get('/:id', requireAuth, params, asyncHandler(controller.getOne));

accessRouter.post('/:id/revoke', ...manage, params, asyncHandler(controller.revoke));
