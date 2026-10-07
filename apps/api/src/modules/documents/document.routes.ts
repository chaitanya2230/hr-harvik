import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { asyncHandler } from '../../utils/http';
import {
  createTemplateHandler,
  deleteDocumentHandler,
  deleteTemplateHandler,
  downloadDocumentFileHandler,
  generateDocumentHandler,
  getDocumentHandler,
  getDocumentHistoryHandler,
  getPdfJobHandler,
  getTemplateHandler,
  handleMulterError,
  listDocumentsHandler,
  listTemplatesHandler,
  previewTemplateHandler,
  documentUploadMiddleware,
  updateTemplateHandler,
  uploadDocumentHandler,
  uploadDocumentVersionHandler,
} from './document.controller';

export const documentRouter = Router();

// All document routes require authentication
documentRouter.use(requireAuth);

// Document upload & lifecycle
documentRouter.post(
  '/',
  requirePermission('manageDocuments'),
  documentUploadMiddleware,
  handleMulterError,
  asyncHandler(uploadDocumentHandler),
);

documentRouter.get('/', asyncHandler(listDocumentsHandler));
documentRouter.get('/:id', asyncHandler(getDocumentHandler));
documentRouter.get('/:id/file', asyncHandler(downloadDocumentFileHandler));

documentRouter.post(
  '/:id/versions',
  requirePermission('manageDocuments'),
  documentUploadMiddleware,
  handleMulterError,
  asyncHandler(uploadDocumentVersionHandler),
);

documentRouter.get('/:id/history', asyncHandler(getDocumentHistoryHandler));

// Queued PDF generation status (§3 — BullMQ pdf-generation queue).
documentRouter.get('/pdf-jobs/:jobId', asyncHandler(getPdfJobHandler));

documentRouter.delete(
  '/:id',
  requirePermission('manageDocuments'),
  asyncHandler(deleteDocumentHandler),
);

// ---------------------------------------------------------------------------
// Template Router
// ---------------------------------------------------------------------------

export const documentTemplateRouter = Router();

documentTemplateRouter.use(requireAuth);

// Template CRUD (manageDocumentTemplates: HR Admin only)
documentTemplateRouter.post(
  '/',
  requirePermission('manageDocumentTemplates'),
  asyncHandler(createTemplateHandler),
);

documentTemplateRouter.get('/', asyncHandler(listTemplatesHandler));
documentTemplateRouter.get('/:id', asyncHandler(getTemplateHandler));

documentTemplateRouter.patch(
  '/:id',
  requirePermission('manageDocumentTemplates'),
  asyncHandler(updateTemplateHandler),
);

documentTemplateRouter.delete(
  '/:id',
  requirePermission('manageDocumentTemplates'),
  asyncHandler(deleteTemplateHandler),
);

// Template Preview & Document Generation (manageDocuments: HR Admin + HR Manager)
documentTemplateRouter.post(
  '/:id/preview',
  requirePermission('manageDocuments'),
  asyncHandler(previewTemplateHandler),
);

documentTemplateRouter.post(
  '/:id/generate',
  requirePermission('manageDocuments'),
  asyncHandler(generateDocumentHandler),
);
