import { z } from 'zod';

export const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(200, 'Email must be at most 200 characters');

/**
 * AGENTS.md §6 — password policy: minimum 8 characters, at least one number
 * and at least one letter.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter');

export const loginSchema = z.object({
  email: emailSchema,
  // Login deliberately does not apply the creation-time password policy, so a
  // previously valid password keeps working if the policy is tightened.
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required')
    .max(128, 'Password must be at most 128 characters'),
});

export const refreshSchema = z.object({
  // Refresh normally travels in an httpOnly cookie; body is accepted so the
  // flow also works for non-browser clients and integration tests.
  refreshToken: z.string().min(10).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: passwordSchema,
});

export type LoginBody = z.infer<typeof loginSchema>;
export type RefreshBody = z.infer<typeof refreshSchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;

/** Seeded demo password must satisfy the same policy as user-created ones. */
export const DEMO_PASSWORD = 'Passw0rd!';