import fs from 'node:fs';
import { Types } from 'mongoose';
import type { FilterQuery } from 'mongoose';
import { Document } from './document.model';
import { DocumentTemplate } from './template.model';
import type { DocumentDoc } from './document.schema';
import type { DocumentTemplateDoc } from './template.schema';
import { Employee } from '../employees/employee.model';
import { Exit } from '../exit/exit.model';
import { recordAudit } from '../audit/audit.service';
import { collectTeamIds, isValidScopeId } from '../employees/employee.scope';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { buildPagination, listMeta, type Pagination } from '../../utils/http';
import { trustedFilter } from '../../utils/mongo';
import { conflict, forbidden, notFound } from '../../utils/errors';
import type { AuthAccount } from '../auth/auth.service';
import {
  generateRandomFilename,
  resolveSafeFilePath,
  validateFileSize,
  validateFileSignature,
  type AllowedMimeType,
} from './storage.service';
import {
  buildDocumentContext,
  generatePdfFile,
  renderTemplate,
  sanitizeTemplateHtml,
  validateGenerationRules,
} from './pdf.service';

export interface DocumentContext {
  account: AuthAccount;
  ip: string | null;
  requestId: string | null;
}

const toId = (val: string): Types.ObjectId => new Types.ObjectId(val);

/**
 * Check whether the requesting account is authorized to view the given document.
 * AGENTS.md §6, §14:
 * - "owner can access own document"
 * - "other employee cannot"
 * - "confidential document protected"
 */
export async function assertCanViewDocument(
  doc: DocumentDoc,
  account: AuthAccount,
): Promise<void> {
  const isHr = account.role === 'HR Admin' || account.role === 'HR Manager';

  // Confidential documents can only be accessed by HR
  if (doc.confidential && !isHr) {
    throw forbidden('Confidential documents are restricted to HR personnel');
  }

  if (isHr) return;

  // Employee self-service
  if (account.role === 'Employee') {
    if (!account.employeeId || String(doc.employeeId) !== String(account.employeeId)) {
      throw forbidden('You do not have permission to access this document');
    }
    return;
  }

  // Manager team-scoping
  if (account.role === 'Manager') {
    if (!account.employeeId) {
      throw forbidden('Manager account is not linked to an employee record');
    }
    if (doc.employeeId.equals(account.employeeId)) {
      return; // Manager can access their own document
    }
    const teamIds = await collectTeamIds(account.employeeId);
    if (!teamIds.has(String(doc.employeeId))) {
      throw forbidden('You do not have permission to view documents for this employee');
    }
    return;
  }

  throw forbidden('Unauthorized document access');
}

// ---------------------------------------------------------------------------
// Document Management
// ---------------------------------------------------------------------------

export interface UploadDocumentInput {
  employeeId: string;
  category: string;
  title: string;
  fileBuffer: Buffer;
  originalName: string;
  mimeType: string;
  expiryDate?: string | null;
  confidential?: boolean;
}

export async function uploadDocument(
  input: UploadDocumentInput,
  ctx: DocumentContext,
): Promise<DocumentDoc> {
  const employee = await Employee.findOne({
    _id: toId(input.employeeId),
    isDeleted: false,
  }).exec();

  if (!employee) {
    throw notFound(`Employee "${input.employeeId}" not found`);
  }

  // Validate size & signature
  validateFileSize(input.fileBuffer.length);
  validateFileSignature(input.fileBuffer, input.mimeType);

  // Generate random server filename and save
  const serverFilename = generateRandomFilename(input.mimeType as AllowedMimeType);
  const filePath = resolveSafeFilePath(serverFilename);
  await fs.promises.writeFile(filePath, input.fileBuffer);

  const doc = await Document.create({
    employeeId: employee._id,
    category: input.category,
    title: input.title.trim(),
    file: {
      filename: serverFilename,
      originalName: input.originalName,
      mimeType: input.mimeType,
      size: input.fileBuffer.length,
      path: filePath,
    },
    version: 1,
    previousVersionId: null,
    source: 'Uploaded',
    templateId: null,
    expiryDate: input.expiryDate ?? null,
    confidential: input.confidential ?? false,
    uploadedBy: toId(ctx.account.userId),
    createdBy: toId(ctx.account.userId),
    isDeleted: false,
  });

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'DOCUMENT_UPLOAD',
    entityType: 'Document',
    entityId: String(doc._id),
    before: null,
    after: {
      id: String(doc._id),
      employeeId: String(doc.employeeId),
      category: doc.category,
      title: doc.title,
      version: doc.version,
      filename: doc.file.filename,
    },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();
  return doc;
}

export interface UploadVersionInput {
  fileBuffer: Buffer;
  originalName: string;
  mimeType: string;
  title?: string;
  expiryDate?: string | null;
}

export async function uploadDocumentVersion(
  documentId: string,
  input: UploadVersionInput,
  ctx: DocumentContext,
): Promise<DocumentDoc> {
  const currentDoc = await Document.findOne({
    _id: toId(documentId),
    isDeleted: false,
  }).exec();

  if (!currentDoc) {
    throw notFound(`Document "${documentId}" not found`);
  }

  // Validate file
  validateFileSize(input.fileBuffer.length);
  validateFileSignature(input.fileBuffer, input.mimeType);

  // Find highest version in chain
  const latestInChain = await Document.findOne({
    employeeId: currentDoc.employeeId,
    category: currentDoc.category,
    isDeleted: false,
  })
    .sort({ version: -1 })
    .exec();

  const nextVersion = (latestInChain?.version ?? currentDoc.version) + 1;

  // Generate random server filename and save
  const serverFilename = generateRandomFilename(input.mimeType as AllowedMimeType);
  const filePath = resolveSafeFilePath(serverFilename);
  await fs.promises.writeFile(filePath, input.fileBuffer);

  const newDoc = await Document.create({
    employeeId: currentDoc.employeeId,
    category: currentDoc.category,
    title: input.title?.trim() || currentDoc.title,
    file: {
      filename: serverFilename,
      originalName: input.originalName,
      mimeType: input.mimeType,
      size: input.fileBuffer.length,
      path: filePath,
    },
    version: nextVersion,
    previousVersionId: currentDoc._id,
    source: 'Uploaded',
    templateId: null,
    expiryDate: input.expiryDate !== undefined ? input.expiryDate : currentDoc.expiryDate,
    confidential: currentDoc.confidential,
    uploadedBy: toId(ctx.account.userId),
    createdBy: toId(ctx.account.userId),
    isDeleted: false,
  });

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'DOCUMENT_VERSION_UPLOAD',
    entityType: 'Document',
    entityId: String(newDoc._id),
    before: { id: String(currentDoc._id), version: currentDoc.version },
    after: {
      id: String(newDoc._id),
      version: newDoc.version,
      previousVersionId: String(currentDoc._id),
    },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();
  return newDoc;
}

export async function getDocumentById(
  documentId: string,
  ctx: DocumentContext,
): Promise<DocumentDoc> {
  const doc = await Document.findOne({
    _id: toId(documentId),
    isDeleted: false,
  }).exec();

  if (!doc) {
    throw notFound(`Document "${documentId}" not found`);
  }

  await assertCanViewDocument(doc, ctx.account);
  return doc;
}

export async function getDocumentFile(
  documentId: string,
  ctx: DocumentContext,
): Promise<{ filePath: string; originalName: string; mimeType: string; size: number }> {
  const doc = await getDocumentById(documentId, ctx);
  const filePath = resolveSafeFilePath(doc.file.filename);

  if (!fs.existsSync(filePath)) {
    throw notFound('Document file not found on storage server');
  }

  return {
    filePath,
    originalName: doc.file.originalName,
    mimeType: doc.file.mimeType,
    size: doc.file.size,
  };
}

export async function getDocumentHistory(
  documentId: string,
  ctx: DocumentContext,
): Promise<DocumentDoc[]> {
  const doc = await getDocumentById(documentId, ctx);

  // Walk backwards to find root document
  let root = doc;
  while (root.previousVersionId) {
    const parent = await Document.findOne({ _id: root.previousVersionId, isDeleted: false }).exec();
    if (!parent) break;
    root = parent;
  }

  // Find all documents in this specific lineage
  const chain: DocumentDoc[] = [root];
  let currentId = root._id;
  while (true) {
    const next = await Document.findOne({ previousVersionId: currentId, isDeleted: false }).exec();
    if (!next) break;
    chain.push(next);
    currentId = next._id;
  }

  return chain.sort((a, b) => a.version - b.version);
}

export interface ListDocumentsFilter {
  page?: number;
  limit?: number;
  employeeId?: string;
  category?: string;
  confidential?: boolean;
  source?: string;
  expiringBefore?: string;
  search?: string;
}

export async function listDocuments(
  filter: ListDocumentsFilter,
  ctx: DocumentContext,
): Promise<{ data: DocumentDoc[]; meta: ReturnType<typeof listMeta> }> {
  const pagination: Pagination = buildPagination({
    page: filter.page,
    limit: filter.limit,
  });

  const query: FilterQuery<DocumentDoc> = { isDeleted: false };

  // RBAC scope filters
  if (ctx.account.role === 'Employee') {
    if (!isValidScopeId(ctx.account.employeeId)) return { data: [], meta: listMeta(pagination, 0) };
    query.employeeId = ctx.account.employeeId;
    query.confidential = false;
  } else if (ctx.account.role === 'Manager') {
    if (!isValidScopeId(ctx.account.employeeId)) return { data: [], meta: listMeta(pagination, 0) };
    const teamIds = await collectTeamIds(ctx.account.employeeId);
    const allowedIds = [toId(ctx.account.employeeId), ...Array.from(teamIds).map(toId)];

    if (filter.employeeId) {
      const requestedId = toId(filter.employeeId);
      if (!teamIds.has(String(requestedId)) && requestedId.toString() !== ctx.account.employeeId) {
        throw forbidden('Employee is outside of your management scope');
      }
      query.employeeId = requestedId;
    } else {
      query.employeeId = trustedFilter({ $in: allowedIds });
    }
    query.confidential = false;
  } else {
    // HR Admin & HR Manager
    if (filter.employeeId) {
      query.employeeId = toId(filter.employeeId);
    }
    if (filter.confidential !== undefined) {
      query.confidential = filter.confidential;
    }
  }

  if (filter.category) query.category = filter.category;
  if (filter.source) query.source = filter.source;

  if (filter.expiringBefore) {
    query.expiryDate = trustedFilter({ $lte: filter.expiringBefore, $ne: null });
  }

  if (filter.search) {
    const escaped = filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.title = trustedFilter({ $regex: escaped, $options: 'i' });
  }

  const [data, total] = await Promise.all([
    Document.find(query)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    Document.countDocuments(query).exec(),
  ]);

  return { data, meta: listMeta(pagination, total) };
}

export async function deleteDocument(
  documentId: string,
  ctx: DocumentContext,
): Promise<void> {
  const doc = await Document.findOne({
    _id: toId(documentId),
    isDeleted: false,
  }).exec();

  if (!doc) {
    throw notFound(`Document "${documentId}" not found`);
  }

  doc.isDeleted = true;
  await doc.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'DOCUMENT_DELETE',
    entityType: 'Document',
    entityId: String(doc._id),
    before: { id: String(doc._id), title: doc.title },
    after: { id: String(doc._id), isDeleted: true },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();
}

// ---------------------------------------------------------------------------
// Document Templates & PDF Generation
// ---------------------------------------------------------------------------

export interface CreateTemplateInput {
  name: string;
  category: string;
  applicableEmploymentTypes: string[];
  bodyHtml: string;
  isActive?: boolean;
}

export async function createTemplate(
  input: CreateTemplateInput,
  ctx: DocumentContext,
): Promise<DocumentTemplateDoc> {
  const existing = await DocumentTemplate.findOne({
    name: input.name.trim(),
    isDeleted: false,
  }).exec();

  if (existing) {
    throw conflict(`A document template with name "${input.name.trim()}" already exists`);
  }

  const sanitizedHtml = sanitizeTemplateHtml(input.bodyHtml);

  const template = await DocumentTemplate.create({
    name: input.name.trim(),
    category: input.category,
    applicableEmploymentTypes: input.applicableEmploymentTypes,
    bodyHtml: sanitizedHtml,
    isActive: input.isActive ?? true,
    createdBy: toId(ctx.account.userId),
    isDeleted: false,
  });

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'TEMPLATE_CREATE',
    entityType: 'DocumentTemplate',
    entityId: String(template._id),
    before: null,
    after: { id: String(template._id), name: template.name, category: template.category },
    ip: ctx.ip,
  });

  return template;
}

export interface UpdateTemplateInput {
  name?: string;
  category?: string;
  applicableEmploymentTypes?: string[];
  bodyHtml?: string;
  isActive?: boolean;
}

export async function updateTemplate(
  templateId: string,
  input: UpdateTemplateInput,
  ctx: DocumentContext,
): Promise<DocumentTemplateDoc> {
  const template = await DocumentTemplate.findOne({
    _id: toId(templateId),
    isDeleted: false,
  }).exec();

  if (!template) {
    throw notFound(`Document template "${templateId}" not found`);
  }

  const beforeState = template.toObject();

  if (input.name && input.name.trim() !== template.name) {
    const duplicate = await DocumentTemplate.findOne({
      name: input.name.trim(),
      _id: { $ne: template._id },
      isDeleted: false,
    }).exec();
    if (duplicate) {
      throw conflict(`A document template with name "${input.name.trim()}" already exists`);
    }
    template.name = input.name.trim();
  }

  if (input.category) template.category = input.category as DocumentTemplateDoc['category'];
  if (input.applicableEmploymentTypes) {
    template.applicableEmploymentTypes = input.applicableEmploymentTypes as DocumentTemplateDoc['applicableEmploymentTypes'];
  }
  if (input.bodyHtml) {
    template.bodyHtml = sanitizeTemplateHtml(input.bodyHtml);
  }
  if (input.isActive !== undefined) {
    template.isActive = input.isActive;
  }

  await template.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'TEMPLATE_UPDATE',
    entityType: 'DocumentTemplate',
    entityId: String(template._id),
    before: beforeState,
    after: template.toObject(),
    ip: ctx.ip,
  });

  return template;
}

export async function deleteTemplate(
  templateId: string,
  ctx: DocumentContext,
): Promise<void> {
  const template = await DocumentTemplate.findOne({
    _id: toId(templateId),
    isDeleted: false,
  }).exec();

  if (!template) {
    throw notFound(`Document template "${templateId}" not found`);
  }

  template.isDeleted = true;
  await template.save();

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'TEMPLATE_DELETE',
    entityType: 'DocumentTemplate',
    entityId: String(template._id),
    before: { id: String(template._id), name: template.name },
    after: { id: String(template._id), isDeleted: true },
    ip: ctx.ip,
  });
}

export async function listTemplates(
  query: { category?: string; isActive?: boolean },
): Promise<DocumentTemplateDoc[]> {
  const filter: FilterQuery<DocumentTemplateDoc> = { isDeleted: false };
  if (query.category) filter.category = query.category;
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  return DocumentTemplate.find(filter).sort({ name: 1 }).exec();
}

export async function getTemplateById(templateId: string): Promise<DocumentTemplateDoc> {
  const template = await DocumentTemplate.findOne({
    _id: toId(templateId),
    isDeleted: false,
  }).exec();

  if (!template) {
    throw notFound(`Document template "${templateId}" not found`);
  }

  return template;
}

export async function previewTemplate(
  templateId: string,
  employeeId: string,
): Promise<{ renderedHtml: string; context: Record<string, unknown> }> {
  const [template, employee] = await Promise.all([
    getTemplateById(templateId),
    Employee.findOne({ _id: toId(employeeId), isDeleted: false }).exec(),
  ]);

  if (!employee) {
    throw notFound(`Employee "${employeeId}" not found`);
  }

  validateGenerationRules(template, employee);
  const context = await buildDocumentContext(employee);
  const renderedHtml = renderTemplate(template.bodyHtml, context);

  return { renderedHtml, context: context as unknown as Record<string, unknown> };
}

export interface GenerateDocumentInput {
  templateId: string;
  employeeId: string;
  title?: string;
  confidential?: boolean;
}

export async function generateDocument(
  input: GenerateDocumentInput,
  ctx: DocumentContext,
): Promise<DocumentDoc> {
  const [template, employee] = await Promise.all([
    getTemplateById(input.templateId),
    Employee.findOne({ _id: toId(input.employeeId), isDeleted: false }).exec(),
  ]);

  if (!employee) {
    throw notFound(`Employee "${input.employeeId}" not found`);
  }

  validateGenerationRules(template, employee);
  const context = await buildDocumentContext(employee);
  const renderedContent = renderTemplate(template.bodyHtml, context);

  const serverFilename = generateRandomFilename('application/pdf');
  const filePath = resolveSafeFilePath(serverFilename);

  const documentTitle = input.title?.trim() || `${template.name} - ${context.employee.fullName}`;

  await generatePdfFile(renderedContent, filePath, {
    title: documentTitle,
    category: template.category,
    companyName: context.company.name,
    employeeName: context.employee.fullName,
    date: context.today,
  });

  const stat = await fs.promises.stat(filePath);

  const doc = await Document.create({
    employeeId: employee._id,
    category: template.category,
    title: documentTitle,
    file: {
      filename: serverFilename,
      originalName: `${template.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
      mimeType: 'application/pdf',
      size: stat.size,
      path: filePath,
    },
    version: 1,
    previousVersionId: null,
    source: 'Generated',
    templateId: template._id,
    expiryDate: null,
    confidential: input.confidential ?? false,
    uploadedBy: toId(ctx.account.userId),
    createdBy: toId(ctx.account.userId),
    isDeleted: false,
  });

  // AGENTS.md §8.10 Exit Linkage:
  // Connect Experience Certificate and Relieving Letter to open Exit record
  if (template.category === 'Experience Certificate' || template.category === 'Relieving Letter') {
    const exit = await Exit.findOne({
      employeeId: employee._id,
      isDeleted: false,
      stage: trustedFilter({ $ne: 'Cancelled' }),
    }).exec();

    if (exit) {
      if (template.category === 'Experience Certificate') {
        exit.experienceLetterDocId = doc._id;
        const item = exit.checklist.find(
          (c) => c.id === 'doc-experience' || c.title.toLowerCase().includes('experience'),
        );
        if (item) {
          item.status = 'Completed';
          item.completedAt = new Date();
        }
      } else if (template.category === 'Relieving Letter') {
        exit.relievingLetterDocId = doc._id;
        const item = exit.checklist.find(
          (c) => c.id === 'doc-relieving' || c.title.toLowerCase().includes('relieving'),
        );
        if (item) {
          item.status = 'Completed';
          item.completedAt = new Date();
        }
      }
      await exit.save();
    }
  }

  await recordAudit({
    actorId: ctx.account.userId,
    action: 'DOCUMENT_GENERATE',
    entityType: 'Document',
    entityId: String(doc._id),
    before: null,
    after: {
      id: String(doc._id),
      templateId: String(template._id),
      employeeId: String(employee._id),
      category: doc.category,
      title: doc.title,
    },
    ip: ctx.ip,
  });

  await invalidateDashboardCache();
  return doc;
}
