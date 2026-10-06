import type { Request, Response } from 'express';
import { unauthorized } from '../../utils/errors';
import { requestMeta } from '../audit/audit.service';
import { resolveScope, assertWithinScope, isUnrestricted } from './employee.scope';
import * as service from './employee.service';
import type {
  ChangeStatusBody,
  CreateEmployeeBody,
  ListEmployeesQuery,
  UpdateEmployeeBody,
} from './employee.validation';

/**
 * AGENTS.md §8.2 — Employee Management controller.
 *
 * The controller only translates HTTP to service calls. Scope is resolved from
 * the authenticated account on every request, so a caller cannot widen it by
 * sending a parameter.
 */

const ctxOf = (req: Request): service.EmployeeContext => {
  const account = req.user;
  if (!account) throw unauthorized('Authentication required');
  return { account, ...requestMeta(req) };
};

export async function list(req: Request, res: Response): Promise<void> {
  const ctx = ctxOf(req);
  const scope = await resolveScope(ctx.account);

  const result = await service.listEmployees(
    req.query as unknown as ListEmployeesQuery,
    ctx,
    isUnrestricted(scope) ? undefined : scope.employeeIds,
  );

  res.status(200).json({ data: result.items, meta: result.meta });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const ctx = ctxOf(req);
  const scope = await resolveScope(ctx.account);
  const { id } = req.params as { id: string };

  assertWithinScope(scope, id);

  const employee = await service.getEmployeeById(id, ctx);
  res.status(200).json({ data: employee });
}

export async function history(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(ctxOf(req).account);
  const { id } = req.params as { id: string };

  assertWithinScope(scope, id);

  const result = await service.getEmployeeHistory(id);
  res.status(200).json({ data: result });
}

export async function create(req: Request, res: Response): Promise<void> {
  const employee = await service.createEmployee(req.body as CreateEmployeeBody, ctxOf(req));
  res.status(201).json({ data: employee });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const employee = await service.updateEmployee(id, req.body as UpdateEmployeeBody, ctxOf(req));
  res.status(200).json({ data: employee });
}

export async function changeStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const employee = await service.changeEmployeeStatus(id, req.body as ChangeStatusBody, ctxOf(req));
  res.status(200).json({ data: employee });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  await service.softDeleteEmployee(id, ctxOf(req));
  res.status(204).end();
}
