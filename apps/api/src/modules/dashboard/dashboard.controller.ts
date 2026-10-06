import type { Request, Response } from 'express';
import { unauthorized } from '../../utils/errors';
import { getDashboardSummary } from './dashboard.service';

export async function summary(req: Request, res: Response): Promise<void> {
  const account = req.user;
  if (!account) throw unauthorized('Authentication required');

  // Scope is derived from the account inside the service; the client cannot ask
  // for a different one.
  const data = await getDashboardSummary(account);
  res.status(200).json({ data });
}
