import type { NextFunction, Request, Response } from 'express';
import { getSettings, updateSettings } from './settings.service';
import { updateSettingsSchema } from './settings.validation';
import { unauthorized } from '../../utils/errors';
import { recordAuditFromRequest } from '../audit/audit.service';

/** GET /api/v1/settings — any signed-in account may read (the UI shows it). */
export async function readSettings(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await getSettings();
    res.json({ data: settings });
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/v1/settings — HR Admin only (`manageSettings`, §6). */
export async function writeSettings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) throw unauthorized('Authentication required');

    const body = updateSettingsSchema.parse(req.body);
    const before = await getSettings();
    const after = await updateSettings(body, { userId: user.userId });

    await recordAuditFromRequest(req, {
      actorId: user.userId,
      action: 'settings.update',
      entityType: 'Settings',
      entityId: 'system',
      before,
      after,
    });

    res.json({ data: after });
  } catch (error) {
    next(error);
  }
}
