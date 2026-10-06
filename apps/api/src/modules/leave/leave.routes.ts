import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../config/constants';
import { asyncHandler } from '../../utils/http';
import * as controller from './leave.controller';

const router = Router();

router.use(requireAuth);

// Leave Types routes
router.get('/types', asyncHandler(controller.listLeaveTypesHandler));
router.post(
  '/types',
  requirePermission(PERMISSIONS.manageLeaveTypes),
  asyncHandler(controller.createLeaveTypeHandler),
);
router.patch(
  '/types/:id',
  requirePermission(PERMISSIONS.manageLeaveTypes),
  asyncHandler(controller.updateLeaveTypeHandler),
);

// Leave Balances routes
router.get('/balances', asyncHandler(controller.listBalancesHandler));

// Leave Requests routes
router.get('/requests', asyncHandler(controller.listLeaveRequestsHandler));
router.post('/requests', asyncHandler(controller.applyLeaveHandler));
router.post('/requests/:id/cancel', asyncHandler(controller.cancelLeaveHandler));
router.post(
  '/requests/:id/review',
  requirePermission(PERMISSIONS.approveTeamLeave),
  asyncHandler(controller.reviewLeaveHandler),
);

// Team Calendar route
router.get('/calendar', asyncHandler(controller.getTeamCalendarHandler));

export default router;
