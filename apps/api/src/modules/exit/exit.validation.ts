import { z } from 'zod';
import { isDateOnlyString } from '../../utils/dates';
import {
  CHECKLIST_STATUSES,
  EXIT_STAGES,
  FINAL_SETTLEMENT_STATUSES,
} from './exit.schema';

const dateOnly = z
  .string()
  .refine(isDateOnlyString, { message: 'Must be a valid YYYY-MM-DD date' });

export const createExitSchema = z.object({
  resignationDate: dateOnly.optional(),
  noticePeriodDays: z.number().int().min(0).max(365).optional().default(30),
  lastWorkingDay: dateOnly.optional(),
  reason: z.string().trim().min(1, 'Reason is required').max(200),
  reasonNote: z.string().trim().max(1000).optional().nullable(),
});

export type CreateExitBody = z.infer<typeof createExitSchema>;

export const updateChecklistItemSchema = z.object({
  status: z.enum(CHECKLIST_STATUSES),
  notes: z.string().trim().max(500).optional().nullable(),
});

export type UpdateChecklistItemBody = z.infer<typeof updateChecklistItemSchema>;

export const provideClearanceSchema = z.object({
  department: z.enum(['manager', 'hr', 'finance']),
  status: z.enum(['Approved', 'Rejected']),
  comments: z.string().trim().max(500).optional().nullable(),
});

export type ProvideClearanceBody = z.infer<typeof provideClearanceSchema>;

export const updateSettlementSchema = z.object({
  status: z.enum(FINAL_SETTLEMENT_STATUSES),
  notes: z.string().trim().max(500).optional().nullable(),
});

export type UpdateSettlementBody = z.infer<typeof updateSettlementSchema>;

export const relieveEmployeeSchema = z.object({
  force: z.boolean().optional().default(false),
  forceReason: z.string().trim().max(500).optional().nullable(),
});

export type RelieveEmployeeBody = z.infer<typeof relieveEmployeeSchema>;

export const listExitsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  stage: z.enum(EXIT_STAGES).optional(),
  q: z.string().trim().optional(),
  departmentId: z.string().trim().optional(),
  sort: z.string().trim().optional(),
});

export type ListExitsQuery = z.infer<typeof listExitsSchema>;
