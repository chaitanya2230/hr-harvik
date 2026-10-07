import { z } from 'zod';
import { CHECKLIST_ITEM_STATUSES, ONBOARDING_STATUSES } from '../../config/constants';

const objectIdString = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid 24-character hexadecimal ObjectId');

export const listOnboardingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(ONBOARDING_STATUSES).optional(),
  departmentId: objectIdString.optional(),
  q: z.string().trim().optional(),
  sort: z.string().trim().optional(),
});

export type ListOnboardingsQuery = z.infer<typeof listOnboardingsQuerySchema>;

export const updateChecklistItemSchema = z
  .object({
    status: z.enum(CHECKLIST_ITEM_STATUSES),
    notes: z.string().trim().max(500).optional().nullable(),
    naReason: z.string().trim().max(500).optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.status === 'NA' && !data.naReason) {
        return false;
      }
      return true;
    },
    { message: 'naReason is required when marking an item NA', path: ['naReason'] },
  );

export type UpdateChecklistItemBody = z.infer<typeof updateChecklistItemSchema>;

export const reopenOnboardingSchema = z.object({
  reason: z.string().trim().min(5, 'Reopen reason must be at least 5 characters').max(500),
});

export type ReopenOnboardingBody = z.infer<typeof reopenOnboardingSchema>;
