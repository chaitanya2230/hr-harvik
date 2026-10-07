import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../../config/env';
import { badRequest, unprocessable } from '../../utils/errors';
import * as jobService from './job.service';
import * as candidateService from './candidate.service';
import * as conversionService from './candidate-conversion.service';
import {
  createCandidateSchema,
  createJobSchema,
  interviewFeedbackSchema,
  listCandidatesQuerySchema,
  listJobsQuerySchema,
  scheduleInterviewSchema,
  updateCandidateSchema,
  updateCandidateStageSchema,
  updateJobSchema,
  updateOfferSchema,
  convertCandidateSchema,
} from './recruitment.validation';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
  },
});

export const resumeUploadMiddleware = upload.single('resume');

export function handleResumeMulterError(
  err: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(
        unprocessable(`File size exceeds maximum allowed limit of ${env.MAX_UPLOAD_MB} MB`),
      );
    }
    return next(badRequest(`Upload error: ${err.message}`));
  }
  next(err);
}

function idParam(req: Request): string {
  return (req.params.id as string) ?? '';
}

function getContext(req: Request) {
  return {
    account: req.user!,
    ip: req.ip ?? undefined,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function createJobHandler(req: Request, res: Response): Promise<void> {
  const body = createJobSchema.parse(req.body);
  const result = await jobService.createJob(body, getContext(req));
  res.status(201).json({ data: result });
}

export async function listJobsHandler(req: Request, res: Response): Promise<void> {
  const query = listJobsQuerySchema.parse(req.query);
  const result = await jobService.listJobs(query, getContext(req));
  res.status(200).json(result);
}

export async function getJobHandler(req: Request, res: Response): Promise<void> {
  const result = await jobService.getJobById(idParam(req), getContext(req));
  res.status(200).json({ data: result });
}

export async function updateJobHandler(req: Request, res: Response): Promise<void> {
  const body = updateJobSchema.parse(req.body);
  const result = await jobService.updateJob(idParam(req), body, getContext(req));
  res.status(200).json({ data: result });
}

export async function deleteJobHandler(req: Request, res: Response): Promise<void> {
  await jobService.deleteJob(idParam(req), getContext(req));
  res.status(204).end();
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export async function createCandidateHandler(req: Request, res: Response): Promise<void> {
  const body = createCandidateSchema.parse(req.body);
  const result = await candidateService.createCandidate(body, getContext(req));
  res.status(201).json({ data: result });
}

export async function listCandidatesHandler(req: Request, res: Response): Promise<void> {
  const query = listCandidatesQuerySchema.parse(req.query);
  const result = await candidateService.listCandidates(query, getContext(req));
  res.status(200).json(result);
}

export async function getCandidateHandler(req: Request, res: Response): Promise<void> {
  const result = await candidateService.getCandidateById(idParam(req), getContext(req));
  res.status(200).json({ data: result });
}

export async function updateCandidateHandler(req: Request, res: Response): Promise<void> {
  const body = updateCandidateSchema.parse(req.body);
  const result = await candidateService.updateCandidate(idParam(req), body, getContext(req));
  res.status(200).json({ data: result });
}

export async function updateCandidateStageHandler(req: Request, res: Response): Promise<void> {
  const body = updateCandidateStageSchema.parse(req.body);
  const result = await candidateService.updateCandidateStage(idParam(req), body, getContext(req));
  res.status(200).json({ data: result });
}

export async function scheduleInterviewHandler(req: Request, res: Response): Promise<void> {
  const body = scheduleInterviewSchema.parse(req.body);
  const result = await candidateService.scheduleInterview(idParam(req), body, getContext(req));
  res.status(201).json({ data: result });
}

export async function submitInterviewFeedbackHandler(req: Request, res: Response): Promise<void> {
  const round = parseInt(req.params.round as string, 10);
  const body = interviewFeedbackSchema.parse(req.body);
  const result = await candidateService.submitInterviewFeedback(idParam(req), round, body, getContext(req));
  res.status(200).json({ data: result });
}

export async function updateOfferHandler(req: Request, res: Response): Promise<void> {
  const body = updateOfferSchema.parse(req.body);
  const result = await candidateService.updateOfferStatus(idParam(req), body, getContext(req));
  res.status(200).json({ data: result });
}

export async function uploadCandidateResumeHandler(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw badRequest('No resume file uploaded');
  }
  const result = await candidateService.uploadCandidateResume(
    idParam(req),
    {
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    },
    getContext(req),
  );
  res.status(200).json({ data: result });
}

export async function downloadCandidateResumeHandler(req: Request, res: Response): Promise<void> {
  const { stream, filename, mimeType } = await candidateService.getCandidateResumeStream(
    idParam(req),
    getContext(req),
  );

  const safeFilename = filename.replace(/["\r\n]/g, '_');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  stream.pipe(res);
}

export async function convertCandidateHandler(req: Request, res: Response): Promise<void> {
  const body = convertCandidateSchema.parse(req.body);
  const result = await conversionService.convertCandidateToEmployee(idParam(req), body, getContext(req));
  res.status(200).json({ data: result });
}

export async function deleteCandidateHandler(req: Request, res: Response): Promise<void> {
  await candidateService.deleteCandidate(idParam(req), getContext(req));
  res.status(204).end();
}
