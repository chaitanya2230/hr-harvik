import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../../config/env';
import { badRequest, forbidden, notFound, unauthorized, unprocessable } from '../../utils/errors';
import * as documentService from './document.service';
import { getPdfJobResult, queuePdfGenerationJob } from './pdf-queue.service';
import {
  createTemplateSchema,
  generateDocumentSchema,
  listDocumentsSchema,
  listTemplatesSchema,
  previewTemplateSchema,
  updateTemplateSchema,
  uploadDocumentSchema,
  uploadVersionSchema,
} from './document.validation';

// Multer memory storage configured with 10MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
  },
});

export const documentUploadMiddleware = upload.single('file');

export function handleMulterError(
  err: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(
        unprocessable(`File size exceeds maximum allowed limit of ${env.MAX_UPLOAD_MB} MB`),
      );
    }
    return next(badRequest(`Upload error: ${err.message}`));
  }
  next(err);
}

function idParam(req: Request): string {
  return (req.params.id as string) ?? '';
}

function getContext(req: Request): documentService.DocumentContext {
  return {
    account: req.user!,
    ip: req.ip ?? null,
    requestId: (req.headers['x-request-id'] as string) || null,
  };
}

// ---------------------------------------------------------------------------
// Document Handlers
// ---------------------------------------------------------------------------

export async function uploadDocumentHandler(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw badRequest('File is required for upload');
  }

  const body = uploadDocumentSchema.parse(req.body);

  const doc = await documentService.uploadDocument(
    {
      employeeId: body.employeeId,
      category: body.category,
      title: body.title,
      fileBuffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      expiryDate: body.expiryDate,
      confidential: body.confidential,
    },
    getContext(req),
  );

  res.status(201).json({ data: doc });
}

export async function uploadDocumentVersionHandler(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw badRequest('File is required for version upload');
  }

  const body = uploadVersionSchema.parse(req.body);

  const doc = await documentService.uploadDocumentVersion(
    idParam(req),
    {
      fileBuffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      title: body.title,
      expiryDate: body.expiryDate,
    },
    getContext(req),
  );

  res.status(201).json({ data: doc });
}

export async function listDocumentsHandler(req: Request, res: Response): Promise<void> {
  const query = listDocumentsSchema.parse(req.query);
  const result = await documentService.listDocuments(query, getContext(req));
  res.json(result);
}

export async function getDocumentHandler(req: Request, res: Response): Promise<void> {
  const doc = await documentService.getDocumentById(idParam(req), getContext(req));
  res.json({ data: doc });
}

export async function downloadDocumentFileHandler(req: Request, res: Response): Promise<void> {
  const result = await documentService.getDocumentFile(idParam(req), getContext(req));

  res.setHeader('Content-Type', result.mimeType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(result.originalName)}"`,
  );
  res.setHeader('Content-Length', result.size);

  res.sendFile(result.filePath);
}

export async function getDocumentHistoryHandler(req: Request, res: Response): Promise<void> {
  const history = await documentService.getDocumentHistory(idParam(req), getContext(req));
  res.json({ data: history });
}

export async function deleteDocumentHandler(req: Request, res: Response): Promise<void> {
  await documentService.deleteDocument(idParam(req), getContext(req));
  res.status(204).send();
}

// ---------------------------------------------------------------------------
// Template Handlers
// ---------------------------------------------------------------------------

export async function createTemplateHandler(req: Request, res: Response): Promise<void> {
  const body = createTemplateSchema.parse(req.body);
  const template = await documentService.createTemplate(body, getContext(req));
  res.status(201).json({ data: template });
}

export async function listTemplatesHandler(req: Request, res: Response): Promise<void> {
  const query = listTemplatesSchema.parse(req.query);
  const templates = await documentService.listTemplates(query);
  res.json({ data: templates });
}

export async function getTemplateHandler(req: Request, res: Response): Promise<void> {
  const template = await documentService.getTemplateById(idParam(req));
  res.json({ data: template });
}

export async function updateTemplateHandler(req: Request, res: Response): Promise<void> {
  const body = updateTemplateSchema.parse(req.body);
  const template = await documentService.updateTemplate(
    idParam(req),
    body,
    getContext(req),
  );
  res.json({ data: template });
}

export async function deleteTemplateHandler(req: Request, res: Response): Promise<void> {
  await documentService.deleteTemplate(idParam(req), getContext(req));
  res.status(204).send();
}

export async function previewTemplateHandler(req: Request, res: Response): Promise<void> {
  const body = previewTemplateSchema.parse(req.body);
  const result = await documentService.previewTemplate(idParam(req), body.employeeId);
  res.json({ data: result });
}

export async function generateDocumentHandler(req: Request, res: Response): Promise<void> {
  const body = generateDocumentSchema.parse(req.body);
  const context = getContext(req);

  // §3 — opt-in queued generation: enqueue on the BullMQ pdf-generation
  // queue and let the client poll the job status endpoint.
  if (body.mode === 'queued') {
    const jobId = await queuePdfGenerationJob({
      templateId: idParam(req),
      employeeId: body.employeeId,
      title: body.title,
      confidential: body.confidential ?? false,
      context,
    });
    res.status(202).json({ data: { jobId, status: 'pending' } });
    return;
  }

  const doc = await documentService.generateDocument(
    {
      templateId: idParam(req),
      employeeId: body.employeeId,
      title: body.title,
      confidential: body.confidential,
    },
    context,
  );

  res.status(201).json({ data: doc });
}

/** Poll endpoint for queued PDF generation (ownership-scoped like exports). */
export async function getPdfJobHandler(req: Request, res: Response): Promise<void> {
  const jobId = (req.params.jobId as string) ?? '';
  if (!jobId) throw badRequest('PDF generation job id is required');

  const account = req.user;
  if (!account) throw unauthorized('Authentication required');

  const job = await getPdfJobResult(jobId);
  if (!job) throw notFound('PDF generation job not found');

  // Job results belong to the requester (HR Admin may inspect any job) —
  // the same ownership rule as report exports.
  if (job.ownerId !== account.userId && account.role !== 'HR Admin') {
    throw forbidden('You do not have access to this generation job');
  }

  res.json({
    data: {
      status: job.status,
      documentId: job.documentId ?? null,
      error: job.error ?? null,
      templateId: job.templateId,
      employeeId: job.employeeId,
      createdAt: job.createdAt,
    },
  });
}
