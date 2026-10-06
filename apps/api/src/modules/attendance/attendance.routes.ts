import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../config/constants';
import { asyncHandler } from '../../utils/http';
import * as controller from './attendance.controller';

const router = Router();

router.use(requireAuth);

// Attendance routes
router.post('/', asyncHandler(controller.markAttendanceHandler));
router.get('/', asyncHandler(controller.listAttendanceHandler));
router.get('/monthly', asyncHandler(controller.getMonthlyGridHandler));

// Corrections routes
router.post('/corrections', asyncHandler(controller.requestCorrectionHandler));
router.get('/corrections', asyncHandler(controller.listCorrectionsHandler));
router.post(
  '/corrections/:id/review',
  requirePermission(PERMISSIONS.approveAttendanceCorrection),
  asyncHandler(controller.reviewCorrectionHandler),
);

// Holidays routes
router.get('/holidays', asyncHandler(controller.listHolidaysHandler));
router.post(
  '/holidays',
  requirePermission(PERMISSIONS.manageSettings),
  asyncHandler(controller.createHolidayHandler),
);
router.delete(
  '/holidays/:id',
  requirePermission(PERMISSIONS.manageSettings),
  asyncHandler(controller.deleteHolidayHandler),
);

// Trigger nightly job (HR only)
router.post(
  '/nightly-job',
  requirePermission(PERMISSIONS.manageAttendance),
  asyncHandler(controller.runNightlyJobHandler),
);

export default router;
