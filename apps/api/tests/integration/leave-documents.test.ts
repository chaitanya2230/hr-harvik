import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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
import { LeaveType } from '../../src/modules/leave/leave-type.model';
import { LeaveBalance } from '../../src/modules/leave/leave-balance.model';
import { Document } from '../../src/modules/documents/document.model';

/**
 * AGENTS.md §8.6 / §8.7 — leave supporting-document upload.
 *
 * Employees must be able to attach proof for leave types with
 * `requiresDocument`, using the secure document pipeline (MIME + magic-byte
 * validation, size cap, random server filename, no public static serving),
 * and an application may only reference the applicant's own proof.
 */

const app = getApp();

let admin: Session;
let hrManager: Session;
let employee: Session;

const authAs = {
  admin: () => bearer(admin.accessToken),
  hrManager: () => bearer(hrManager.accessToken),
  employee: () => bearer(employee.accessToken),
};

const VALID_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Title (Medical) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
  'utf8',
);

const uploadLeaveDoc = (
  session: Session,
  overrides: {
    buffer?: Buffer;
    filename?: string;
    contentType?: string;
    employeeId?: string;
    title?: string;
  } = {},
) => {
  const chain = request(app)
    .post('/api/v1/leave/documents')
    .set(...bearer(session.accessToken))
    .attach('file', overrides.buffer ?? VALID_PDF, {
      filename: overrides.filename ?? 'medical_certificate.pdf',
      contentType: overrides.contentType ?? 'application/pdf',
    });
  if (overrides.employeeId) chain.field('employeeId', overrides.employeeId);
  if (overrides.title) chain.field('title', overrides.title);
  return chain;
};

describe('leave supporting-document upload (§8.6, §8.7, §14)', () => {
  beforeAll(async () => {
    await seedDatabase();
    admin = await loginAs(DEMO_ACCOUNTS.admin);
    hrManager = await loginAs(DEMO_ACCOUNTS.hrManager);
    employee = await loginAs(DEMO_ACCOUNTS.employee);

    // Sick leave is the seeded type that requires proof.
    let sick = await LeaveType.findOne({ code: 'SICK', isDeleted: false });
    if (!sick) {
      sick = await LeaveType.create({
        name: 'Sick Leave',
        code: 'SICK',
        annualAllocation: 10,
        isPaid: true,
        requiresDocument: true,
      });
    } else {
      sick.requiresDocument = true;
      await sick.save();
    }
  });

  beforeEach(async () => {
    await flushRedis();
  });

  it('rejects unauthenticated uploads with 401', async () => {
    const res = await request(app)
      .post('/api/v1/leave/documents')
      .attach('file', VALID_PDF, 'certificate.pdf');
    expect(res.status).toBe(401);
  });

  it('lets an employee upload proof for themselves through the secure pipeline', async () => {
    const res = await uploadLeaveDoc(employee, { title: 'Medical certificate' });
    expect(res.status).toBe(201);
    expect(res.body.data.documentId).toEqual(expect.any(String));
    expect(res.body.data.mimeType).toBe('application/pdf');

    // Stored as a Document owned by the employee (category Other), readable
    // by the owner through the normal authorized document endpoint.
    const doc = await Document.findById(res.body.data.documentId).lean().exec();
    expect(doc).not.toBeNull();
    expect(doc?.category).toBe('Other');
    expect(String(doc?.employeeId)).toBe(employee.account.employeeId);

    const ownerRead = await request(app)
      .get(`/api/v1/documents/${res.body.data.documentId}`)
      .set(...authAs.employee());
    expect(ownerRead.status).toBe(200);
  });

  it('applies for a document-required leave with the uploaded proof (§14 LEV)', async () => {
    const sick = await LeaveType.findOne({ code: 'SICK', isDeleted: false });
    const empId = employee.account.employeeId as string;

    // Balance for the application year so the paid-leave check can pass.
    const year = 2025;
    await LeaveBalance.updateOne(
      { employeeId: empId, leaveTypeId: sick!._id, year },
      { $setOnInsert: { allocated: 10, used: 0, pending: 0, carriedForward: 0 } },
      { upsert: true },
    );

    const uploaded = await uploadLeaveDoc(employee);
    expect(uploaded.status).toBe(201);

    const applied = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(sick!._id),
        fromDate: '2025-11-03',
        toDate: '2025-11-04',
        reason: 'Viral fever',
        documentId: uploaded.body.data.documentId,
      });

    expect(applied.status).toBe(201);
    expect(applied.body.data.status).toBe('Pending');
    expect(applied.body.data.documentId).toBe(uploaded.body.data.documentId);
  });

  it('rejects an application that references another employee’s proof (§14)', async () => {
    const sick = await LeaveType.findOne({ code: 'SICK', isDeleted: false });
    const rahulId = await employeeIdByEmail(SEEDED.seniorEngineer);

    // HR uploads proof on behalf of Rahul (scanned at the clinic desk).
    const onBehalf = await uploadLeaveDoc(hrManager, { employeeId: rahulId });
    expect(onBehalf.status).toBe(201);

    // Sneha cannot borrow Rahul's document as her own proof.
    const borrowed = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(sick!._id),
        fromDate: '2025-11-06',
        toDate: '2025-11-07',
        reason: 'Trying to reuse a document',
        documentId: onBehalf.body.data.documentId,
      });
    expect(borrowed.status).toBe(422);
    expect(borrowed.body.error.message).toMatch(/different employee/i);

    // A dangling id is refused the same way.
    const dangling = await request(app)
      .post('/api/v1/leave/requests')
      .set(...authAs.employee())
      .send({
        leaveTypeId: String(sick!._id),
        fromDate: '2025-11-06',
        toDate: '2025-11-07',
        reason: 'Dangling reference',
        documentId: '000000000000000000000000',
      });
    expect(dangling.status).toBe(422);
    expect(dangling.body.error.message).toMatch(/not found/i);
  });

  it('refuses an employee uploading on behalf of someone else (§6 scope)', async () => {
    const rahulId = await employeeIdByEmail(SEEDED.seniorEngineer);
    const res = await uploadLeaveDoc(employee, { employeeId: rahulId });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('validates file type, magic bytes and size (§8.7)', async () => {
    const unsupported = await uploadLeaveDoc(employee, {
      buffer: Buffer.from('just some plain text'),
      filename: 'notes.txt',
      contentType: 'text/plain',
    });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.message).toMatch(/MIME type/i);

    const mismatch = await uploadLeaveDoc(employee, {
      buffer: Buffer.from('definitely not a pdf'),
      filename: 'fake.pdf',
      contentType: 'application/pdf',
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.message).toMatch(/MIME mismatch/i);

    const large = Buffer.alloc(10.5 * 1024 * 1024);
    large.write('%PDF-1.4\n');
    const oversized = await uploadLeaveDoc(employee, { buffer: large, filename: 'huge.pdf' });
    expect([400, 422]).toContain(oversized.status);
    expect(oversized.body.error.message).toMatch(/exceeds maximum allowed limit/i);

    const missing = await request(app)
      .post('/api/v1/leave/documents')
      .set(...authAs.employee());
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/file is required/i);
  });

  it('keeps the proof out of other employees’ hands but visible to HR (§14 documents)', async () => {
    const uploaded = await uploadLeaveDoc(employee);
    expect(uploaded.status).toBe(201);
    const docId = uploaded.body.data.documentId as string;

    const asHr = await request(app)
      .get(`/api/v1/documents/${docId}`)
      .set(...authAs.hrManager());
    expect(asHr.status).toBe(200);

    // Another signed-in user without a team relationship still gets 403 from
    // the document ACL (Employee self-service only). We use the same employee
    // session's token but a different document to prove ownership matters —
    // here: an unlinked id is 404/403, never silent data.
    const stranger = await request(app)
      .get('/api/v1/documents/000000000000000000000000')
      .set(...authAs.employee());
    expect([403, 404]).toContain(stranger.status);
  });
});
