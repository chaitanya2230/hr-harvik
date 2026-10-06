import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { PERMISSIONS } from '../../config/constants';
import { asyncHandler } from '../../utils/http';
import {
  listExitsHandler,
  getExitHandler,
  initiateExitHandler,
  provideClearanceHandler,
  updateChecklistItemHandler,
  updateSettlementHandler,
  relieveEmployeeHandler,
  withdrawExitHandler,
} from './exit.controller';
import {
  createExitSchema,
  listExitsSchema,
  provideClearanceSchema,
  relieveEmployeeSchema,
  updateChecklistItemSchema,
  updateSettlementSchema,
} from './exit.validation';

export const exitRouter = Router();

exitRouter.use(requireAuth);

// List exits (role scoped: HR all, Manager team, Employee own)
exitRouter.get('/', validate({ query: listExitsSchema }), asyncHandler(listExitsHandler));

// Exit detail + checklist + blockers
exitRouter.get('/:id', asyncHandler(getExitHandler));

// Initiate exit
exitRouter.post(
  '/:employeeId/initiate',
  requirePermission(PERMISSIONS.processExit),
  validate({ body: createExitSchema }),
  asyncHandler(initiateExitHandler),
);

// Provide clearance (Manager clearance requires manager or HR; HR clearance requires HR)
exitRouter.post(
  '/:employeeId/clearance',
  validate({ body: provideClearanceSchema }),
  asyncHandler(provideClearanceHandler),
);

// Update checklist item
exitRouter.patch(
  '/:employeeId/checklist/:itemId',
  requirePermission(PERMISSIONS.processExit),
  validate({ body: updateChecklistItemSchema }),
  asyncHandler(updateChecklistItemHandler),
);

// Update settlement
exitRouter.post(
  '/:employeeId/settlement',
  requirePermission(PERMISSIONS.processExit),
  validate({ body: updateSettlementSchema }),
  asyncHandler(updateSettlementHandler),
);

// Relieve employee
exitRouter.post(
  '/:employeeId/relieve',
  requirePermission(PERMISSIONS.processExit),
  validate({ body: relieveEmployeeSchema }),
  asyncHandler(relieveEmployeeHandler),
);

// Withdraw resignation / cancel exit
exitRouter.post(
  '/:employeeId/withdraw',
  requirePermission(PERMISSIONS.processExit),
  asyncHandler(withdrawExitHandler),
);
