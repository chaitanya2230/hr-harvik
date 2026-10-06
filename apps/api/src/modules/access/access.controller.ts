import type { Request, Response } from 'express';
import { forbidden, unauthorized } from '../../utils/errors';
import { requestMeta } from '../audit/audit.service';
import { assertWithinScope, isUnrestricted, resolveScope } from '../employees/employee.scope';
import type { EmployeeContext } from '../employees/employee.service';
import * as service from './access.service';
import type { CreateAccessItemBody, ListAccessItemsQuery } from './access.validation';

/** AGENTS.md §7 — Access Items controller (manual records only, D-31). */

const ctxOf = (req: Request): EmployeeContext => {
  const account = req.user;
  if (!account) throw unauthorized('Authentication required');
  return { account, ...requestMeta(req) };
};

export async function list(req: Request, res: Response): Promise<void> {
  const ctx = ctxOf(req);
  const scope = await resolveScope(ctx.account);
  const result = await service.listAccessItems(
    req.query as unknown as ListAccessItemsQuery,
    isUnrestricted(scope) ? undefined : scope.employeeIds,
  );
  res.status(200).json({ data: result.items, meta: result.meta });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const ctx = ctxOf(req);
  const scope = await resolveScope(ctx.account);
  const { id } = req.params as { id: string };
  const item = await service.getAccessItemById(id);
  // Scoped read: HR sees any item, others only their scope (§6 self-service).
  if (!isUnrestricted(scope)) {
    if (!item.employee) throw forbidden('You do not have access to this access item');
    assertWithinScope(scope, item.employee.id);
  }
  res.status(200).json({ data: item });
}

export async function create(req: Request, res: Response): Promise<void> {
  const item = await service.createAccessItem(req.body as CreateAccessItemBody, ctxOf(req));
  res.status(201).json({ data: item });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const item = await service.revokeAccessItem(id, ctxOf(req));
  res.status(200).json({ data: item });
}
