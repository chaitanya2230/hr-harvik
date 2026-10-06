import type { Request, Response } from 'express';
import { unauthorized } from '../../utils/errors';
import { requestMeta } from '../audit/audit.service';
import {
  initiateExit,
  getExitForEmployee,
  listExits,
  provideClearance,
  updateChecklistItem,
  updateFinalSettlement,
  relieveEmployee,
  withdrawExit,
} from './exit.service';
import type {
  CreateExitBody,
  ListExitsQuery,
  ProvideClearanceBody,
  RelieveEmployeeBody,
  UpdateChecklistItemBody,
  UpdateSettlementBody,
} from './exit.validation';
import type { EmployeeContext } from '../employees/employee.service';

const ctxOf = (req: Request): EmployeeContext => {
  const account = req.user;
  if (!account) throw unauthorized('Authentication required');
  return { account, ...requestMeta(req) };
};

export async function listExitsHandler(req: Request, res: Response): Promise<void> {
  const result = await listExits(req.query as unknown as ListExitsQuery, ctxOf(req));
  res.json({
    data: result.items,
    meta: result.meta,
  });
}

export async function getExitHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const result = await getExitForEmployee(id, ctxOf(req));
  res.json({ data: result });
}

export async function initiateExitHandler(req: Request, res: Response): Promise<void> {
  const { employeeId } = req.params as { employeeId: string };
  const result = await initiateExit(employeeId, req.body as CreateExitBody, ctxOf(req));
  res.status(201).json({ data: result });
}

export async function provideClearanceHandler(req: Request, res: Response): Promise<void> {
  const { employeeId } = req.params as { employeeId: string };
  const result = await provideClearance(employeeId, req.body as ProvideClearanceBody, ctxOf(req));
  res.json({ data: result });
}

export async function updateChecklistItemHandler(req: Request, res: Response): Promise<void> {
  const { employeeId, itemId } = req.params as { employeeId: string; itemId: string };
  const result = await updateChecklistItem(
    employeeId,
    itemId,
    req.body as UpdateChecklistItemBody,
    ctxOf(req),
  );
  res.json({ data: result });
}

export async function updateSettlementHandler(req: Request, res: Response): Promise<void> {
  const { employeeId } = req.params as { employeeId: string };
  const result = await updateFinalSettlement(
    employeeId,
    req.body as UpdateSettlementBody,
    ctxOf(req),
  );
  res.json({ data: result });
}

export async function relieveEmployeeHandler(req: Request, res: Response): Promise<void> {
  const { employeeId } = req.params as { employeeId: string };
  const result = await relieveEmployee(employeeId, req.body as RelieveEmployeeBody, ctxOf(req));
  res.json({ data: result });
}

export async function withdrawExitHandler(req: Request, res: Response): Promise<void> {
  const { employeeId } = req.params as { employeeId: string };
  const result = await withdrawExit(employeeId, ctxOf(req));
  res.json({ data: result });
}
