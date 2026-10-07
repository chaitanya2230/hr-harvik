import { z } from 'zod';
import { EMPLOYMENT_TYPES } from '../../config/constants';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const createLeaveTypeSchema = z.object({
  name: z.string().min(1, 'Name is required').trim(),
  code: z.string().min(1, 'Code is required').trim().toUpperCase(),
  annualAllocation: z.number().min(0, 'Annual allocation must be non-negative'),
  carryForward: z.boolean().default(false),
  maxCarryForward: z.number().min(0).default(0),
  isPaid: z.boolean().default(true),
  requiresDocument: z.boolean().default(false),
  applicableEmploymentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).default([...EMPLOYMENT_TYPES]),
  isActive: z.boolean().default(true),
});

export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;

export const updateLeaveTypeSchema = createLeaveTypeSchema.partial();
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;

export const applyLeaveSchema = z
  .object({
    employeeId: z.string().optional(),
    leaveTypeId: z.string().min(1, 'Leave type is required'),
    fromDate: z.string().regex(DATE_REGEX, 'fromDate must be in YYYY-MM-DD format'),
    toDate: z.string().regex(DATE_REGEX, 'toDate must be in YYYY-MM-DD format'),
    halfDay: z.boolean().default(false),
    reason: z.string().min(1, 'Reason is required').trim(),
    documentId: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.fromDate > data.toDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toDate'],
        message: 'toDate cannot be before fromDate',
      });
    }
    if (data.halfDay && data.fromDate !== data.toDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['halfDay'],
        message: 'Multi-day half-day leave is not allowed',
      });
    }
  });

export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;

export const reviewLeaveSchema = z
  .object({
    status: z.enum(['Approved', 'Rejected']),
    decisionNote: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'Rejected' && (!data.decisionNote || !data.decisionNote.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisionNote'],
        message: 'Decision note is required when rejecting a leave request',
      });
    }
  });

export type ReviewLeaveInput = z.infer<typeof reviewLeaveSchema>;

/** Multipart metadata for `POST /leave/documents` (the file itself is multer). */
export const uploadLeaveDocumentSchema = z.object({
  employeeId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character id')
    .optional(),
  title: z.string().trim().max(200, 'Title must be at most 200 characters').optional(),
});

export type UploadLeaveDocumentBody = z.infer<typeof uploadLeaveDocumentSchema>;
