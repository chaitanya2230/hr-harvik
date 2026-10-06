import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { employeeRouter } from '../modules/employees/employee.routes';
import { departmentRouter } from '../modules/departments/department.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';

/**
 * AGENTS.md §10 — every endpoint lives under the `/api/v1` prefix.
 *
 * Modules are registered here as they are implemented, phase by phase:
 *   P0 auth
 *   P1 departments, employees, dashboard      <- registered
 *   P2 assets, licenses, access
 *   P3 exit
 *   P4 documents
 *   P5 attendance, leave
 *   P6 recruitment, onboarding
 *   P7 reports, notifications
 */
export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/employees', employeeRouter);
apiRouter.use('/departments', departmentRouter);
apiRouter.use('/dashboard', dashboardRouter);
