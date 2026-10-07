import { z } from 'zod';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_SOURCES,
  EMPLOYMENT_TYPES,
  MAX_PAGE_LIMIT,
} from '../../config/constants';

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export const objectIdSchema = z
  .string()
  .trim()
  .regex(OBJECT_ID_REGEX, 'Must be a valid 24-character hex ObjectId');

const booleanCoerce = z.preprocess((val) => {
  if (typeof val === 'string') {
    if (val.toLowerCase() === 'true' || val === '1') return true;
    if (val.toLowerCase() === 'false' || val === '0') return false;
  }
  return val;
}, z.boolean());

export const uploadDocumentSchema = z.object({
  employeeId: objectIdSchema,
  category: z.enum(DOCUMENT_CATEGORIES, {
    errorMap: () => ({ message: 'Invalid document category' }),
  }),
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title too long'),
  expiryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in YYYY-MM-DD format')
    .optional()
    .nullable(),
  confidential: booleanCoerce.optional().default(false),
});

export type UploadDocumentBody = z.infer<typeof uploadDocumentSchema>;

export const uploadVersionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  expiryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in YYYY-MM-DD format')
    .optional()
    .nullable(),
});

export type UploadVersionBody = z.infer<typeof uploadVersionSchema>;

export const listDocumentsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).default(20),
  employeeId: objectIdSchema.optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  confidential: booleanCoerce.optional(),
  source: z.enum(DOCUMENT_SOURCES).optional(),
  expiringBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().trim().optional(),
});

export type ListDocumentsQuery = z.infer<typeof listDocumentsSchema>;

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Template name is required').max(100),
  category: z.enum(DOCUMENT_CATEGORIES, {
    errorMap: () => ({ message: 'Invalid template category' }),
  }),
  applicableEmploymentTypes: z
    .array(z.enum(EMPLOYMENT_TYPES))
    .min(1, 'At least one applicable employment type is required'),
  bodyHtml: z.string().min(1, 'Template body is required'),
  isActive: z.boolean().optional().default(true),
});

export type CreateTemplateBody = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  applicableEmploymentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).min(1).optional(),
  bodyHtml: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateTemplateBody = z.infer<typeof updateTemplateSchema>;

export const listTemplatesSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  isActive: booleanCoerce.optional(),
});

export type ListTemplatesQuery = z.infer<typeof listTemplatesSchema>;

export const previewTemplateSchema = z.object({
  employeeId: objectIdSchema,
});

export type PreviewTemplateBody = z.infer<typeof previewTemplateSchema>;

export const generateDocumentSchema = z.object({
  employeeId: objectIdSchema,
  title: z.string().trim().min(1).max(200).optional(),
  confidential: booleanCoerce.optional().default(false),
  /**
   * §3 — `queued` runs the PDF on the BullMQ `pdf-generation` queue and
   * returns `202 { jobId }` for polling; the default stays synchronous.
   */
  mode: z.enum(['sync', 'queued']).optional().default('sync'),
});

export type GenerateDocumentBody = z.infer<typeof generateDocumentSchema>;
