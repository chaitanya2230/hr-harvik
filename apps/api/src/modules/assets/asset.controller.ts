import type { Request, Response } from 'express';
import { unauthorized } from '../../utils/errors';
import { requestMeta } from '../audit/audit.service';
import { isUnrestricted, resolveScope } from '../employees/employee.scope';
import type { EmployeeContext } from '../employees/employee.service';
import * as service from './asset.service';
import type {
  AssignAssetBody,
  CreateAssetBody,
  ListAssetAssignmentsQuery,
  ListAssetsQuery,
  RepairAssetBody,
  RetireAssetBody,
  ReturnAssetBody,
  UpdateAssetBody,
} from './asset.validation';

/**
 * AGENTS.md §8.8 — Assets controller. Thin HTTP translation; scope comes from
 * the account, master inventory stays HR-only via route guards.
 */

const ctxOf = (req: Request): EmployeeContext => {
  const account = req.user;
  if (!account) throw unauthorized('Authentication required');
  return { account, ...requestMeta(req) };
};

export async function list(req: Request, res: Response): Promise<void> {
  const result = await service.listAssets(req.query as unknown as ListAssetsQuery);
  res.status(200).json({ data: result.items, meta: result.meta });
}

export async function listAssignments(req: Request, res: Response): Promise<void> {
  const ctx = ctxOf(req);
  const scope = await resolveScope(ctx.account);
  const result = await service.listAssetAssignments(
    req.query as unknown as ListAssetAssignmentsQuery,
    isUnrestricted(scope) ? undefined : scope.employeeIds,
  );
  res.status(200).json({ data: result.items, meta: result.meta });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  res.status(200).json({ data: await service.getAssetById(id) });
}

export async function getHistory(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  res.status(200).json({ data: await service.getAssetHistory(id) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const asset = await service.createAsset(req.body as CreateAssetBody, ctxOf(req));
  res.status(201).json({ data: asset });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const asset = await service.updateAsset(id, req.body as UpdateAssetBody, ctxOf(req));
  res.status(200).json({ data: asset });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  await service.deleteAsset(id, ctxOf(req));
  res.status(204).end();
}

export async function assign(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const assignment = await service.assignAsset(id, req.body as AssignAssetBody, ctxOf(req));
  res.status(201).json({ data: assignment });
}

export async function returnAsset(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const assignment = await service.returnAsset(id, req.body as ReturnAssetBody, ctxOf(req));
  res.status(200).json({ data: assignment });
}

export async function repair(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const asset = await service.repairAsset(id, req.body as RepairAssetBody, ctxOf(req));
  res.status(200).json({ data: asset });
}

export async function retire(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const asset = await service.retireAsset(id, req.body as RetireAssetBody, ctxOf(req));
  res.status(200).json({ data: asset });
}
