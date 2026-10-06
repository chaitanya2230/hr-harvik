import { z } from 'zod';
import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  MAX_PAGE_LIMIT,
  STATUS_TRANSITIONS,
  type EmployeeStatus,
} from '../../config/constants';
import { emailSchema } from '../auth/auth.schema';
import { isDateOnlyString } from '../../utils/dates';

/**
 * AGENTS.md §11 — Zod validation for every employee route.
 *
 * Naming: `employee.schema.ts` is already the Mongoose schema (P0 baseline), so
 * the request-validation schemas live here. See docs/DECISIONS.md D-22.
 */

/** 24-char hex ObjectId. Guarded here so a bad id is a 400, never a CastError. */
export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character id');

const dateOnly = z
  .string()
  .trim()
  .refine(isDateOnlyString, 'Must be a YYYY-MM-DD date');

/**
 * AGENTS.md §8.2 — phone validation.
 *
 * Deliberately permissive about the punctuation real users type (`+91 98000
 * 10001`) while still requiring it to be plausibly a phone number: a leading
 * `+`, digit, or `(`, then 5-30 further characters drawn from digits and
 * `+ - ( ) space`.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(6, 'Phone must be at least 6 characters')
  .max(32, 'Phone must be at most 32 characters')
  .regex(
    /^\+?[\d(][\d\s()+.-]{4,}$/,
    'Enter a valid phone number, for example +91 98000 10001',
  );

const addressSchema = z
  .object({
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().max(120).optional(),
    state: z.string().trim().max(120).optional(),
    postalCode: z.string().trim().max(20).optional(),
    country: z.string().trim().max(120).optional(),
  })
  .strict();

const emergencyContactSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    relation: z.string().trim().max(60).optional(),
    phone: phoneSchema.optional(),
  })
  .strict();

const compensationSchema = z
  .object({
    amount: z.coerce
      .number({ invalid_type_error: 'Compensation amount must be a number' })
      .min(0, 'Compensation amount cannot be negative')
      .optional(),
    currency: z.string().trim().toUpperCase().max(8).optional(),
    period: z.enum(['monthly', 'hourly', 'fixed']).optional(),
  })
  .strict();

/**
 * AGENTS.md §7 / §11 — bank details are encrypted at rest.
 *
 * The client sends a plaintext `accountNumber`, which the service encrypts into
 * `accountNumberEnc`. The ciphertext field is deliberately absent here and the
 * object is `strict()`, so a caller cannot inject ciphertext (or any future
 * unknown field) directly into the document.
 */
const bankDetailsInputSchema = z
  .object({
    accountHolder: z.string().trim().max(120).optional(),
    accountNumber: z.string().trim().min(4, 'Account number is required').max(64).optional(),
    ifscOrRouting: z.string().trim().max(64).optional(),
    bankName: z.string().trim().max(120).optional(),
  })
  .strict();

export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);
export const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES);

/**
 * Optional login created together with the employee (§8.2 — "Creating employee
 * can optionally create login").
 *
 * The role is bounded to what P1 supports. `HR Admin` may create any role;
 * anyone else may only create `Employee` or `Manager` logins, so an HR Manager
 * cannot mint an administrator.
 */
const loginSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128)
      .regex(/[0-9]/, 'Password must contain at least one number')
      .regex(/[A-Za-z]/, 'Password must contain at least one letter'),
    role: z.enum(['HR Admin', 'HR Manager', 'Manager', 'Employee']).default('Employee'),
  })
  .strict();

export const createEmployeeSchema = z
  .object({
    firstName: z.string({ required_error: 'First name is required' }).trim().min(1, 'First name is required').max(80),
    lastName: z.string({ required_error: 'Last name is required' }).trim().min(1, 'Last name is required').max(80),
    email: emailSchema,
    phone: phoneSchema.optional(),
    dob: dateOnly.optional(),
    address: addressSchema.optional(),
    emergencyContact: emergencyContactSchema.optional(),
    designation: z.string().trim().max(120).optional(),
    departmentId: objectIdSchema.nullish(),
    reportingManagerId: objectIdSchema.nullish(),
    employmentType: employmentTypeSchema,
    dateOfJoining: dateOnly,
    probationEndDate: dateOnly.nullish(),
    photoUrl: z.string().trim().url('Photo must be a valid URL').max(500).nullish(),
    compensation: compensationSchema.optional(),
    bankDetails: bankDetailsInputSchema.optional(),
    /** Omitted means "use the documented default" (see employee.service). */
    status: employeeStatusSchema.optional(),
    createLogin: loginSchema.optional(),
  })
  .strict();

export const updateEmployeeSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(80).optional(),
    lastName: z.string().trim().min(1, 'Last name is required').max(80).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.nullish(),
    dob: dateOnly.nullish(),
    address: addressSchema.optional(),
    emergencyContact: emergencyContactSchema.optional(),
    designation: z.string().trim().max(120).nullish(),
    departmentId: objectIdSchema.nullish(),
    reportingManagerId: objectIdSchema.nullish(),
    employmentType: employmentTypeSchema.optional(),
    dateOfJoining: dateOnly.optional(),
    probationEndDate: dateOnly.nullish(),
    photoUrl: z.string().trim().url('Photo must be a valid URL').max(500).nullish(),
    compensation: compensationSchema.optional(),
    bankDetails: bankDetailsInputSchema.optional(),
  })
  .strict();

/**
 * AGENTS.md §8.2 — a status change may only move along an allowed edge of
 * `STATUS_TRANSITIONS`. Re-checking the edge here means an invalid target is a
 * 400 at the edge of the system rather than a 422 discovered deep in the service.
 */
export const changeStatusSchema = z
  .object({
    status: employeeStatusSchema,
    note: z.string().trim().max(500).optional(),
    lastWorkingDay: dateOnly.optional(),
    /** §8.2 — HR Admin re-hire of a Relieved employee. */
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'Relieved' && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'A reason is required when relieving an employee',
      });
    }
  });

/** Fields `?sort=` may reference. Anything else is a 400 (see `buildSort`). */
export const EMPLOYEE_SORT_FIELDS = [
  'employeeCode',
  'firstName',
  'lastName',
  'email',
  'designation',
  'employmentType',
  'status',
  'dateOfJoining',
  'createdAt',
  'updatedAt',
] as const;

/** AGENTS.md §8.2 search + filters. */
export const listEmployeesQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int()
      .min(1, '`page` must be an integer greater than or equal to 1')
      .optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1, '`limit` must be an integer greater than or equal to 1')
      .max(MAX_PAGE_LIMIT, `\`limit\` must not exceed ${MAX_PAGE_LIMIT}`)
      .optional(),
    q: z.string().trim().max(120).optional(),
    sort: z.string().trim().max(40).optional(),
    departmentId: objectIdSchema.optional(),
    employmentType: employmentTypeSchema.optional(),
    status: employeeStatusSchema.optional(),
    reportingManagerId: objectIdSchema.optional(),
    joinedFrom: dateOnly.optional(),
    joinedTo: dateOnly.optional(),
    /** Include soft-deleted employees (§8.2 DELETE is a soft delete). HR only. */
    includeDeleted: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.joinedFrom && value.joinedTo && value.joinedFrom > value.joinedTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['joinedTo'],
        message: '`joinedTo` must not be earlier than `joinedFrom`',
      });
    }
  });

export const employeeParamsSchema = z.object({ id: objectIdSchema }).strict();

export type CreateEmployeeBody = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeBody = z.infer<typeof updateEmployeeSchema>;
export type ChangeStatusBody = z.infer<typeof changeStatusSchema>;
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;

/**
 * Re-exported so the service and the tests share one definition of "can this
 * edge be walked", rather than a second hard-coded copy in each.
 */
export function isAllowedTransition(from: EmployeeStatus, to: EmployeeStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}
