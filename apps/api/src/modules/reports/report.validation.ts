import { z } from 'zod';
import { REPORT_TYPES, MAX_PAGE_LIMIT } from '../../config/constants';
import { objectIdSchema } from '../employees/employee.validation';

export const reportTypeParamSchema = z.object({
  type: z.enum(REPORT_TYPES),
});

export const reportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
  departmentId: objectIdSchema.optional(),
  employmentType: z.string().optional(),
  status: z.string().optional(),
  managerId: objectIdSchema.optional(),
  employeeId: objectIdSchema.optional(),
  leaveTypeId: objectIdSchema.optional(),
  workMode: z.string().optional(),
  condition: z.string().optional(),
  licenseType: z.string().optional(),
  provider: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  joiningFrom: z.string().optional(),
  joiningTo: z.string().optional(),
  stage: z.string().optional(),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const exportQuerySchema = reportQuerySchema.extend({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  async: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;
