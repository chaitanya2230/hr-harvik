import { z } from 'zod';
import { LICENSE_STATUSES, MAX_PAGE_LIMIT } from '../../config/constants';
import { isDateOnlyString } from '../../utils/dates';
import { objectIdSchema } from '../employees/employee.validation';

/**
 * AGENTS.md §11 — Zod validation for every license route.
 *
 * `licenseType` stays an open string (D-28). The plaintext `licenseKey` is
 * input-only: the service encrypts it into `licenseKeyRef`, which no schema
 * here accepts (§7, §8.9). `usedSeats` / `status` move only through
 * assign / revoke / renew / suspend / expire.
 */

const dateOnly = z
  .string()
  .trim()
  .refine(isDateOnlyString, 'Must be a YYYY-MM-DD date');

export const licenseStatusSchema = z.enum(LICENSE_STATUSES);

export const createLicenseSchema = z
  .object({
    softwareName: z
      .string({ required_error: 'Software name is required' })
      .trim()
      .min(1)
      .max(120),
    licenseType: z
      .string({ required_error: 'License type is required' })
      .trim()
      .min(1)
      .max(60),
    licenseKey: z.string().trim().min(1).max(2000).optional(),
    provider: z.string().trim().max(120).optional(),
    cost: z.coerce
      .number({ invalid_type_error: 'Cost must be a number' })
      .min(0, 'Cost cannot be negative')
      .optional(),
    currency: z.string().trim().toUpperCase().max(8).optional(),
    billingCycle: z.string().trim().max(40).optional(),
    startDate: dateOnly.optional(),
    renewalDate: dateOnly.optional(),
    maxSeats: z.coerce
      .number({ required_error: 'Maximum seats is required', invalid_type_error: 'Maximum seats must be a number' })
      .int('Maximum seats must be a whole number')
      .min(1, 'Maximum seats must be at least 1'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startDate && value.renewalDate && value.renewalDate <= value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['renewalDate'],
        message: 'Renewal date must be after the start date',
      });
    }
  });

export const updateLicenseSchema = z
  .object({
    softwareName: z.string().trim().min(1).max(120).optional(),
    licenseType: z.string().trim().min(1).max(60).optional(),
    licenseKey: z.string().trim().min(1).max(2000).nullish(),
    provider: z.string().trim().max(120).nullish(),
    cost: z.coerce
      .number({ invalid_type_error: 'Cost must be a number' })
      .min(0, 'Cost cannot be negative')
      .nullish(),
    currency: z.string().trim().toUpperCase().max(8).nullish(),
    billingCycle: z.string().trim().max(40).nullish(),
    startDate: dateOnly.optional(),
    maxSeats: z.coerce
      .number({ invalid_type_error: 'Maximum seats must be a number' })
      .int('Maximum seats must be a whole number')
      .min(1, 'Maximum seats must be at least 1')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startDate && !isDateOnlyString(value.startDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: 'Must be a YYYY-MM-DD date',
      });
    }
  });

export const assignLicenseSchema = z
  .object({
    employeeId: objectIdSchema,
    accountIdentifier: z.string().trim().max(200).optional(),
  })
  .strict();

export const revokeLicenseAssignmentSchema = z
  .object({
    revocationNote: z.string().trim().max(500).optional(),
  })
  .strict();

/** §8.9 renew: a future renewal date; recalculates Expired → Available (D-30). */
export const renewLicenseSchema = z
  .object({
    renewalDate: dateOnly,
  })
  .strict();

export const suspendLicenseSchema = z
  .object({
    suspend: z.boolean({ required_error: '`suspend` must be true or false' }),
  })
  .strict();

export const LICENSE_SORT_FIELDS = [
  'licenseCode',
  'softwareName',
  'licenseType',
  'provider',
  'status',
  'maxSeats',
  'usedSeats',
  'renewalDate',
  'createdAt',
  'updatedAt',
] as const;

export const listLicensesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
    q: z.string().trim().max(120).optional(),
    sort: z.string().trim().max(40).optional(),
    licenseType: z.string().trim().max(60).optional(),
    status: licenseStatusSchema.optional(),
    provider: z.string().trim().max(120).optional(),
  })
  .strict();

export const listLicenseAssignmentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
    sort: z.string().trim().max(40).optional(),
    licenseId: objectIdSchema.optional(),
    employeeId: objectIdSchema.optional(),
    status: z.enum(['Assigned', 'Revoked']).optional(),
  })
  .strict();

export const licenseParamsSchema = z.object({ id: objectIdSchema }).strict();
export const licenseAssignmentParamsSchema = z
  .object({ assignmentId: objectIdSchema })
  .strict();

export type CreateLicenseBody = z.infer<typeof createLicenseSchema>;
export type UpdateLicenseBody = z.infer<typeof updateLicenseSchema>;
export type AssignLicenseBody = z.infer<typeof assignLicenseSchema>;
export type RevokeLicenseAssignmentBody = z.infer<typeof revokeLicenseAssignmentSchema>;
export type RenewLicenseBody = z.infer<typeof renewLicenseSchema>;
export type SuspendLicenseBody = z.infer<typeof suspendLicenseSchema>;
export type ListLicensesQuery = z.infer<typeof listLicensesQuerySchema>;
export type ListLicenseAssignmentsQuery = z.infer<typeof listLicenseAssignmentsQuerySchema>;
