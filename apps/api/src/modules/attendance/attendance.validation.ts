import { z } from 'zod';
import {
  ATTENDANCE_STATUSES,
  WORK_MODES,
} from '../../config/constants';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const markAttendanceSchema = z.object({
  employeeId: z.string().optional(),
  date: z.string().regex(DATE_REGEX, 'date must be in YYYY-MM-DD format'),
  status: z.enum(ATTENDANCE_STATUSES),
  workMode: z.enum(WORK_MODES).optional().nullable(),
  checkIn: z.string().optional().nullable(),
  checkOut: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const requestCorrectionSchema = z.object({
  employeeId: z.string().optional(),
  date: z.string().regex(DATE_REGEX, 'date must be in YYYY-MM-DD format'),
  requestedStatus: z.enum(['Present', 'Absent', 'Half Day']),
  requestedWorkMode: z.enum(WORK_MODES).optional().nullable(),
  reason: z.string().min(1, 'Reason is required').trim(),
});

export type RequestCorrectionInput = z.infer<typeof requestCorrectionSchema>;

export const reviewCorrectionSchema = z
  .object({
    status: z.enum(['Approved', 'Rejected']),
    reviewNote: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'Rejected' && (!data.reviewNote || !data.reviewNote.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reviewNote'],
        message: 'Review note is required when rejecting a correction request',
      });
    }
  });

export type ReviewCorrectionInput = z.infer<typeof reviewCorrectionSchema>;

export const holidaySchemaInput = z.object({
  date: z.string().regex(DATE_REGEX, 'date must be in YYYY-MM-DD format'),
  name: z.string().min(1, 'Holiday name is required').trim(),
});

export type HolidayInput = z.infer<typeof holidaySchemaInput>;
