import { z } from 'zod';
import { MAX_PAGE_LIMIT } from '../../config/constants';
import { objectIdSchema } from '../employees/employee.validation';

/**
 * AGENTS.md §11 — Zod validation for every access-item route.
 *
 * §7 fields exactly: employeeId / system / identifier / status /
 * revokedAt / revokedBy / linkedLicenseAssignmentId. Status moves only through
 * revoke; there is no revocation note field on access items.
 */

export const createAccessItemSchema = z
  .object({
    employeeId: objectIdSchema,
    system: z
      .string({ required_error: 'System name is required' })
      .trim()
      .min(1)
      .max(120),
    identifier: z.string().trim().max(200).optional(),
    linkedLicenseAssignmentId: objectIdSchema.optional(),
  })
  .strict();

export const listAccessItemsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
    sort: z.string().trim().max(40).optional(),
    employeeId: objectIdSchema.optional(),
    system: z.string().trim().max(120).optional(),
    status: z.enum(['Active', 'Revoked']).optional(),
  })
  .strict();

export const ACCESS_SORT_FIELDS = ['system', 'status', 'createdAt', 'updatedAt'] as const;

export const accessParamsSchema = z.object({ id: objectIdSchema }).strict();

export type CreateAccessItemBody = z.infer<typeof createAccessItemSchema>;
export type ListAccessItemsQuery = z.infer<typeof listAccessItemsQuerySchema>;
