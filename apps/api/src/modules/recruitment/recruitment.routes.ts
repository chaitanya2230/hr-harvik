import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { asyncHandler } from '../../utils/http';
import {
  createCandidateHandler,
  createJobHandler,
  deleteCandidateHandler,
  deleteJobHandler,
  downloadCandidateResumeHandler,
  getCandidateHandler,
  getJobHandler,
  handleResumeMulterError,
  listCandidatesHandler,
  listJobsHandler,
  resumeUploadMiddleware,
  scheduleInterviewHandler,
  submitInterviewFeedbackHandler,
  updateCandidateHandler,
  updateCandidateStageHandler,
  updateJobHandler,
  updateOfferHandler,
  uploadCandidateResumeHandler,
  convertCandidateHandler,
} from './recruitment.controller';

export const recruitmentRouter = Router();

recruitmentRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
recruitmentRouter.post(
  '/jobs',
  requirePermission('manageJobs'),
  asyncHandler(createJobHandler),
);

recruitmentRouter.get(
  '/jobs',
  requirePermission('viewRecruitment'),
  asyncHandler(listJobsHandler),
);

recruitmentRouter.get(
  '/jobs/:id',
  requirePermission('viewRecruitment'),
  asyncHandler(getJobHandler),
);

recruitmentRouter.patch(
  '/jobs/:id',
  requirePermission('manageJobs'),
  asyncHandler(updateJobHandler),
);

recruitmentRouter.delete(
  '/jobs/:id',
  requirePermission('deleteJob'),
  asyncHandler(deleteJobHandler),
);

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------
recruitmentRouter.post(
  '/candidates',
  requirePermission('manageCandidates'),
  asyncHandler(createCandidateHandler),
);

recruitmentRouter.get(
  '/candidates',
  requirePermission('viewRecruitment'),
  asyncHandler(listCandidatesHandler),
);

recruitmentRouter.get(
  '/candidates/:id',
  requirePermission('viewRecruitment'),
  asyncHandler(getCandidateHandler),
);

recruitmentRouter.patch(
  '/candidates/:id',
  requirePermission('manageCandidates'),
  asyncHandler(updateCandidateHandler),
);

recruitmentRouter.post(
  '/candidates/:id/stage',
  requirePermission('manageCandidates'),
  asyncHandler(updateCandidateStageHandler),
);

recruitmentRouter.post(
  '/candidates/:id/interviews',
  requirePermission('manageCandidates'),
  asyncHandler(scheduleInterviewHandler),
);

recruitmentRouter.post(
  '/candidates/:id/interviews/:round/feedback',
  requirePermission('addInterviewFeedback'),
  asyncHandler(submitInterviewFeedbackHandler),
);

recruitmentRouter.patch(
  '/candidates/:id/offer',
  requirePermission('manageCandidates'),
  asyncHandler(updateOfferHandler),
);

recruitmentRouter.post(
  '/candidates/:id/resume',
  requirePermission('manageCandidates'),
  resumeUploadMiddleware,
  handleResumeMulterError,
  asyncHandler(uploadCandidateResumeHandler),
);

recruitmentRouter.get(
  '/candidates/:id/resume',
  requirePermission('viewRecruitment'),
  asyncHandler(downloadCandidateResumeHandler),
);

recruitmentRouter.post(
  '/candidates/:id/convert',
  requirePermission('manageCandidates'),
  asyncHandler(convertCandidateHandler),
);

recruitmentRouter.delete(
  '/candidates/:id',
  requirePermission('deleteCandidate'),
  asyncHandler(deleteCandidateHandler),
);
