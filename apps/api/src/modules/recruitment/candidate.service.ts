import { Types, type FilterQuery } from 'mongoose';
import { Candidate } from './candidate.model';
import type { CandidateDoc, InterviewDoc } from './candidate.schema';
import { Job } from './job.model';
import { Employee } from '../employees/employee.model';
import { nextHumanId } from '../../utils/ids';
import { recordAudit } from '../audit/audit.service';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { collectTeamIds } from '../employees/employee.scope';
import { trustedFilter } from '../../utils/mongo';
import { conflict, forbidden, notFound, unprocessable } from '../../utils/errors';
import { buildPagination, listMeta } from '../../utils/http';
import type { AuthAccount } from '../auth/auth.service';
import {
  saveUploadedResume,
  validateResumeFileSize,
  validateResumeFileSignature,
  readResumeFileStream,
  deleteResumeFile,
} from './resume.service';
import type {
  CreateCandidateBody,
  InterviewFeedbackBody,
  ListCandidatesQuery,
  ScheduleInterviewBody,
  UpdateCandidateBody,
  UpdateCandidateStageBody,
  UpdateOfferBody,
} from './recruitment.validation';
import type { CandidateStage } from '../../config/constants';

export interface CandidateContext {
  account: AuthAccount;
  ip?: string;
  userAgent?: string;
}

export interface CandidateView {
  id: string;
  candidateCode: string;
  name: string;
  email: string;
  phone: string;
  jobId: string;
  jobCode?: string;
  jobTitle?: string;
  departmentName?: string;
  source: string;
  stage: CandidateStage;
  selectionStatus: string;
  offerStatus: string;
  joiningDate?: string | null;
  resumeFile?: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  } | null;
  interviews: Array<{
    id?: string;
    round: number;
    title: string;
    interviewerId: string;
    interviewerName?: string;
    scheduledAt: string;
    status: string;
    feedback?: string | null;
    rating?: number | null;
    completedAt?: string | null;
  }>;
  stageHistory: Array<{
    stage: string;
    changedAt: string;
    changedBy?: string | null;
    note?: string | null;
  }>;
  rejectionReason?: string | null;
  convertedEmployeeId?: string | null;
  createdAt: string;
  updatedAt: string;
}

const toId = (val: string): Types.ObjectId => new Types.ObjectId(val);

export const ALLOWED_STAGE_TRANSITIONS: Record<CandidateStage, readonly CandidateStage[]> = {
  Applied: ['Shortlisted', 'Rejected'],
  Shortlisted: ['Interview', 'Rejected'],
  Interview: ['Selected', 'Rejected'],
  Selected: ['Offer', 'Rejected'],
  Offer: ['Joined', 'Rejected'],
  Joined: [],
  Rejected: ['Shortlisted'], // HR reconsideration
};

function toCandidateView(doc: CandidateDoc): CandidateView {
  const job = doc.jobId as unknown as { _id?: Types.ObjectId; jobCode?: string; title?: string; departmentId?: { name?: string } };
  const jobTitle = typeof job === 'object' && job !== null && 'title' in job ? job.title : undefined;
  const jobCode = typeof job === 'object' && job !== null && 'jobCode' in job ? job.jobCode : undefined;
  const deptName =
    typeof job === 'object' && job !== null && job.departmentId && typeof job.departmentId === 'object' && 'name' in job.departmentId
      ? job.departmentId.name
      : undefined;

  const jobIdStr =
    typeof job === 'object' && job !== null && '_id' in job && job._id ? job._id.toString() : doc.jobId.toString();

  return {
    id: doc._id.toString(),
    candidateCode: doc.candidateCode,
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    jobId: jobIdStr,
    jobCode,
    jobTitle,
    departmentName: deptName,
    source: doc.source,
    stage: doc.stage,
    selectionStatus: doc.selectionStatus,
    offerStatus: doc.offerStatus,
    joiningDate: doc.joiningDate ?? null,
    resumeFile: doc.resumeFile
      ? {
          originalName: doc.resumeFile.originalName,
          mimeType: doc.resumeFile.mimeType,
          sizeBytes: doc.resumeFile.sizeBytes,
          uploadedAt: doc.resumeFile.uploadedAt.toISOString(),
        }
      : null,
    interviews: (doc.interviews ?? []).map((i) => {
      const interviewer = i.interviewerId as unknown as { _id?: Types.ObjectId; firstName?: string; lastName?: string };
      const interviewerName =
        typeof interviewer === 'object' && interviewer !== null && 'firstName' in interviewer
          ? `${interviewer.firstName ?? ''} ${interviewer.lastName ?? ''}`.trim()
          : undefined;
      const interviewerId =
        typeof interviewer === 'object' && interviewer !== null && '_id' in interviewer && interviewer._id
          ? interviewer._id.toString()
          : i.interviewerId.toString();
      const interviewDocWithId = i as unknown as { _id?: Types.ObjectId };

      return {
        id: interviewDocWithId._id?.toString(),
        round: i.round,
        title: i.title,
        interviewerId,
        interviewerName,
        scheduledAt: i.scheduledAt.toISOString(),
        status: i.status,
        feedback: i.feedback ?? null,
        rating: i.rating ?? null,
        completedAt: i.completedAt ? i.completedAt.toISOString() : null,
      };
    }),
    stageHistory: (doc.stageHistory ?? []).map((sh) => ({
      stage: sh.stage,
      changedAt: sh.changedAt.toISOString(),
      changedBy: sh.changedBy ? sh.changedBy.toString() : null,
      note: sh.note ?? null,
    })),
    rejectionReason: doc.rejectionReason ?? null,
    convertedEmployeeId: doc.convertedEmployeeId ? doc.convertedEmployeeId.toString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function createCandidate(
  body: CreateCandidateBody,
  ctx: CandidateContext,
): Promise<CandidateView> {
  const jobId = toId(body.jobId);
  const job = await Job.findOne({ _id: jobId, isDeleted: false }).exec();
  if (!job) throw unprocessable('The specified job opening does not exist');

  const email = body.email.toLowerCase().trim();
  const existingApp = await Candidate.findOne({
    email,
    jobId,
    isDeleted: false,
  }).exec();

  if (existingApp) {
    throw conflict(`Candidate with email ${email} has already applied for this job`);
  }

  const candidateCode = await nextHumanId('candidate');

  const created = await Candidate.create({
    candidateCode,
    name: body.name,
    email,
    phone: body.phone,
    jobId,
    source: body.source,
    stage: 'Applied',
    interviews: [],
    selectionStatus: 'Pending',
    offerStatus: 'Pending',
    joiningDate: body.joiningDate ?? null,
    stageHistory: [
      {
        stage: 'Applied',
        changedAt: new Date(),
        changedBy: ctx.account.userId ? toId(ctx.account.userId) : null,
        note: 'Initial application submitted',
      },
    ],
    createdBy: ctx.account.userId ? toId(ctx.account.userId) : null,
    isDeleted: false,
  });

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'candidate.created',
    entityType: 'Candidate',
    entityId: created._id,
    after: { candidateCode, name: body.name, email, jobId: body.jobId },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();

  const populated = await Candidate.findById(created._id)
    .populate({ path: 'jobId', populate: { path: 'departmentId', select: 'name' } })
    .lean()
    .exec();

  return toCandidateView(populated as unknown as CandidateDoc);
}

export async function getCandidateById(id: string, ctx: CandidateContext): Promise<CandidateView> {
  const candidate = await Candidate.findOne({ _id: toId(id), isDeleted: false })
    .populate({ path: 'jobId', populate: { path: 'departmentId', select: 'name' } })
    .populate('interviews.interviewerId', 'firstName lastName')
    .lean()
    .exec();

  if (!candidate) throw notFound('Candidate');

  if (ctx.account.role === 'Manager') {
    if (!ctx.account.employeeId) throw forbidden('Manager without employee record cannot view candidates');
    const teamIds = await collectTeamIds(ctx.account.employeeId);

    const job = await Job.findById(candidate.jobId).select('hiringManagerId').lean().exec();
    const isHiringManager = job && teamIds.has(job.hiringManagerId.toString());
    const isAssignedInterviewer = candidate.interviews?.some((i) => {
      const intId = i.interviewerId as unknown as { _id?: Types.ObjectId };
      const idStr = intId?._id ? intId._id.toString() : i.interviewerId.toString();
      return teamIds.has(idStr);
    });

    if (!isHiringManager && !isAssignedInterviewer) {
      throw forbidden('You are not authorized to view this candidate');
    }
  }

  return toCandidateView(candidate as unknown as CandidateDoc);
}

export async function listCandidates(
  query: ListCandidatesQuery,
  ctx: CandidateContext,
): Promise<{ data: CandidateView[]; meta: ReturnType<typeof listMeta> }> {
  const { skip, limit, page } = buildPagination(query);
  const filter: FilterQuery<CandidateDoc> = { isDeleted: false };

  if (ctx.account.role === 'Manager') {
    if (!ctx.account.employeeId) {
      return { data: [], meta: listMeta({ page, limit, skip }, 0) };
    }
    const teamIds = await collectTeamIds(ctx.account.employeeId);
    const allowedManagerIds = Array.from(teamIds).map((id) => toId(id));
    const jobs = await Job.find({
      hiringManagerId: trustedFilter({ $in: allowedManagerIds }),
      isDeleted: false,
    })
      .select('_id')
      .lean()
      .exec();
    const jobIds = jobs.map((j) => j._id);
    filter.$or = trustedFilter([
      { jobId: trustedFilter({ $in: jobIds }) },
      { 'interviews.interviewerId': trustedFilter({ $in: allowedManagerIds }) },
    ]);
  }

  if (query.jobId) filter.jobId = toId(query.jobId);
  if (query.stage) filter.stage = query.stage;
  if (query.source) filter.source = query.source;

  if (query.q) {
    const regex = new RegExp(query.q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i');
    const qOr: Array<FilterQuery<CandidateDoc>> = [
      { name: regex },
      { candidateCode: regex },
      { email: regex },
      { phone: regex },
    ];
    if (filter.$or) {
      filter.$and = trustedFilter([{ $or: filter.$or }, { $or: trustedFilter(qOr) }]);
      delete filter.$or;
    } else {
      filter.$or = trustedFilter(qOr);
    }
  }

  const [total, docs] = await Promise.all([
    Candidate.countDocuments(filter).exec(),
    Candidate.find(filter)
      .sort(query.sort ? { [query.sort]: 1 } : { createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'jobId', populate: { path: 'departmentId', select: 'name' } })
      .populate('interviews.interviewerId', 'firstName lastName')
      .lean()
      .exec(),
  ]);

  const data = docs.map((d) => toCandidateView(d as unknown as CandidateDoc));
  return { data, meta: listMeta({ page, limit, skip }, total) };
}

export async function updateCandidate(
  id: string,
  body: UpdateCandidateBody,
  ctx: CandidateContext,
): Promise<CandidateView> {
  const candidateId = toId(id);
  const existing = await Candidate.findOne({ _id: candidateId, isDeleted: false }).exec();
  if (!existing) throw notFound('Candidate');

  if (body.name !== undefined) existing.name = body.name;
  if (body.phone !== undefined) existing.phone = body.phone;
  if (body.source !== undefined) existing.source = body.source;
  if (body.joiningDate !== undefined) existing.joiningDate = body.joiningDate;

  if (body.email !== undefined && body.email.toLowerCase() !== existing.email) {
    const email = body.email.toLowerCase();
    const conflictCandidate = await Candidate.findOne({
      email,
      jobId: existing.jobId,
      _id: { $ne: candidateId },
      isDeleted: false,
    }).exec();
    if (conflictCandidate) {
      throw conflict(`Candidate with email ${email} already exists for this job`);
    }
    existing.email = email;
  }

  await existing.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'candidate.updated',
    entityType: 'Candidate',
    entityId: candidateId,
    after: { name: existing.name, email: existing.email, stage: existing.stage },
    ip: ctx.ip,
  });

  const populated = await Candidate.findById(candidateId)
    .populate({ path: 'jobId', populate: { path: 'departmentId', select: 'name' } })
    .populate('interviews.interviewerId', 'firstName lastName')
    .lean()
    .exec();

  return toCandidateView(populated as unknown as CandidateDoc);
}

export async function updateCandidateStage(
  id: string,
  body: UpdateCandidateStageBody,
  ctx: CandidateContext,
): Promise<CandidateView> {
  const candidateId = toId(id);
  const existing = await Candidate.findOne({ _id: candidateId, isDeleted: false }).exec();
  if (!existing) throw notFound('Candidate');

  const currentStage = existing.stage;
  const targetStage = body.stage;

  if (currentStage === targetStage) {
    return getCandidateById(id, ctx);
  }

  const allowedTargets = ALLOWED_STAGE_TRANSITIONS[currentStage];
  if (!allowedTargets.includes(targetStage)) {
    throw unprocessable(
      `Cannot move candidate from stage "${currentStage}" to "${targetStage}". Allowed transitions from "${currentStage}": ${
        allowedTargets.join(', ') || 'none'
      }`,
    );
  }

  if (targetStage === 'Rejected') {
    existing.selectionStatus = 'Rejected';
    existing.rejectionReason = body.rejectionReason ?? 'Candidate rejected';
  } else if (targetStage === 'Selected') {
    existing.selectionStatus = 'Selected';
  } else if (targetStage === 'Offer') {
    existing.offerStatus = 'Pending';
  }

  existing.stage = targetStage;
  existing.stageHistory.push({
    stage: targetStage,
    changedAt: new Date(),
    changedBy: ctx.account.userId ? toId(ctx.account.userId) : null,
    note: body.note ?? (targetStage === 'Rejected' ? body.rejectionReason : `Moved to ${targetStage}`),
  });

  await existing.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'candidate.stage_changed',
    entityType: 'Candidate',
    entityId: candidateId,
    before: { stage: currentStage },
    after: { stage: targetStage, rejectionReason: existing.rejectionReason },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();

  return getCandidateById(id, ctx);
}

export async function scheduleInterview(
  id: string,
  body: ScheduleInterviewBody,
  ctx: CandidateContext,
): Promise<CandidateView> {
  const candidateId = toId(id);
  const existing = await Candidate.findOne({ _id: candidateId, isDeleted: false }).exec();
  if (!existing) throw notFound('Candidate');

  if (existing.stage === 'Rejected' || existing.stage === 'Joined') {
    throw unprocessable(`Cannot schedule interview for candidate in ${existing.stage} stage`);
  }

  const interviewer = await Employee.findOne({ _id: toId(body.interviewerId), isDeleted: false }).exec();
  if (!interviewer) throw unprocessable('The specified interviewer does not exist');
  if (interviewer.status === 'Relieved') throw unprocessable('The specified interviewer has been Relieved');

  const existingRound = existing.interviews.find((i) => i.round === body.round);
  if (existingRound) {
    throw conflict(`Interview round ${body.round} already exists for this candidate`);
  }

  const interviewDoc: InterviewDoc = {
    round: body.round,
    title: body.title,
    interviewerId: toId(body.interviewerId),
    scheduledAt: new Date(body.scheduledAt),
    status: 'Scheduled',
    feedback: null,
    rating: null,
    completedAt: null,
  };

  existing.interviews.push(interviewDoc);
  if (existing.stage === 'Shortlisted') {
    existing.stage = 'Interview';
    existing.stageHistory.push({
      stage: 'Interview',
      changedAt: new Date(),
      changedBy: ctx.account.userId ? toId(ctx.account.userId) : null,
      note: `Interview round ${body.round} scheduled`,
    });
  }

  await existing.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'candidate.interview_scheduled',
    entityType: 'Candidate',
    entityId: candidateId,
    after: { round: body.round, interviewerId: body.interviewerId, scheduledAt: body.scheduledAt },
    ip: ctx.ip,
  });

  return getCandidateById(id, ctx);
}

export async function submitInterviewFeedback(
  id: string,
  round: number,
  body: InterviewFeedbackBody,
  ctx: CandidateContext,
): Promise<CandidateView> {
  const candidateId = toId(id);
  const existing = await Candidate.findOne({ _id: candidateId, isDeleted: false }).exec();
  if (!existing) throw notFound('Candidate');

  const interview = existing.interviews.find((i) => i.round === round);
  if (!interview) throw notFound(`Interview round ${round}`);

  // Manager authorization: must be interviewer, hiring manager, or HR
  if (ctx.account.role === 'Manager') {
    if (!ctx.account.employeeId) throw forbidden('Manager without employee record cannot submit feedback');
    const job = await Job.findById(existing.jobId).select('hiringManagerId').lean().exec();
    const isInterviewer = interview.interviewerId.toString() === ctx.account.employeeId;
    const isHiringManager = job?.hiringManagerId.toString() === ctx.account.employeeId;
    if (!isInterviewer && !isHiringManager) {
      throw forbidden('Only the assigned interviewer or hiring manager can submit feedback');
    }
  }

  interview.feedback = body.feedback;
  interview.rating = body.rating;
  interview.status = body.status;
  interview.completedAt = new Date();

  await existing.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'candidate.interview_feedback_submitted',
    entityType: 'Candidate',
    entityId: candidateId,
    after: { round, rating: body.rating, status: body.status },
    ip: ctx.ip,
  });

  return getCandidateById(id, ctx);
}

export async function updateOfferStatus(
  id: string,
  body: UpdateOfferBody,
  ctx: CandidateContext,
): Promise<CandidateView> {
  const candidateId = toId(id);
  const existing = await Candidate.findOne({ _id: candidateId, isDeleted: false }).exec();
  if (!existing) throw notFound('Candidate');

  if (existing.stage !== 'Offer' && existing.stage !== 'Selected') {
    throw unprocessable(`Cannot manage offer while candidate is in ${existing.stage} stage`);
  }

  existing.offerStatus = body.offerStatus;
  if (body.joiningDate) {
    existing.joiningDate = body.joiningDate;
  }

  if (existing.stage === 'Selected') {
    existing.stage = 'Offer';
    existing.stageHistory.push({
      stage: 'Offer',
      changedAt: new Date(),
      changedBy: ctx.account.userId ? toId(ctx.account.userId) : null,
      note: `Offer status updated to ${body.offerStatus}`,
    });
  }

  await existing.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'candidate.offer_status_updated',
    entityType: 'Candidate',
    entityId: candidateId,
    after: { offerStatus: body.offerStatus, joiningDate: existing.joiningDate },
    ip: ctx.ip,
  });

  return getCandidateById(id, ctx);
}

export async function uploadCandidateResume(
  id: string,
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ctx: CandidateContext,
): Promise<CandidateView> {
  const candidateId = toId(id);
  const existing = await Candidate.findOne({ _id: candidateId, isDeleted: false }).exec();
  if (!existing) throw notFound('Candidate');

  validateResumeFileSize(file.size);
  validateResumeFileSignature(file.buffer, file.mimetype);

  if (existing.resumeFile?.serverFilename) {
    deleteResumeFile(existing.resumeFile.serverFilename);
  }

  const { serverFilename } = saveUploadedResume(file.buffer, file.mimetype);

  existing.resumeFile = {
    serverFilename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    uploadedAt: new Date(),
  };

  await existing.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'candidate.resume_uploaded',
    entityType: 'Candidate',
    entityId: candidateId,
    after: { originalName: file.originalname, sizeBytes: file.size },
    ip: ctx.ip,
  });

  return getCandidateById(id, ctx);
}

export async function getCandidateResumeStream(
  id: string,
  ctx: CandidateContext,
): Promise<{ stream: NodeJS.ReadableStream; filename: string; mimeType: string }> {
  await getCandidateById(id, ctx);
  const candDoc = await Candidate.findById(toId(id)).select('resumeFile').lean().exec();

  if (!candDoc?.resumeFile?.serverFilename) {
    throw notFound('Candidate resume');
  }

  const stream = readResumeFileStream(candDoc.resumeFile.serverFilename);
  return {
    stream,
    filename: candDoc.resumeFile.originalName,
    mimeType: candDoc.resumeFile.mimeType,
  };
}

export async function deleteCandidate(id: string, ctx: CandidateContext): Promise<void> {
  const candidateId = toId(id);
  const existing = await Candidate.findOne({ _id: candidateId, isDeleted: false }).exec();
  if (!existing) throw notFound('Candidate');

  if (existing.convertedEmployeeId) {
    throw unprocessable('Cannot delete a candidate who has already been converted to an employee');
  }

  existing.isDeleted = true;
  await existing.save();

  if (existing.resumeFile?.serverFilename) {
    deleteResumeFile(existing.resumeFile.serverFilename);
  }

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'candidate.deleted',
    entityType: 'Candidate',
    entityId: candidateId,
    before: { candidateCode: existing.candidateCode, name: existing.name },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();
}
