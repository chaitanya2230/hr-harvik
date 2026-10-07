import { z } from 'zod';
import {
  CANDIDATE_SOURCES,
  CANDIDATE_STAGES,
  EMPLOYMENT_TYPES,
  JOB_STATUSES,
  OFFER_STATUSES,
  ROLES,
} from '../../config/constants';
import { isDateOnlyString } from '../../utils/dates';

const dateOnly = z
  .string()
  .refine(isDateOnlyString, { message: 'Must be a valid YYYY-MM-DD date' });

const objectIdString = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid 24-character hexadecimal ObjectId');

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const createJobSchema = z
  .object({
    title: z.string().trim().min(2, 'Job title must be at least 2 characters').max(150),
    departmentId: objectIdString,
    openings: z.coerce.number().int().min(1, 'Openings must be at least 1').max(500),
    description: z.string().trim().min(10, 'Description must be at least 10 characters'),
    requiredSkills: z
      .array(z.string().trim().min(1))
      .optional()
      .default([]),
    hiringManagerId: objectIdString,
    openingDate: dateOnly,
    closingDate: dateOnly.optional().nullable(),
    status: z.enum(JOB_STATUSES).optional().default('Open'),
  })
  .refine(
    (data) => {
      if (data.closingDate && data.openingDate) {
        return data.closingDate >= data.openingDate;
      }
      return true;
    },
    { message: 'closingDate cannot be earlier than openingDate', path: ['closingDate'] },
  );

export type CreateJobBody = z.infer<typeof createJobSchema>;

export const updateJobSchema = z
  .object({
    title: z.string().trim().min(2).max(150).optional(),
    departmentId: objectIdString.optional(),
    openings: z.coerce.number().int().min(1).max(500).optional(),
    description: z.string().trim().min(10).optional(),
    requiredSkills: z.array(z.string().trim().min(1)).optional(),
    hiringManagerId: objectIdString.optional(),
    openingDate: dateOnly.optional(),
    closingDate: dateOnly.optional().nullable(),
    status: z.enum(JOB_STATUSES).optional(),
  })
  .refine(
    (data) => {
      if (data.closingDate && data.openingDate) {
        return data.closingDate >= data.openingDate;
      }
      return true;
    },
    { message: 'closingDate cannot be earlier than openingDate', path: ['closingDate'] },
  );

export type UpdateJobBody = z.infer<typeof updateJobSchema>;

export const listJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  departmentId: objectIdString.optional(),
  status: z.enum(JOB_STATUSES).optional(),
  hiringManagerId: objectIdString.optional(),
  q: z.string().trim().optional(),
  sort: z.string().trim().optional(),
});

export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export const createCandidateSchema = z.object({
  name: z.string().trim().min(2, 'Candidate name must be at least 2 characters').max(100),
  email: z.string().trim().email('Must be a valid email address').toLowerCase(),
  phone: z.string().trim().min(7, 'Phone number must be at least 7 characters').max(20),
  jobId: objectIdString,
  source: z.enum(CANDIDATE_SOURCES),
  joiningDate: dateOnly.optional().nullable(),
});

export type CreateCandidateBody = z.infer<typeof createCandidateSchema>;

export const updateCandidateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  phone: z.string().trim().min(7).max(20).optional(),
  source: z.enum(CANDIDATE_SOURCES).optional(),
  joiningDate: dateOnly.optional().nullable(),
});

export type UpdateCandidateBody = z.infer<typeof updateCandidateSchema>;

export const listCandidatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  jobId: objectIdString.optional(),
  stage: z.enum(CANDIDATE_STAGES).optional(),
  source: z.enum(CANDIDATE_SOURCES).optional(),
  q: z.string().trim().optional(),
  sort: z.string().trim().optional(),
});

export type ListCandidatesQuery = z.infer<typeof listCandidatesQuerySchema>;

export const updateCandidateStageSchema = z
  .object({
    stage: z.enum(CANDIDATE_STAGES),
    note: z.string().trim().max(500).optional().nullable(),
    rejectionReason: z.string().trim().max(500).optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.stage === 'Rejected' && !data.rejectionReason) {
        return false;
      }
      return true;
    },
    { message: 'rejectionReason is required when moving to Rejected stage', path: ['rejectionReason'] },
  );

export type UpdateCandidateStageBody = z.infer<typeof updateCandidateStageSchema>;

export const scheduleInterviewSchema = z.object({
  round: z.coerce.number().int().min(1),
  title: z.string().trim().min(2).max(100),
  interviewerId: objectIdString,
  scheduledAt: z.string().datetime(),
});

export type ScheduleInterviewBody = z.infer<typeof scheduleInterviewSchema>;

export const interviewFeedbackSchema = z.object({
  feedback: z.string().trim().min(5, 'Feedback must be at least 5 characters').max(2000),
  rating: z.coerce.number().int().min(1).max(5),
  status: z.enum(['Completed', 'Cancelled']).default('Completed'),
});

export type InterviewFeedbackBody = z.infer<typeof interviewFeedbackSchema>;

export const updateOfferSchema = z
  .object({
    offerStatus: z.enum(OFFER_STATUSES),
    joiningDate: dateOnly.optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.offerStatus === 'Accepted' && !data.joiningDate) {
        return false;
      }
      return true;
    },
    { message: 'joiningDate is required when offer is Accepted', path: ['joiningDate'] },
  );

export type UpdateOfferBody = z.infer<typeof updateOfferSchema>;

export const convertCandidateSchema = z.object({
  employmentType: z.enum(EMPLOYMENT_TYPES),
  designation: z.string().trim().min(2).max(100),
  departmentId: objectIdString.optional(),
  reportingManagerId: objectIdString.optional().nullable(),
  dateOfJoining: dateOnly,
  compensation: z
    .object({
      amount: z.coerce.number().min(0),
      currency: z.string().trim().default('USD'),
      period: z.enum(['monthly', 'hourly', 'fixed']).default('monthly'),
    })
    .optional(),
  createLogin: z
    .object({
      email: z.string().trim().email().toLowerCase(),
      password: z.string().min(8),
      role: z.enum(ROLES).default('Employee'),
    })
    .optional(),
});

export type ConvertCandidateBody = z.infer<typeof convertCandidateSchema>;
