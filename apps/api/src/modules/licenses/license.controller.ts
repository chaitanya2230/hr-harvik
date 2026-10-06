import type { Request, Response } from 'express';
import { unauthorized } from '../../utils/errors';
import { requestMeta } from '../audit/audit.service';
import { isUnrestricted, resolveScope } from '../employees/employee.scope';
import type { EmployeeContext } from '../employees/employee.service';
import * as service from './license.service';
import type {
  AssignLicenseBody,
  CreateLicenseBody,
  ListLicenseAssignmentsQuery,
  ListLicensesQuery,
  RenewLicenseBody,
  RevokeLicenseAssignmentBody,
  SuspendLicenseBody,
  UpdateLicenseBody,
} from './license.validation';

/**
 * AGENTS.md §8.9 — Licenses controller. The plaintext key never appears in any
 * response here; only the reveal endpoint returns it, HR-Admin-only.
 */

const ctxOf = (req: Request): EmployeeContext => {
  const account = req.user;
  if (!account) throw unauthorized('Authentication required');
  return { account, ...requestMeta(req) };
};

export async function list(req: Request, res: Response): Promise<void> {
  const result = await service.listLicenses(req.query as unknown as ListLicensesQuery);
  res.status(200).json({ data: result.items, meta: result.meta });
}

export async function listAssignments(req: Request, res: Response): Promise<void> {
  const ctx = ctxOf(req);
  const scope = await resolveScope(ctx.account);
  const result = await service.listLicenseAssignments(
    req.query as unknown as ListLicenseAssignmentsQuery,
    isUnrestricted(scope) ? undefined : scope.employeeIds,
  );
  res.status(200).json({ data: result.items, meta: result.meta });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  res.status(200).json({ data: await service.getLicenseById(id) });
}

export async function getUtilization(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  res.status(200).json({ data: await service.getLicenseUtilization(id) });
}

export async function revealKey(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  res.status(200).json({ data: await service.revealLicenseKey(id, ctxOf(req)) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const license = await service.createLicense(req.body as CreateLicenseBody, ctxOf(req));
  res.status(201).json({ data: license });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const license = await service.updateLicense(id, req.body as UpdateLicenseBody, ctxOf(req));
  res.status(200).json({ data: license });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  await service.deleteLicense(id, ctxOf(req));
  res.status(204).end();
}

export async function assign(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const assignment = await service.assignLicense(id, req.body as AssignLicenseBody, ctxOf(req));
  res.status(201).json({ data: assignment });
}

export async function revokeAssignment(req: Request, res: Response): Promise<void> {
  const { assignmentId } = req.params as { assignmentId: string };
  const assignment = await service.revokeLicenseAssignment(
    assignmentId,
    req.body as RevokeLicenseAssignmentBody,
    ctxOf(req),
  );
  res.status(200).json({ data: assignment });
}

export async function renew(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const license = await service.renewLicense(id, req.body as RenewLicenseBody, ctxOf(req));
  res.status(200).json({ data: license });
}

export async function suspend(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const license = await service.suspendLicense(id, req.body as SuspendLicenseBody, ctxOf(req));
  res.status(200).json({ data: license });
}

export async function expire(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const license = await service.expireLicense(id, ctxOf(req));
  res.status(200).json({ data: license });
}

export async function revokeLicense(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const license = await service.revokeLicense(id, ctxOf(req));
  res.status(200).json({ data: license });
}
