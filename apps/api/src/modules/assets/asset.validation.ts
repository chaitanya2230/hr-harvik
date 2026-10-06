import { z } from 'zod';
import { ASSET_STATUSES, MAX_PAGE_LIMIT } from '../../config/constants';
import { isDateOnlyString } from '../../utils/dates';
import { objectIdSchema } from '../employees/employee.validation';

/**
 * AGENTS.md §11 — Zod validation for every asset route.
 *
 * `type` stays an open string (D-28); `status` is never accepted from the
 * client — it moves only through assign / return / repair / retire.
 */

const dateOnly = z
  .string()
  .trim()
  .refine(isDateOnlyString, 'Must be a YYYY-MM-DD date');

export const assetStatusSchema = z.enum(ASSET_STATUSES);

export const createAssetSchema = z
  .object({
    name: z.string({ required_error: 'Asset name is required' }).trim().min(1).max(120),
    type: z.string({ required_error: 'Asset type is required' }).trim().min(1).max(60),
    brand: z.string().trim().max(120).optional(),
    model: z.string().trim().max(120).optional(),
    serialNumber: z
      .string({ required_error: 'Serial number is required' })
      .trim()
      .min(1)
      .max(120),
    purchaseDate: dateOnly.optional(),
    purchaseCost: z.coerce
      .number({ invalid_type_error: 'Purchase cost must be a number' })
      .min(0, 'Purchase cost cannot be negative')
      .optional(),
    condition: z.string().trim().max(60).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const updateAssetSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    type: z.string().trim().min(1).max(60).optional(),
    brand: z.string().trim().max(120).nullish(),
    model: z.string().trim().max(120).nullish(),
    serialNumber: z.string().trim().min(1).max(120).optional(),
    purchaseDate: dateOnly.nullish(),
    purchaseCost: z.coerce
      .number({ invalid_type_error: 'Purchase cost must be a number' })
      .min(0, 'Purchase cost cannot be negative')
      .nullish(),
    condition: z.string().trim().max(60).nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .strict();

export const assignAssetSchema = z
  .object({
    employeeId: objectIdSchema,
    expectedReturnDate: dateOnly.optional(),
    conditionAtAssign: z.string().trim().max(60).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const returnAssetSchema = z
  .object({
    conditionAtReturn: z.string().trim().max(60).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

/**
 * §8.8 repair walks an asset to Under Repair / back to Available, or records
 * it Lost / Damaged (D-29). Retired is terminal and only reachable via retire.
 */
export const repairAssetSchema = z
  .object({
    status: z.enum(['Available', 'Under Repair', 'Lost', 'Damaged']),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const retireAssetSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const ASSET_SORT_FIELDS = [
  'assetCode',
  'name',
  'type',
  'status',
  'purchaseDate',
  'purchaseCost',
  'createdAt',
  'updatedAt',
] as const;

export const listAssetsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
    q: z.string().trim().max(120).optional(),
    sort: z.string().trim().max(40).optional(),
    type: z.string().trim().max(60).optional(),
    status: assetStatusSchema.optional(),
    overdue: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();

export const ASSIGNMENT_SORT_FIELDS = ['assignedAt', 'expectedReturnDate', 'createdAt'] as const;

export const listAssetAssignmentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
    sort: z.string().trim().max(40).optional(),
    assetId: objectIdSchema.optional(),
    employeeId: objectIdSchema.optional(),
    active: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    overdue: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
  })
  .strict();

export const assetParamsSchema = z.object({ id: objectIdSchema }).strict();

export type CreateAssetBody = z.infer<typeof createAssetSchema>;
export type UpdateAssetBody = z.infer<typeof updateAssetSchema>;
export type AssignAssetBody = z.infer<typeof assignAssetSchema>;
export type ReturnAssetBody = z.infer<typeof returnAssetSchema>;
export type RepairAssetBody = z.infer<typeof repairAssetSchema>;
export type RetireAssetBody = z.infer<typeof retireAssetSchema>;
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;
export type ListAssetAssignmentsQuery = z.infer<typeof listAssetAssignmentsQuerySchema>;
