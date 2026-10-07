import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Exit } from '../../src/modules/exit/exit.model';
import { flushRedis } from '../setup/setup';
import {
  DEMO_ACCOUNTS,
  bearer,
  getApp,
  loginAs,
  seedDatabase,
  type Session,
} from '../support/helpers';
import { SEEDED, employeeIdByEmail } from '../support/employee-fixtures';

const app = getApp();

let admin: Session;
let hrManager: Session;
let manager: Session;
let employee: Session;

const authAs = {
  admin: () => bearer(admin.accessToken),
  hrManager: () => bearer(hrManager.accessToken),
  manager: () => bearer(manager.accessToken),
  employee: () => bearer(employee.accessToken),
};

// Sample valid PDF buffer (%PDF-1.4 header)
const VALID_PDF_BUFFER = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Title (Test) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
);

// Sample valid PNG buffer (magic bytes 89 50 4E 47 0D 0A 1A 0A)
const VALID_PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);

describe('AGENTS.md §14 — DOCUMENTS', () => {
  beforeAll(async () => {
    await seedDatabase();
    admin = await loginAs(DEMO_ACCOUNTS.admin);
    hrManager = await loginAs(DEMO_ACCOUNTS.hrManager);
    manager = await loginAs(DEMO_ACCOUNTS.manager);
    employee = await loginAs(DEMO_ACCOUNTS.employee);
  });

  beforeEach(async () => {
    await flushRedis();
  });

  it('valid upload — uploads document and stores metadata correctly', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    const res = await request(app)
      .post('/api/v1/documents')
      .set(...authAs.hrManager())
      .field('employeeId', targetEmployeeId)
      .field('category', 'Offer Letter')
      .field('title', 'Signed Offer Letter')
      .field('confidential', 'false')
      .attach('file', VALID_PDF_BUFFER, 'signed_offer.pdf');

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      employeeId: targetEmployeeId,
      category: 'Offer Letter',
      title: 'Signed Offer Letter',
      version: 1,
      source: 'Uploaded',
      confidential: false,
    });
    expect(res.body.data.file.filename).toBeDefined();
    expect(res.body.data.file.originalName).toBe('signed_offer.pdf');
    expect(res.body.data.file.mimeType).toBe('application/pdf');
  });

  it('MIME mismatch rejected — rejects file whose content contradicts declared MIME', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);
    // Plain text buffer declaring application/pdf
    const invalidBuffer = Buffer.from('This is not a real PDF file');

    const res = await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .field('employeeId', targetEmployeeId)
      .field('category', 'Agreement')
      .field('title', 'Bogus Agreement')
      .attach('file', invalidBuffer, {
        filename: 'bogus.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/MIME mismatch/i);
  });

  it('>10MB rejected — rejects upload exceeding MAX_UPLOAD_MB limit', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);
    // Create an oversized buffer slightly > 10 MB (10.5 MB)
    const largeBuffer = Buffer.alloc(10.5 * 1024 * 1024);
    // Prefix with PDF header so it's not rejected by signature check first
    largeBuffer.write('%PDF-1.4\n');

    const res = await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .field('employeeId', targetEmployeeId)
      .field('category', 'Agreement')
      .field('title', 'Massive File')
      .attach('file', largeBuffer, 'huge.pdf');

    expect([400, 422]).toContain(res.status);
    expect(res.body.error.message).toMatch(/exceeds maximum allowed limit/i);
  });

  it('versioning — incrementing version and linking previousVersionId on new version upload', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    // Initial version
    const v1Res = await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .field('employeeId', targetEmployeeId)
      .field('category', 'NDA')
      .field('title', 'Non-Disclosure Agreement')
      .attach('file', VALID_PDF_BUFFER, 'nda_v1.pdf');

    expect(v1Res.status).toBe(201);
    const v1Id = v1Res.body.data.id;
    expect(v1Res.body.data.version).toBe(1);

    // Upload version 2
    const v2Res = await request(app)
      .post(`/api/v1/documents/${v1Id}/versions`)
      .set(...authAs.admin())
      .field('title', 'Non-Disclosure Agreement (Rev 2)')
      .attach('file', VALID_PDF_BUFFER, 'nda_v2.pdf');

    expect(v2Res.status).toBe(201);
    expect(v2Res.body.data.version).toBe(2);
    expect(v2Res.body.data.previousVersionId).toBe(v1Id);
    expect(v2Res.body.data.title).toBe('Non-Disclosure Agreement (Rev 2)');
  });

  it('owner can access own document — employee can download their own document', async () => {
    const empUserEmployeeId = employee.account.employeeId!;

    // Admin uploads document for this employee
    const uploadRes = await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .field('employeeId', empUserEmployeeId)
      .field('category', 'Appraisal')
      .field('title', 'Self Appraisal')
      .field('confidential', 'false')
      .attach('file', VALID_PDF_BUFFER, 'appraisal.pdf');

    expect(uploadRes.status).toBe(201);
    const docId = uploadRes.body.data.id;

    // Employee accesses own metadata
    const metaRes = await request(app)
      .get(`/api/v1/documents/${docId}`)
      .set(...authAs.employee());
    expect(metaRes.status).toBe(200);
    expect(metaRes.body.data.id).toBe(docId);

    // Employee downloads own file
    const fileRes = await request(app)
      .get(`/api/v1/documents/${docId}/file`)
      .set(...authAs.employee());
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('other employee cannot — employee gets 403 when trying to access another employee document', async () => {
    // Target is intern (different employee from demo employee)
    const targetEmployeeId = await employeeIdByEmail(SEEDED.intern);

    const uploadRes = await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .field('employeeId', targetEmployeeId)
      .field('category', 'Education')
      .field('title', 'Degree Certificate')
      .field('confidential', 'false')
      .attach('file', VALID_PDF_BUFFER, 'degree.pdf');

    expect(uploadRes.status).toBe(201);
    const docId = uploadRes.body.data.id;

    // Demo employee attempts to access target document
    const getRes = await request(app)
      .get(`/api/v1/documents/${docId}`)
      .set(...authAs.employee());
    expect(getRes.status).toBe(403);

    const downloadRes = await request(app)
      .get(`/api/v1/documents/${docId}/file`)
      .set(...authAs.employee());
    expect(downloadRes.status).toBe(403);
  });

  it('confidential document protected — employee and manager cannot access confidential document', async () => {
    const empUserEmployeeId = employee.account.employeeId!;

    // Upload confidential document for the employee
    const uploadRes = await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .field('employeeId', empUserEmployeeId)
      .field('category', 'Appraisal')
      .field('title', 'Confidential Performance Review')
      .field('confidential', 'true')
      .attach('file', VALID_PDF_BUFFER, 'review.pdf');

    expect(uploadRes.status).toBe(201);
    const docId = uploadRes.body.data.id;

    // Owner employee tries to access confidential doc -> 403
    const empRes = await request(app)
      .get(`/api/v1/documents/${docId}`)
      .set(...authAs.employee());
    expect(empRes.status).toBe(403);

    // Manager tries to access confidential doc -> 403
    const mgrRes = await request(app)
      .get(`/api/v1/documents/${docId}`)
      .set(...authAs.manager());
    expect(mgrRes.status).toBe(403);

    // HR Manager can access confidential doc -> 200
    const hrRes = await request(app)
      .get(`/api/v1/documents/${docId}`)
      .set(...authAs.hrManager());
    expect(hrRes.status).toBe(200);
  });

  it('direct upload URL inaccessible — unauthenticated request is rejected', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    const uploadRes = await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .field('employeeId', targetEmployeeId)
      .field('category', 'Other')
      .field('title', 'Public Test')
      .attach('file', VALID_PDF_BUFFER, 'test.pdf');

    const docId = uploadRes.body.data.id;

    // No authorization header
    const res = await request(app).get(`/api/v1/documents/${docId}/file`);
    expect(res.status).toBe(401);
  });

  it('filter works — documents list respects category and search filters', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .field('employeeId', targetEmployeeId)
      .field('category', 'Identity')
      .field('title', 'Passport Copy')
      .attach('file', VALID_PNG_BUFFER, 'passport.png');

    const listRes = await request(app)
      .get(`/api/v1/documents?category=Identity&search=Passport`)
      .set(...authAs.admin());

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body.data[0].category).toBe('Identity');
    expect(listRes.body.data[0].title).toContain('Passport');
  });

  it('expiry tracked — documents filterable by expiry date', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .field('employeeId', targetEmployeeId)
      .field('category', 'Agreement')
      .field('title', 'Expiring Agreement')
      .field('expiryDate', '2025-06-30')
      .attach('file', VALID_PDF_BUFFER, 'contract.pdf');

    const listRes = await request(app)
      .get('/api/v1/documents?expiringBefore=2025-07-01')
      .set(...authAs.admin());

    expect(listRes.status).toBe(200);
    const expiring = listRes.body.data.find(
      (d: { title: string }) => d.title === 'Expiring Agreement',
    );
    expect(expiring).toBeDefined();
    expect(expiring.expiryDate).toBe('2025-06-30');
  });

  it('template preview — preview renders compiled HTML with employee context', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    // Create a template
    const templateRes = await request(app)
      .post('/api/v1/document-templates')
      .set(...authAs.admin())
      .send({
        name: `Preview Test Template ${Date.now()}`,
        category: 'Offer Letter',
        applicableEmploymentTypes: ['Full-Time'],
        bodyHtml:
          '<h1>Offer Letter</h1><p>Dear {{employee.firstName}} {{employee.lastName}}, welcome to {{company.name}} as {{employee.designation}}.</p>',
      });

    expect(templateRes.status).toBe(201);
    const templateId = templateRes.body.data.id;

    // Preview
    const previewRes = await request(app)
      .post(`/api/v1/document-templates/${templateId}/preview`)
      .set(...authAs.hrManager())
      .send({ employeeId: targetEmployeeId });

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.data.renderedHtml).toContain('Dear Sneha Patil');
    expect(previewRes.body.data.renderedHtml).toContain('Harvik Technologies');
  });

  it('missing template fields rejected — rejects preview or generation if template tokens are missing', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    // Template referencing a non-existent employee property
    const templateRes = await request(app)
      .post('/api/v1/document-templates')
      .set(...authAs.admin())
      .send({
        name: `Missing Field Template ${Date.now()}`,
        category: 'Other',
        applicableEmploymentTypes: ['Full-Time'],
        bodyHtml: '<p>Passport number is {{employee.nonExistentField}}</p>',
      });

    expect(templateRes.status).toBe(201);
    const templateId = templateRes.body.data.id;

    const previewRes = await request(app)
      .post(`/api/v1/document-templates/${templateId}/preview`)
      .set(...authAs.admin())
      .send({ employeeId: targetEmployeeId });

    expect(previewRes.status).toBe(422);
    expect(previewRes.body.error.message).toMatch(/missing employee or company fields/i);
  });

  it('valid PDF generated — compiles template to valid PDF file on disk and creates document record', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    const templateRes = await request(app)
      .post('/api/v1/document-templates')
      .set(...authAs.admin())
      .send({
        name: `Full-Time Offer ${Date.now()}`,
        category: 'Offer Letter',
        applicableEmploymentTypes: ['Full-Time'],
        bodyHtml:
          '<h2>Employment Offer</h2><p>This is to confirm that {{employee.fullName}} is hired as {{employee.designation}} starting {{employee.dateOfJoining}}.</p>',
      });

    const templateId = templateRes.body.data.id;

    const genRes = await request(app)
      .post(`/api/v1/document-templates/${templateId}/generate`)
      .set(...authAs.hrManager())
      .send({ employeeId: targetEmployeeId, title: 'Official Offer Letter' });

    expect(genRes.status).toBe(201);
    expect(genRes.body.data.source).toBe('Generated');
    expect(genRes.body.data.templateId).toBe(templateId);
    expect(genRes.body.data.file.mimeType).toBe('application/pdf');

    // Verify downloaded file is a valid PDF
    const fileRes = await request(app)
      .get(`/api/v1/documents/${genRes.body.data.id}/file`)
      .set(...authAs.admin())
      .responseType('blob');

    expect(fileRes.status).toBe(200);
    expect(fileRes.headers['content-type']).toMatch(/application\/pdf/);
    const buffer = Buffer.from(fileRes.body);
    // PDF magic bytes %PDF-
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('queued generation (mode=queued) returns 202 + jobId and exposes a pollable status; results are ownership-scoped', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    const templateRes = await request(app)
      .post('/api/v1/document-templates')
      .set(...authAs.admin())
      .send({
        name: `Queued Offer ${Date.now()}`,
        category: 'Offer Letter',
        applicableEmploymentTypes: ['Full-Time'],
        bodyHtml:
          '<h2>Employment Offer</h2><p>This is to confirm that {{employee.fullName}} is hired as {{employee.designation}}.</p>',
      });

    const templateId = templateRes.body.data.id;

    const queueRes = await request(app)
      .post(`/api/v1/document-templates/${templateId}/generate`)
      .set(...authAs.hrManager())
      .send({ employeeId: targetEmployeeId, mode: 'queued' });

    expect(queueRes.status).toBe(202);
    expect(queueRes.body.data.status).toBe('pending');
    expect(queueRes.body.data.jobId).toBeDefined();

    const jobId = queueRes.body.data.jobId;

    // Job status is pollable; in the test env there may or may not be a live
    // queue, so the terminal state may already be reached (inline fallback).
    const statusRes = await request(app)
      .get(`/api/v1/documents/pdf-jobs/${jobId}`)
      .set(...authAs.hrManager());

    expect(statusRes.status).toBe(200);
    expect(['pending', 'completed']).toContain(statusRes.body.data.status);
    if (statusRes.body.data.status === 'completed') {
      expect(statusRes.body.data.documentId).toBeDefined();
    }

    // Ownership is enforced: a different user cannot read someone else's job.
    const otherUserRes = await request(app)
      .get(`/api/v1/documents/pdf-jobs/${jobId}`)
      .set(...authAs.employee());

    expect(otherUserRes.status).toBe(403);

    // Unknown job id → 404.
    const missingRes = await request(app)
      .get('/api/v1/documents/pdf-jobs/does-not-exist')
      .set(...authAs.admin());

    expect(missingRes.status).toBe(404);
  });

  it('employment-type mismatch rejected — rejects generation when employee employmentType does not match template', async () => {
    // softwareEngineer is Full-Time
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    const templateRes = await request(app)
      .post('/api/v1/document-templates')
      .set(...authAs.admin())
      .send({
        name: `Internship Agreement ${Date.now()}`,
        category: 'Agreement',
        applicableEmploymentTypes: ['Intern'],
        bodyHtml: '<p>Internship for {{employee.firstName}}</p>',
      });

    const templateId = templateRes.body.data.id;

    const genRes = await request(app)
      .post(`/api/v1/document-templates/${templateId}/generate`)
      .set(...authAs.admin())
      .send({ employeeId: targetEmployeeId });

    expect(genRes.status).toBe(422);
    expect(genRes.body.error.message).toMatch(/mismatch/i);
  });

  it('Experience Certificate restricted to On Notice/Relieved — Active employee is rejected, On Notice employee succeeds', async () => {
    const activeEmpId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const seniorEngId = await employeeIdByEmail(SEEDED.seniorEngineer);

    const templateRes = await request(app)
      .post('/api/v1/document-templates')
      .set(...authAs.admin())
      .send({
        name: `Experience Certificate Template ${Date.now()}`,
        category: 'Experience Certificate',
        applicableEmploymentTypes: ['Full-Time'],
        bodyHtml:
          '<p>This certifies {{employee.fullName}} worked as {{employee.designation}} from {{employee.dateOfJoining}} to {{today}}.</p>',
      });

    const templateId = templateRes.body.data.id;

    // 1. activeEmp is Active -> rejected with 422
    const failRes = await request(app)
      .post(`/api/v1/document-templates/${templateId}/generate`)
      .set(...authAs.admin())
      .send({ employeeId: activeEmpId });

    expect(failRes.status).toBe(422);
    expect(failRes.body.error.message).toMatch(
      /Experience Certificate can only be generated for employees who are 'On Notice' or 'Relieved'/i,
    );

    // 2. Put seniorEng On Notice
    await request(app)
      .post(`/api/v1/employees/${seniorEngId}/status`)
      .set(...authAs.admin())
      .send({ status: 'On Notice', reason: 'Resignation accepted' });

    // 3. seniorEng is On Notice -> succeeds with 201
    const successRes = await request(app)
      .post(`/api/v1/document-templates/${templateId}/generate`)
      .set(...authAs.admin())
      .send({ employeeId: seniorEngId });

    expect(successRes.status).toBe(201);
    expect(successRes.body.data.category).toBe('Experience Certificate');

    // 4. Verifies exit checklist integration: Experience letter item completed
    const exit = await Exit.findOne({ employeeId: seniorEngId, isDeleted: false }).lean().exec();
    if (exit) {
      expect(String(exit.experienceLetterDocId)).toBe(successRes.body.data.id);
      const item = exit.checklist.find((c) => c.id === 'doc-experience');
      expect(item?.status).toBe('Completed');
    }
  });

  it('history works — returns complete version history chain in order', async () => {
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);

    // Upload v1
    const v1Res = await request(app)
      .post('/api/v1/documents')
      .set(...authAs.admin())
      .field('employeeId', targetEmployeeId)
      .field('category', 'Other')
      .field('title', 'Policy v1')
      .attach('file', VALID_PDF_BUFFER, 'policy_v1.pdf');

    const v1Id = v1Res.body.data.id;

    // Upload v2
    const v2Res = await request(app)
      .post(`/api/v1/documents/${v1Id}/versions`)
      .set(...authAs.admin())
      .field('title', 'Policy v2')
      .attach('file', VALID_PDF_BUFFER, 'policy_v2.pdf');

    const v2Id = v2Res.body.data.id;

    // Query history for either document in chain
    const histRes = await request(app)
      .get(`/api/v1/documents/${v2Id}/history`)
      .set(...authAs.admin());

    expect(histRes.status).toBe(200);
    expect(histRes.body.data.length).toBe(2);
    expect(histRes.body.data[0].version).toBe(1);
    expect(histRes.body.data[1].version).toBe(2);
  });

  it('unsafe HTML sanitized — script tags are stripped while preserving safe markup', async () => {
    const templateRes = await request(app)
      .post('/api/v1/document-templates')
      .set(...authAs.admin())
      .send({
        name: `XSS Sanitization Template ${Date.now()}`,
        category: 'NDA',
        applicableEmploymentTypes: ['Full-Time'],
        bodyHtml:
          '<script>alert("xss")</script><h2>Safe Title</h2><p onclick="steal()">Safe Content for {{employee.firstName}}</p>',
      });

    expect(templateRes.status).toBe(201);
    const bodyHtml = templateRes.body.data.bodyHtml;
    expect(bodyHtml).not.toContain('<script>');
    expect(bodyHtml).not.toContain('alert');
    expect(bodyHtml).not.toContain('onclick');
    expect(bodyHtml).toContain('<h2>Safe Title</h2>');
    expect(bodyHtml).toContain('Safe Content for {{employee.firstName}}');
  });

  it('employee-controlled values cannot execute in preview — interpolated markup is escaped end to end', async () => {
    // A hostile designation stored on the employee record must render inert.
    const targetEmployeeId = await employeeIdByEmail(SEEDED.softwareEngineer);
    const hostile = 'Engineer <script>alert("xss")</script><img src=x onerror=alert(1)>';

    const updateRes = await request(app)
      .patch(`/api/v1/employees/${targetEmployeeId}`)
      .set(...authAs.admin())
      .send({ designation: hostile });
    expect(updateRes.status).toBe(200);

    try {
      const templateRes = await request(app)
        .post('/api/v1/document-templates')
        .set(...authAs.admin())
        .send({
          name: `XSS Interpolation Template ${Date.now()}`,
          category: 'Offer Letter',
          applicableEmploymentTypes: ['Full-Time'],
          bodyHtml:
            '<h1>Offer</h1><p>Dear {{employee.firstName}}, your role is {{employee.designation}}.</p>',
        });
      expect(templateRes.status).toBe(201);

      const previewRes = await request(app)
        .post(`/api/v1/document-templates/${templateRes.body.data.id}/preview`)
        .set(...authAs.admin())
        .send({ employeeId: targetEmployeeId });

      expect(previewRes.status).toBe(200);
      const html = previewRes.body.data.renderedHtml as string;
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<img');
      expect(html).not.toMatch(/<[^>]*\bonerror\b/);
      // Content is preserved as inert escaped text, and the page still renders.
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('<h1>Offer</h1>');
    } finally {
      // Restore the seeded designation so later suites see canonical data.
      await request(app)
        .patch(`/api/v1/employees/${targetEmployeeId}`)
        .set(...authAs.admin())
        .send({ designation: 'Software Engineer' });
    }
  });
});
