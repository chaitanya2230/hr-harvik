import { Types, type FilterQuery } from 'mongoose';
import { Job } from './job.model';
import type { JobDoc } from './job.schema';
import { Employee } from '../employees/employee.model';
import { Department } from '../departments/department.model';
import { nextHumanId } from '../../utils/ids';
import { recordAudit } from '../audit/audit.service';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { collectTeamIds } from '../employees/employee.scope';
import { trustedFilter } from '../../utils/mongo';
import { forbidden, notFound, unprocessable } from '../../utils/errors';
import { buildPagination, listMeta } from '../../utils/http';
import type { AuthAccount } from '../auth/auth.service';
import type { CreateJobBody, ListJobsQuery, UpdateJobBody } from './recruitment.validation';

export interface JobContext {
  account: AuthAccount;
  ip?: string;
  userAgent?: string;
}

export interface JobView {
  id: string;
  jobCode: string;
  title: string;
  departmentId: string;
  departmentName?: string;
  openings: number;
  filledCount: number;
  remainingOpenings: number;
  description: string;
  requiredSkills: string[];
  hiringManagerId: string;
  hiringManagerName?: string;
  openingDate: string;
  closingDate?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const toId = (val: string): Types.ObjectId => new Types.ObjectId(val);

function toJobView(doc: JobDoc): JobView {
  const dept = doc.departmentId as unknown as { _id?: Types.ObjectId; name?: string };
  const mgr = doc.hiringManagerId as unknown as { _id?: Types.ObjectId; firstName?: string; lastName?: string };

  const deptName = typeof dept === 'object' && dept !== null && 'name' in dept ? dept.name : undefined;
  const mgrName =
    typeof mgr === 'object' && mgr !== null && 'firstName' in mgr
      ? `${mgr.firstName ?? ''} ${mgr.lastName ?? ''}`.trim()
      : undefined;

  const departmentId =
    typeof dept === 'object' && dept !== null && '_id' in dept && dept._id
      ? dept._id.toString()
      : doc.departmentId.toString();

  const hiringManagerId =
    typeof mgr === 'object' && mgr !== null && '_id' in mgr && mgr._id
      ? mgr._id.toString()
      : doc.hiringManagerId.toString();

  return {
    id: doc._id.toString(),
    jobCode: doc.jobCode,
    title: doc.title,
    departmentId,
    departmentName: deptName,
    openings: doc.openings,
    filledCount: doc.filledCount,
    remainingOpenings: Math.max(0, doc.openings - doc.filledCount),
    description: doc.description,
    requiredSkills: doc.requiredSkills ?? [],
    hiringManagerId,
    hiringManagerName: mgrName,
    openingDate: doc.openingDate,
    closingDate: doc.closingDate ?? null,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function assertDepartmentExists(departmentId: string): Promise<void> {
  const exists = await Department.exists({ _id: toId(departmentId) });
  if (!exists) {
    throw unprocessable('The specified department does not exist');
  }
}

async function assertHiringManagerValid(hiringManagerId: string): Promise<void> {
  const manager = await Employee.findOne({ _id: toId(hiringManagerId), isDeleted: false })
    .select('status')
    .lean()
    .exec();

  if (!manager) {
    throw unprocessable('The specified hiring manager does not exist');
  }
  if (manager.status === 'Relieved') {
    throw unprocessable('The specified hiring manager has been Relieved');
  }
}

export async function createJob(body: CreateJobBody, ctx: JobContext): Promise<JobView> {
  await assertDepartmentExists(body.departmentId);
  await assertHiringManagerValid(body.hiringManagerId);

  const jobCode = await nextHumanId('job');

  const created = await Job.create({
    jobCode,
    title: body.title,
    departmentId: toId(body.departmentId),
    openings: body.openings,
    filledCount: 0,
    description: body.description,
    requiredSkills: body.requiredSkills ?? [],
    hiringManagerId: toId(body.hiringManagerId),
    openingDate: body.openingDate,
    closingDate: body.closingDate ?? null,
    status: body.status ?? 'Open',
    createdBy: ctx.account.userId ? toId(ctx.account.userId) : null,
    isDeleted: false,
  });

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'job.created',
    entityType: 'Job',
    entityId: created._id,
    after: { jobCode, title: body.title, openings: body.openings, status: created.status },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();

  const populated = await Job.findById(created._id)
    .populate('departmentId', 'name')
    .populate('hiringManagerId', 'firstName lastName')
    .lean()
    .exec();

  return toJobView(populated as unknown as JobDoc);
}

export async function getJobById(id: string, ctx: JobContext): Promise<JobView> {
  const job = await Job.findOne({ _id: toId(id), isDeleted: false })
    .populate('departmentId', 'name')
    .populate('hiringManagerId', 'firstName lastName')
    .lean()
    .exec();

  if (!job) throw notFound('Job');

  // Manager scoping
  if (ctx.account.role === 'Manager') {
    if (!ctx.account.employeeId) throw forbidden('Manager without employee record cannot view jobs');
    const teamIds = await collectTeamIds(ctx.account.employeeId);
    const mgrId = job.hiringManagerId as unknown as { _id?: Types.ObjectId };
    const mgrIdStr = mgrId?._id ? mgrId._id.toString() : job.hiringManagerId.toString();
    if (!teamIds.has(mgrIdStr)) {
      throw forbidden('You are not authorized to view this job');
    }
  }

  return toJobView(job as unknown as JobDoc);
}

export async function listJobs(
  query: ListJobsQuery,
  ctx: JobContext,
): Promise<{ data: JobView[]; meta: ReturnType<typeof listMeta> }> {
  const { skip, limit, page } = buildPagination(query);
  const filter: FilterQuery<JobDoc> = { isDeleted: false };

  if (ctx.account.role === 'Manager') {
    if (!ctx.account.employeeId) {
      return { data: [], meta: listMeta({ page, limit, skip }, 0) };
    }
    const teamIds = await collectTeamIds(ctx.account.employeeId);
    const allowedManagerIds = Array.from(teamIds).map((id) => toId(id));
    filter.hiringManagerId = trustedFilter({ $in: allowedManagerIds });
  } else if (query.hiringManagerId) {
    filter.hiringManagerId = toId(query.hiringManagerId);
  }

  if (query.departmentId) {
    filter.departmentId = toId(query.departmentId);
  }
  if (query.status) {
    filter.status = query.status;
  }
  if (query.q) {
    const regex = new RegExp(query.q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i');
    filter.$or = trustedFilter([{ title: regex }, { jobCode: regex }, { description: regex }]);
  }

  const [total, docs] = await Promise.all([
    Job.countDocuments(filter).exec(),
    Job.find(filter)
      .sort(query.sort ? { [query.sort]: 1 } : { createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('departmentId', 'name')
      .populate('hiringManagerId', 'firstName lastName')
      .lean()
      .exec(),
  ]);

  const data = docs.map((d) => toJobView(d as unknown as JobDoc));
  return { data, meta: listMeta({ page, limit, skip }, total) };
}

export async function updateJob(
  id: string,
  body: UpdateJobBody,
  ctx: JobContext,
): Promise<JobView> {
  const jobId = toId(id);
  const existing = await Job.findOne({ _id: jobId, isDeleted: false }).exec();
  if (!existing) throw notFound('Job');

  if (body.departmentId) {
    await assertDepartmentExists(body.departmentId);
    existing.departmentId = toId(body.departmentId);
  }
  if (body.hiringManagerId) {
    await assertHiringManagerValid(body.hiringManagerId);
    existing.hiringManagerId = toId(body.hiringManagerId);
  }
  if (body.title !== undefined) existing.title = body.title;
  if (body.description !== undefined) existing.description = body.description;
  if (body.requiredSkills !== undefined) existing.requiredSkills = body.requiredSkills;
  if (body.openingDate !== undefined) existing.openingDate = body.openingDate;
  if (body.closingDate !== undefined) existing.closingDate = body.closingDate;

  if (body.openings !== undefined) {
    if (body.openings < existing.filledCount) {
      throw unprocessable(
        `Openings cannot be less than current filled count of ${existing.filledCount}`,
      );
    }
    existing.openings = body.openings;
    if (existing.status === 'Filled' && existing.openings > existing.filledCount) {
      existing.status = 'Open';
    }
  }

  if (body.status !== undefined) {
    if (body.status === 'Filled' && existing.filledCount < existing.openings) {
      // Allow manual marking as filled if company decides to close hiring
      existing.status = 'Filled';
    } else {
      existing.status = body.status;
    }
  }

  await existing.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'job.updated',
    entityType: 'Job',
    entityId: jobId,
    after: { title: existing.title, openings: existing.openings, status: existing.status },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();

  const populated = await Job.findById(jobId)
    .populate('departmentId', 'name')
    .populate('hiringManagerId', 'firstName lastName')
    .lean()
    .exec();

  return toJobView(populated as unknown as JobDoc);
}

export async function deleteJob(id: string, ctx: JobContext): Promise<void> {
  const jobId = toId(id);
  const existing = await Job.findOne({ _id: jobId, isDeleted: false }).exec();
  if (!existing) throw notFound('Job');

  existing.isDeleted = true;
  await existing.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'job.deleted',
    entityType: 'Job',
    entityId: jobId,
    before: { jobCode: existing.jobCode, title: existing.title },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();
}
