import { z } from 'zod';

/** IANA timezone check — the same mechanism `Intl.DateTimeFormat` uses. */
const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const updateSettingsSchema = z
  .object({
    companyName: z.string().trim().min(1, 'Company name is required').max(120).optional(),
    timezone: z
      .string()
      .trim()
      .min(1, 'Timezone is required')
      .max(64)
      .refine(isValidTimezone, 'Timezone must be a valid IANA timezone such as Asia/Kolkata')
      .optional(),
    minAgeIntern: z.coerce
      .number()
      .int('Minimum age must be a whole number')
      .min(10, 'Minimum age must be at least 10')
      .max(60, 'Minimum age must be at most 60')
      .optional(),
    minAgeOther: z.coerce
      .number()
      .int('Minimum age must be a whole number')
      .min(10, 'Minimum age must be at least 10')
      .max(60, 'Minimum age must be at most 60')
      .optional(),
    probationDefault: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body).length > 0,
    'Provide at least one setting to update',
  );

export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>;
