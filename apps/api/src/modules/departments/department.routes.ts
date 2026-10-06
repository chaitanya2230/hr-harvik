import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { listDepartmentsHandler, listManagerOptionsHandler } from './department.controller';

/**
 * AGENTS.md §16 P1 — departments. Read-only: the employee form needs the
 * department and manager pickers, but department CRUD is system-settings work
 * (§6, HR Admin only) and is not part of P1.
 */
export const departmentRouter = Router();

departmentRouter.get('/', requireAuth, listDepartmentsHandler);
departmentRouter.get('/manager-options', requireAuth, listManagerOptionsHandler);
