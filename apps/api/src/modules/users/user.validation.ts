import { z } from 'zod';
import { ROLES, MAX_PAGE_LIMIT } from '../../config/constants';
import { emailSchema, passwordSchema } from '../auth/auth.schema';
import { objectIdSchema } from '../employees/employee.validation';

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  sort: z.string().max(40).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(ROLES).default('Employee'),
  employeeId: objectIdSchema.nullish(),
});

export type CreateUserBody = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => body.role !== undefined || body.isActive !== undefined, {
    message: 'Provide `role` and/or `isActive` to update',
  });

export type UpdateUserBody = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
