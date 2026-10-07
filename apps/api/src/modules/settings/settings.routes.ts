import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { readSettings, writeSettings } from './settings.controller';

/**
 * AGENTS.md §4 — settings module; §9 — `/settings` route.
 * Reads are open to every signed-in role, writes are HR Admin only
 * (§6 "system settings" is an HR Admin capability).
 */
export const settingsRouter = Router();

settingsRouter.use(requireAuth);
settingsRouter.get('/', readSettings);
settingsRouter.patch('/', requirePermission('manageSettings'), writeSettings);
