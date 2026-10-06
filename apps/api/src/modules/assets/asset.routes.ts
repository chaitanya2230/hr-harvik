import { Router } from 'express';
import { asyncHandler } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../config/constants';
import {
  assignAssetSchema,
  assetParamsSchema,
  createAssetSchema,
  listAssetAssignmentsQuerySchema,
  listAssetsQuerySchema,
  repairAssetSchema,
  retireAssetSchema,
  returnAssetSchema,
  updateAssetSchema,
} from './asset.validation';
import * as controller from './asset.controller';

/**
 * AGENTS.md §8.8 — Asset routes.
 *
 * Master inventory (list/detail/create/edit/delete/operations) requires
 * `manageAssets` (HR Admin, HR Manager). The assignment ledger is
 * `requireAuth` + per-employee scope so Managers see their team and Employees
 * see their own (§6 self-service). Collection sub-routes are registered before
 * `/:id` so they cannot be swallowed by it.
 */
export const assetRouter = Router();

const params = validate({ params: assetParamsSchema });
const manage = [requireAuth, requirePermission(PERMISSIONS.manageAssets)] as const;

assetRouter.get(
  '/assignments',
  requireAuth,
  validate({ query: listAssetAssignmentsQuerySchema }),
  asyncHandler(controller.listAssignments),
);

assetRouter.get('/', ...manage, validate({ query: listAssetsQuerySchema }), asyncHandler(controller.list));

assetRouter.post('/', ...manage, validate({ body: createAssetSchema }), asyncHandler(controller.create));

assetRouter.get('/:id', ...manage, params, asyncHandler(controller.getOne));

assetRouter.get('/:id/history', ...manage, params, asyncHandler(controller.getHistory));

assetRouter.patch(
  '/:id',
  ...manage,
  params,
  validate({ body: updateAssetSchema }),
  asyncHandler(controller.update),
);

assetRouter.delete('/:id', ...manage, params, asyncHandler(controller.remove));

assetRouter.post(
  '/:id/assign',
  ...manage,
  params,
  validate({ body: assignAssetSchema }),
  asyncHandler(controller.assign),
);

assetRouter.post(
  '/:id/return',
  ...manage,
  params,
  validate({ body: returnAssetSchema }),
  asyncHandler(controller.returnAsset),
);

assetRouter.post(
  '/:id/repair',
  ...manage,
  params,
  validate({ body: repairAssetSchema }),
  asyncHandler(controller.repair),
);

assetRouter.post(
  '/:id/retire',
  ...manage,
  params,
  validate({ body: retireAssetSchema }),
  asyncHandler(controller.retire),
);
