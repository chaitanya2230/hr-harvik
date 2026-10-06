import { Router } from 'express';
import { asyncHandler } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../config/constants';
import {
  assignLicenseSchema,
  licenseAssignmentParamsSchema,
  licenseParamsSchema,
  listLicenseAssignmentsQuerySchema,
  listLicensesQuerySchema,
  createLicenseSchema,
  renewLicenseSchema,
  revokeLicenseAssignmentSchema,
  suspendLicenseSchema,
  updateLicenseSchema,
} from './license.validation';
import * as controller from './license.controller';

/**
 * AGENTS.md §8.9 — License routes.
 *
 * Inventory requires `manageLicenses` (HR Admin, HR Manager); the assignment
 * ledger is `requireAuth` + scope (§6 self-service). Key reveal is additionally
 * HR-Admin-only inside the service. Collection sub-routes precede `/:id`.
 */
export const licenseRouter = Router();

const params = validate({ params: licenseParamsSchema });
const manage = [requireAuth, requirePermission(PERMISSIONS.manageLicenses)] as const;

licenseRouter.get(
  '/assignments',
  requireAuth,
  validate({ query: listLicenseAssignmentsQuerySchema }),
  asyncHandler(controller.listAssignments),
);

licenseRouter.post(
  '/assignments/:assignmentId/revoke',
  ...manage,
  validate({ params: licenseAssignmentParamsSchema }),
  validate({ body: revokeLicenseAssignmentSchema }),
  asyncHandler(controller.revokeAssignment),
);

licenseRouter.get('/', ...manage, validate({ query: listLicensesQuerySchema }), asyncHandler(controller.list));

licenseRouter.post('/', ...manage, validate({ body: createLicenseSchema }), asyncHandler(controller.create));

licenseRouter.get('/:id', ...manage, params, asyncHandler(controller.getOne));

licenseRouter.get('/:id/utilization', ...manage, params, asyncHandler(controller.getUtilization));

licenseRouter.get('/:id/key', requireAuth, params, asyncHandler(controller.revealKey));

licenseRouter.patch(
  '/:id',
  ...manage,
  params,
  validate({ body: updateLicenseSchema }),
  asyncHandler(controller.update),
);

licenseRouter.delete('/:id', ...manage, params, asyncHandler(controller.remove));

licenseRouter.post(
  '/:id/assign',
  ...manage,
  params,
  validate({ body: assignLicenseSchema }),
  asyncHandler(controller.assign),
);

licenseRouter.post(
  '/:id/renew',
  ...manage,
  params,
  validate({ body: renewLicenseSchema }),
  asyncHandler(controller.renew),
);

licenseRouter.post(
  '/:id/suspend',
  ...manage,
  params,
  validate({ body: suspendLicenseSchema }),
  asyncHandler(controller.suspend),
);

licenseRouter.post('/:id/expire', ...manage, params, asyncHandler(controller.expire));

licenseRouter.post('/:id/revoke', ...manage, params, asyncHandler(controller.revokeLicense));
