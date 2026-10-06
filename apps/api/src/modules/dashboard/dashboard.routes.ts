import { Router } from 'express';
import { asyncHandler } from '../../utils/http';
import { requireAuth } from '../../middleware/auth';
import * as controller from './dashboard.controller';

/**
 * AGENTS.md §8.1 — `GET /api/v1/dashboard/summary`.
 *
 * `requireAuth` only, because the response is scope-derived rather than
 * capability-gated: HR roles get organisation totals, a Manager gets their team,
 * and an Employee gets their own profile. Every role is meant to see *a*
 * dashboard, so refusing the lower roles would be wrong — the numbers shown are
 * the ones they are entitled to.
 */
export const dashboardRouter = Router();

dashboardRouter.get('/summary', requireAuth, asyncHandler(controller.summary));
