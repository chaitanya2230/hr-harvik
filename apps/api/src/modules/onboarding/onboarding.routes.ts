import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { asyncHandler } from '../../utils/http';
import {
  getOnboardingHandler,
  listOnboardingsHandler,
  reopenOnboardingHandler,
  updateChecklistItemHandler,
} from './onboarding.controller';

export const onboardingRouter = Router();

onboardingRouter.use(requireAuth);

onboardingRouter.get(
  '/',
  requirePermission('viewOnboarding'),
  asyncHandler(listOnboardingsHandler),
);

onboardingRouter.get(
  '/:employeeId',
  asyncHandler(getOnboardingHandler),
);

onboardingRouter.patch(
  '/:employeeId/items/:itemKey',
  asyncHandler(updateChecklistItemHandler),
);

onboardingRouter.post(
  '/:employeeId/reopen',
  requirePermission('manageOnboarding'),
  asyncHandler(reopenOnboardingHandler),
);
