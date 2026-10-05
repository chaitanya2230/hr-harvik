import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';

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
 *   P7 reports, notifications
 */
export const apiRouter = Router();

apiRouter.use('/auth', authRouter);