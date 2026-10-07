import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { employeeRouter } from '../modules/employees/employee.routes';
import { departmentRouter } from '../modules/departments/department.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';
import { assetRouter } from '../modules/assets/asset.routes';
import { licenseRouter } from '../modules/licenses/license.routes';
import { accessRouter } from '../modules/access/access.routes';
import { exitRouter } from '../modules/exit/exit.routes';
import { documentRouter, documentTemplateRouter } from '../modules/documents/document.routes';
import attendanceRouter from '../modules/attendance/attendance.routes';
import leaveRouter from '../modules/leave/leave.routes';
import { recruitmentRouter } from '../modules/recruitment/recruitment.routes';
import { onboardingRouter } from '../modules/onboarding/onboarding.routes';
import { reportRouter } from '../modules/reports/report.routes';
import { notificationRouter } from '../modules/notifications/notification.routes';
import { settingsRouter } from '../modules/settings/settings.routes';
import { userRouter } from '../modules/users/user.routes';

/**
 * AGENTS.md §10 — every endpoint lives under the `/api/v1` prefix.
 *
 * Modules are registered here as they are implemented, phase by phase:
 *   P0 auth
 *   P1 departments, employees, dashboard
 *   P2 assets, licenses, access
 *   P3 exit
 *   P4 documents
 *   P5 attendance, leave
 *   P6 recruitment, onboarding
 *   P7 reports, notifications                    <- registered
 *   P7 settings, users (AGENTS §6/§9 requirement gaps) <- registered
 */
export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/employees', employeeRouter);
apiRouter.use('/departments', departmentRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/assets', assetRouter);
apiRouter.use('/licenses', licenseRouter);
apiRouter.use('/access', accessRouter);
apiRouter.use('/exit', exitRouter);
apiRouter.use('/documents', documentRouter);
apiRouter.use('/document-templates', documentTemplateRouter);
apiRouter.use('/attendance', attendanceRouter);
apiRouter.use('/leave', leaveRouter);
apiRouter.use('/recruitment', recruitmentRouter);
apiRouter.use('/onboarding', onboardingRouter);
apiRouter.use('/reports', reportRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/users', userRouter);


