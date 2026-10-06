import { Types } from 'mongoose';
import { LeaveType } from './leave-type.model';
import type { LeaveTypeDoc } from './leave-type.schema';
import { conflict, notFound } from '../../utils/errors';
import { recordAudit } from '../audit/audit.service';
import type { AuthAccount } from '../auth/auth.service';
import type { CreateLeaveTypeInput, UpdateLeaveTypeInput } from './leave.validation';

export async function listLeaveTypes(): Promise<LeaveTypeDoc[]> {
  return LeaveType.find({ isDeleted: false }).sort({ name: 1 });
}

export async function createLeaveType(
  input: CreateLeaveTypeInput,
  actor: AuthAccount,
): Promise<LeaveTypeDoc> {
  const existing = await LeaveType.findOne({ code: input.code.toUpperCase(), isDeleted: false });
  if (existing) {
    throw conflict(`Leave type with code ${input.code} already exists`);
  }

  const leaveType = await LeaveType.create({
    name: input.name,
    code: input.code.toUpperCase(),
    annualAllocation: input.annualAllocation,
    carryForward: input.carryForward,
    maxCarryForward: input.maxCarryForward,
    isPaid: input.isPaid,
    requiresDocument: input.requiresDocument,
    applicableEmploymentTypes: input.applicableEmploymentTypes,
    isActive: input.isActive,
    createdBy: actor.userId ? new Types.ObjectId(actor.userId) : null,
  });

  await recordAudit({
    actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
    action: 'CREATE',
    entityType: 'LeaveType',
    entityId: leaveType._id,
    after: leaveType.toObject(),
  });

  return leaveType;
}

export async function updateLeaveType(
  id: string,
  input: UpdateLeaveTypeInput,
  actor: AuthAccount,
): Promise<LeaveTypeDoc> {
  const leaveType = await LeaveType.findOne({ _id: id, isDeleted: false });
  if (!leaveType) {
    throw notFound('Leave type not found');
  }

  const before = leaveType.toObject();

  if (input.name !== undefined) leaveType.name = input.name;
  if (input.annualAllocation !== undefined) leaveType.annualAllocation = input.annualAllocation;
  if (input.carryForward !== undefined) leaveType.carryForward = input.carryForward;
  if (input.maxCarryForward !== undefined) leaveType.maxCarryForward = input.maxCarryForward;
  if (input.isPaid !== undefined) leaveType.isPaid = input.isPaid;
  if (input.requiresDocument !== undefined) leaveType.requiresDocument = input.requiresDocument;
  if (input.applicableEmploymentTypes !== undefined) leaveType.applicableEmploymentTypes = input.applicableEmploymentTypes;
  if (input.isActive !== undefined) leaveType.isActive = input.isActive;

  await leaveType.save();

  await recordAudit({
    actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
    action: 'UPDATE',
    entityType: 'LeaveType',
    entityId: leaveType._id,
    before,
    after: leaveType.toObject(),
  });

  return leaveType;
}
