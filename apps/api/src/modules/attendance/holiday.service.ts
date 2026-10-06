import { Types } from 'mongoose';
import { Holiday } from './holiday.model';
import type { HolidayDoc } from './holiday.schema';
import { conflict, notFound } from '../../utils/errors';
import { recordAudit } from '../audit/audit.service';
import type { AuthAccount } from '../auth/auth.service';

import { trustedFilter } from '../../utils/mongo';

export async function listHolidays(year?: number): Promise<HolidayDoc[]> {
  const filter: Record<string, unknown> = { isDeleted: false };
  if (year) {
    filter.date = trustedFilter({ $regex: `^${year}-` });
  }
  return Holiday.find(filter).sort({ date: 1 });
}

export async function createHoliday(
  input: { date: string; name: string },
  actor: AuthAccount,
): Promise<HolidayDoc> {
  const existing = await Holiday.findOne({ date: input.date, isDeleted: false });
  if (existing) {
    throw conflict(`Holiday already exists for date ${input.date}`);
  }

  const holiday = await Holiday.create({
    date: input.date,
    name: input.name,
    createdBy: actor.userId ? new Types.ObjectId(actor.userId) : null,
  });

  await recordAudit({
    actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
    action: 'CREATE',
    entityType: 'Holiday',
    entityId: holiday._id,
    after: holiday.toObject(),
  });

  return holiday;
}

export async function deleteHoliday(id: string, actor: AuthAccount): Promise<HolidayDoc> {
  const holiday = await Holiday.findOne({ _id: id, isDeleted: false });
  if (!holiday) {
    throw notFound('Holiday not found');
  }

  holiday.isDeleted = true;
  await holiday.save();

  await recordAudit({
    actorId: actor.userId ? new Types.ObjectId(actor.userId) : null,
    action: 'DELETE',
    entityType: 'Holiday',
    entityId: holiday._id,
    before: holiday.toObject(),
  });

  return holiday;
}
