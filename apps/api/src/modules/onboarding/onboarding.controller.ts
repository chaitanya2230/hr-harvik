import type { Request, Response } from 'express';
import * as onboardingService from './onboarding.service';
import {
  listOnboardingsQuerySchema,
  reopenOnboardingSchema,
  updateChecklistItemSchema,
} from './onboarding.validation';
import type { OnboardingItemKey } from '../../config/constants';

function getContext(req: Request) {
  return {
    account: req.user!,
    ip: req.ip ?? undefined,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

export async function listOnboardingsHandler(req: Request, res: Response): Promise<void> {
  const query = listOnboardingsQuerySchema.parse(req.query);
  const result = await onboardingService.listOnboardings(query, getContext(req));
  res.status(200).json(result);
}

export async function getOnboardingHandler(req: Request, res: Response): Promise<void> {
  const employeeId = (req.params.employeeId as string) ?? '';
  const result = await onboardingService.getOnboardingByEmployeeId(employeeId, getContext(req));
  res.status(200).json({ data: result });
}

export async function updateChecklistItemHandler(req: Request, res: Response): Promise<void> {
  const employeeId = (req.params.employeeId as string) ?? '';
  const itemKey = req.params.itemKey as OnboardingItemKey;
  const body = updateChecklistItemSchema.parse(req.body);
  const result = await onboardingService.updateChecklistItem(employeeId, itemKey, body, getContext(req));
  res.status(200).json({ data: result });
}

export async function reopenOnboardingHandler(req: Request, res: Response): Promise<void> {
  const employeeId = (req.params.employeeId as string) ?? '';
  const body = reopenOnboardingSchema.parse(req.body);
  const result = await onboardingService.reopenOnboarding(employeeId, body, getContext(req));
  res.status(200).json({ data: result });
}
