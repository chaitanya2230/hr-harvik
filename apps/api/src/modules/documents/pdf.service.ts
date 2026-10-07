import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import Handlebars from 'handlebars';
import sanitizeHtml from 'sanitize-html';
import { env } from '../../config/env';
import { unprocessable } from '../../utils/errors';
import type { Types } from 'mongoose';
import type { EmployeeDoc } from '../employees/employee.schema';
import type { DocumentTemplateDoc } from './template.schema';
import { Exit } from '../exit/exit.model';
import { Department } from '../departments/department.model';

export interface DocumentContext {
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    phone: string;
    designation: string;
    department: string;
    employmentType: string;
    dateOfJoining: string;
    dob?: string;
    compensation?: {
      amount?: number;
      currency?: string;
      period?: string;
    };
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
    };
    status: string;
    lastWorkingDay?: string | null;
  };
  company: {
    name: string;
    website: string;
    email: string;
  };
  today: string;
  exit?: {
    lastWorkingDay?: string | null;
    resignationDate?: string | null;
    reason?: string | null;
  };
}

/**
 * AGENTS.md §14: "unsafe HTML sanitized"
 * Strip dangerous tags while preserving basic layout tags for preview.
 */
export function sanitizeTemplateHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p', 'a', 'ul', 'ol',
      'nl', 'li', 'b', 'i', 'strong', 'em', 'strike', 'code', 'hr', 'br', 'div',
      'table', 'thead', 'caption', 'tbody', 'tr', 'th', 'td', 'pre', 'span'
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target'],
      div: ['class', 'style'],
      span: ['class', 'style'],
      p: ['class', 'style'],
      table: ['class', 'style', 'border', 'cellpadding', 'cellspacing'],
    },
    disallowedTagsMode: 'discard',
  });
}

/**
 * Build document rendering context for an employee.
 */
export async function buildDocumentContext(
  employee: EmployeeDoc & { _id?: Types.ObjectId | string; id?: string },
): Promise<DocumentContext> {
  let departmentName = 'General';
  if (employee.departmentId) {
    const dept = await Department.findById(employee.departmentId).lean().exec();
    if (dept) {
      departmentName = dept.name;
    }
  }

  const empId = employee._id ?? employee.id;
  let exitData: DocumentContext['exit'] | undefined;
  const exit = await Exit.findOne({ employeeId: empId, isDeleted: false }).lean().exec();
  if (exit) {
    exitData = {
      lastWorkingDay: exit.lastWorkingDay ?? employee.lastWorkingDay ?? null,
      resignationDate: exit.resignationDate ?? null,
      reason: exit.reason ?? null,
    };
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return {
    employee: {
      id: String(empId),
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      fullName: `${employee.firstName} ${employee.lastName}`.trim(),
      email: employee.email,
      phone: employee.phone ?? '',
      designation: employee.designation ?? '',
      department: departmentName,
      employmentType: employee.employmentType,
      dateOfJoining: employee.dateOfJoining,
      dob: employee.dob ?? undefined,
      compensation: employee.compensation
        ? {
            amount: employee.compensation.amount,
            currency: employee.compensation.currency,
            period: employee.compensation.period,
          }
        : undefined,
      address: employee.address
        ? {
            line1: employee.address.line1,
            line2: employee.address.line2,
            city: employee.address.city,
            state: employee.address.state,
            postalCode: employee.address.postalCode,
            country: employee.address.country,
          }
        : undefined,
      status: employee.status,
      lastWorkingDay: employee.lastWorkingDay ?? exitData?.lastWorkingDay ?? null,
    },
    company: {
      name: env.COMPANY_NAME || 'Harvik Technologies',
      website: 'https://harviktech.com/',
      email: env.MAIL_FROM || 'hr@harviktech.com',
    },
    today: todayStr,
    exit: exitData,
  };
}

/**
 * Extract tokens referenced in the template string (e.g. {{employee.firstName}}).
 */
export function extractTemplateVariables(bodyHtml: string): string[] {
  const matches = bodyHtml.match(/\{\{([^{}]+)\}\}/g) || [];
  return matches
    .map((m) => m.replace(/[{}]/g, '').trim())
    .filter((v) => !v.startsWith('#') && !v.startsWith('/') && !v.startsWith('^'));
}

/**
 * Validate that all required template fields exist in the context.
 * AGENTS.md §14: "missing template fields rejected".
 */
export function validateTemplateVariables(
  bodyHtml: string,
  context: DocumentContext,
): void {
  const tokens = extractTemplateVariables(bodyHtml);
  const missing: string[] = [];

  for (const token of tokens) {
    const parts = token.split('.');
    let cur: unknown = context;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in cur) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        cur = undefined;
        break;
      }
    }
    if (cur === undefined || cur === null || cur === '') {
      missing.push(token);
    }
  }

  if (missing.length > 0) {
    throw unprocessable(
      `Template requires missing employee or company fields: ${missing.join(', ')}`,
    );
  }
}

/**
 * Validate business constraints for template generation.
 * AGENTS.md §14:
 * - "employment-type mismatch rejected"
 * - "Experience Certificate restricted to On Notice/Relieved"
 */
export function validateGenerationRules(
  template: DocumentTemplateDoc,
  employee: EmployeeDoc,
): void {
  // 1. Employment type mismatch
  if (
    template.applicableEmploymentTypes.length > 0 &&
    !template.applicableEmploymentTypes.includes(employee.employmentType)
  ) {
    throw unprocessable(
      `Employment type mismatch: template "${template.name}" is applicable to [${template.applicableEmploymentTypes.join(', ')}], but employee is "${employee.employmentType}"`,
    );
  }

  // 2. Experience Certificate status restriction
  if (template.category === 'Experience Certificate') {
    if (employee.status !== 'On Notice' && employee.status !== 'Relieved') {
      throw unprocessable(
        `Experience Certificate can only be generated for employees who are 'On Notice' or 'Relieved'. Current status: '${employee.status}'`,
      );
    }
  }
}

/**
 * Compile template HTML into rendered string.
 *
 * XSS safety (AGENTS.md §14 "unsafe HTML sanitized"):
 *  1. The template itself is sanitized before compilation.
 *  2. Handlebars compiles with DEFAULT escaping (no `noEscape` option), so
 *     every `{{variable}}` interpolation of employee-controlled values is
 *     HTML-escaped and can never become executable markup.
 *  3. Defense in depth: the RENDERED output is sanitized once more, so even a
 *     raw triple-stash insertion cannot smuggle scripts or event handlers
 *     into preview HTML rendered via dangerouslySetInnerHTML.
 */
export function renderTemplate(
  bodyHtml: string,
  context: DocumentContext,
): string {
  const sanitized = sanitizeTemplateHtml(bodyHtml);
  validateTemplateVariables(sanitized, context);
  const compiled = Handlebars.compile(sanitized);
  return sanitizeTemplateHtml(compiled(context));
}

/**
 * Convert HTML rendered string into clean formatted text lines for PDFKit.
 */
function htmlToPdfLines(html: string): Array<{ text: string; isHeader?: boolean; isDivider?: boolean }> {
  // Replace break/paragraph tags with newlines
  const withBreaks = html
    .replace(/<hr\s*\/?>/gi, '\n---DIVIDER---\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<h[1-6][^>]*>/gi, '\n###HEADER### ')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n');

  // Strip remaining tags
  const clean = withBreaks.replace(/<[^>]+>/g, '');
  const rawLines = clean.split('\n');

  const result: Array<{ text: string; isHeader?: boolean; isDivider?: boolean }> = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      result.push({ text: '' });
    } else if (trimmed === '---DIVIDER---') {
      result.push({ text: '', isDivider: true });
    } else if (trimmed.startsWith('###HEADER### ')) {
      result.push({ text: trimmed.replace('###HEADER### ', ''), isHeader: true });
    } else {
      result.push({ text: trimmed });
    }
  }
  return result;
}

/**
 * Generate a clean, corporate PDF using PDFKit.
 * AGENTS.md §14: "valid PDF generated"
 */
export async function generatePdfFile(
  renderedContent: string,
  outputPath: string,
  options: {
    title: string;
    category: string;
    companyName: string;
    employeeName: string;
    date: string;
  },
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: options.title,
        Author: options.companyName,
        Subject: options.category,
      },
    });

    const writeStream = fs.createWriteStream(outputPath);
    doc.pipe(writeStream);

    // --- Header Letterhead ---
    doc
      .fontSize(20)
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .text(options.companyName, 50, 50);

    doc
      .fontSize(9)
      .fillColor('#64748b')
      .font('Helvetica')
      .text('HUMAN RESOURCES DEPARTMENT · OFFICIAL DOCUMENT', 50, 75);

    doc
      .strokeColor('#e2e8f0')
      .lineWidth(1)
      .moveTo(50, 95)
      .lineTo(545, 95)
      .stroke();

    // Document Meta
    doc
      .fontSize(14)
      .fillColor('#1e293b')
      .font('Helvetica-Bold')
      .text(options.title, 50, 115, { underline: true });

    doc
      .fontSize(9)
      .fillColor('#64748b')
      .font('Helvetica')
      .text(`Date: ${options.date}    |    Issued To: ${options.employeeName}`, 50, 135);

    // Document Body Content
    doc.fontSize(10).fillColor('#334155').font('Helvetica');
    let y = 165;

    const lines = htmlToPdfLines(renderedContent);
    for (const item of lines) {
      if (y > 750) {
        doc.addPage();
        y = 50;
      }

      if (item.isDivider) {
        doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(50, y).lineTo(545, y).stroke();
        y += 15;
      } else if (item.isHeader) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#0f172a');
        doc.text(item.text, 50, y, { width: 495 });
        y += doc.heightOfString(item.text, { width: 495 }) + 8;
        doc.fontSize(10).font('Helvetica').fillColor('#334155');
      } else if (item.text === '') {
        y += 10;
      } else {
        doc.text(item.text, 50, y, { width: 495, lineGap: 3 });
        y += doc.heightOfString(item.text, { width: 495, lineGap: 3 }) + 6;
      }
    }

    // --- Footer Signoff ---
    if (y > 680) {
      doc.addPage();
      y = 50;
    }
    y += 25;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b');
    doc.text(`For ${options.companyName}`, 50, y);
    y += 40;
    doc.fontSize(9).font('Helvetica').fillColor('#64748b');
    doc.text('Authorized Signatory', 50, y);
    doc.text('HR Operations', 50, y + 14);

    doc.end();

    writeStream.on('finish', () => resolve());
    writeStream.on('error', (err) => reject(err));
  });
}
