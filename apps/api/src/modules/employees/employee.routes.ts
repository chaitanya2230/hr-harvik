import { Router } from 'express';
import { asyncHandler } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../config/constants';
import {
  changeStatusSchema,
  createEmployeeSchema,
  employeeParamsSchema,
  listEmployeesQuerySchema,
  updateEmployeeSchema,
} from './employee.validation';
import * as controller from './employee.controller';

/**
 * AGENTS.md §8.2 — Employee routes.
 *
 * This is P1's first real use of `requirePermission` (P0 shipped the guards with
 * no route using them, and recorded 403-over-HTTP as an unreachable gap).
 */
export const employeeRouter = Router();

const params = validate({ params: employeeParamsSchema });

// Directory listing is HR-only (§6: "Employees cannot access the full employee
// management list"; a Manager's team is reached through /employees/:id).
employeeRouter.get(
  '/',
  requireAuth,
  requirePermission(PERMISSIONS.viewEmployeeDirectory),
  validate({ query: listEmployeesQuerySchema }),
  asyncHandler(controller.list),
);

employeeRouter.post(
  '/',
  requireAuth,
  requirePermission(PERMISSIONS.createEmployee),
  validate({ body: createEmployeeSchema }),
  asyncHandler(controller.create),
);

// Read/update/status/history are `requireAuth` + per-employee scope, so a
// Manager reaches their own reports and an Employee reaches only themselves.
employeeRouter.get('/:id', requireAuth, params, asyncHandler(controller.getOne));

employeeRouter.get(
  '/:id/history',
  requireAuth,
  params,
  asyncHandler(controller.history),
);

employeeRouter.patch(
  '/:id',
  requireAuth,
  requirePermission(PERMISSIONS.updateEmployee),
  params,
  validate({ body: updateEmployeeSchema }),
  asyncHandler(controller.update),
);

employeeRouter.post(
  '/:id/status',
  requireAuth,
  requirePermission(PERMISSIONS.updateEmployee),
  params,
  validate({ body: changeStatusSchema }),
  asyncHandler(controller.changeStatus),
);

// §6 — deleting employees is HR Admin only; an HR Manager may not delete.
employeeRouter.delete(
  '/:id',
  requireAuth,
  requirePermission(PERMISSIONS.deleteEmployee),
  params,
  asyncHandler(controller.remove),
);
