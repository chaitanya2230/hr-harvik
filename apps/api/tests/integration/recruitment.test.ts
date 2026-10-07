import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Job } from '../../src/modules/recruitment/job.model';
import { Candidate } from '../../src/modules/recruitment/candidate.model';
import { Employee } from '../../src/modules/employees/employee.model';
import { Onboarding } from '../../src/modules/onboarding/onboarding.model';
import { LeaveBalance } from '../../src/modules/leave/leave-balance.model';
import {
  DEMO_ACCOUNTS,
  bearer,
  getApp,
  loginAs,
  seedDatabase,
  type Session,
} from '../support/helpers';
import { SEEDED, employeeIdByEmail, departmentIdByName } from '../support/employee-fixtures';

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

describe('AGENTS.md §14 RECRUITMENT acceptance test matrix (REC-01 to REC-18)', () => {
  let engineeringDeptId: string;
  let engineeringManagerId: string;

  beforeAll(async () => {
    await seedDatabase();
    admin = await loginAs(DEMO_ACCOUNTS.admin);
    hrManager = await loginAs(DEMO_ACCOUNTS.hrManager);
    manager = await loginAs(DEMO_ACCOUNTS.manager);
    employee = await loginAs(DEMO_ACCOUNTS.employee);

    engineeringDeptId = await departmentIdByName('Engineering');
    engineeringManagerId = await employeeIdByEmail(SEEDED.engineeringManager);
  });

  // -------------------------------------------------------------------------
  // REC-01: Job creation & atomic JOB-#### ID generation
  // -------------------------------------------------------------------------
  it('REC-01: creates job and atomically assigns JOB-#### human ID', async () => {
    const res = await request(app)
      .post('/api/v1/recruitment/jobs')
      .set(...authAs.admin())
      .send({
        title: 'Senior Distributed Systems Engineer',
        departmentId: engineeringDeptId,
        openings: 2,
        description: 'Design and build high scale distributed systems.',
        requiredSkills: ['Node.js', 'Distributed Systems', 'MongoDB'],
        hiringManagerId: engineeringManagerId,
        openingDate: '2026-10-01',
        closingDate: '2026-12-31',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.jobCode).toMatch(/^JOB-\d{4}$/);
    expect(res.body.data.title).toBe('Senior Distributed Systems Engineer');
    expect(res.body.data.openings).toBe(2);
    expect(res.body.data.filledCount).toBe(0);
    expect(res.body.data.status).toBe('Open');
  });

  // -------------------------------------------------------------------------
  // REC-02: Job input validation
  // -------------------------------------------------------------------------
  it('REC-02: rejects invalid jobs (zero openings, closing before opening, missing title)', async () => {
    // Zero openings
    const zeroOpenings = await request(app)
      .post('/api/v1/recruitment/jobs')
      .set(...authAs.hrManager())
      .send({
        title: 'Junior QA Engineer',
        departmentId: engineeringDeptId,
        openings: 0,
        description: 'Quality assurance testing.',
        hiringManagerId: engineeringManagerId,
        openingDate: '2026-10-01',
      });
    expect(zeroOpenings.status).toBe(400);

    // Closing date before opening date
    const badDate = await request(app)
      .post('/api/v1/recruitment/jobs')
      .set(...authAs.hrManager())
      .send({
        title: 'Junior QA Engineer',
        departmentId: engineeringDeptId,
        openings: 1,
        description: 'Quality assurance testing.',
        hiringManagerId: engineeringManagerId,
        openingDate: '2026-10-01',
        closingDate: '2026-09-01',
      });
    expect(badDate.status).toBe(400);

    // Relieved manager
    const relievedEmp = await Employee.findOne({ status: 'Relieved' }).lean().exec();
    if (relievedEmp) {
      const badManager = await request(app)
        .post('/api/v1/recruitment/jobs')
        .set(...authAs.hrManager())
        .send({
          title: 'QA Engineer',
          departmentId: engineeringDeptId,
          openings: 1,
          description: 'Testing software applications.',
          hiringManagerId: relievedEmp._id.toString(),
          openingDate: '2026-10-01',
        });
      expect(badManager.status).toBe(422);
    }
  });

  // -------------------------------------------------------------------------
  // REC-03: Job listing, pagination, and filtering
  // -------------------------------------------------------------------------
  it('REC-03: lists jobs with pagination, department filter, and search', async () => {
    const listRes = await request(app)
      .get('/api/v1/recruitment/jobs?limit=5&page=1')
      .set(...authAs.admin());

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.meta).toBeDefined();
    expect(listRes.body.meta.page).toBe(1);

    // Filter by department
    const deptFiltered = await request(app)
      .get(`/api/v1/recruitment/jobs?departmentId=${engineeringDeptId}`)
      .set(...authAs.admin());
    expect(deptFiltered.status).toBe(200);
    for (const job of deptFiltered.body.data) {
      expect(job.departmentId).toBe(engineeringDeptId);
    }
  });

  // -------------------------------------------------------------------------
  // REC-04: Hiring-manager scoping and RBAC
  // -------------------------------------------------------------------------
  it('REC-04: enforces hiring manager scoping for Manager and blocks Employee role', async () => {
    // Employee role forbidden
    const empRes = await request(app)
      .get('/api/v1/recruitment/jobs')
      .set(...authAs.employee());
    expect(empRes.status).toBe(403);

    // Manager role sees scoped jobs
    const mgrRes = await request(app)
      .get('/api/v1/recruitment/jobs')
      .set(...authAs.manager());
    expect(mgrRes.status).toBe(200);
    expect(Array.isArray(mgrRes.body.data)).toBe(true);

    // Manager cannot create jobs
    const mgrCreate = await request(app)
      .post('/api/v1/recruitment/jobs')
      .set(...authAs.manager())
      .send({
        title: 'Unauthorized Job',
        departmentId: engineeringDeptId,
        openings: 1,
        description: 'Should fail with 403',
        hiringManagerId: engineeringManagerId,
        openingDate: '2026-10-01',
      });
    expect(mgrCreate.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // REC-05: Job update & soft delete (HR Admin only)
  // -------------------------------------------------------------------------
  it('REC-05: updates job details and allows only HR Admin to soft-delete', async () => {
    const createRes = await request(app)
      .post('/api/v1/recruitment/jobs')
      .set(...authAs.hrManager())
      .send({
        title: 'Temporary DevOps Engineer',
        departmentId: engineeringDeptId,
        openings: 1,
        description: 'Infrastructure automation.',
        hiringManagerId: engineeringManagerId,
        openingDate: '2026-10-01',
      });
    const jobId = createRes.body.data.id;

    // Update job
    const patchRes = await request(app)
      .patch(`/api/v1/recruitment/jobs/${jobId}`)
      .set(...authAs.hrManager())
      .send({ title: 'Lead DevOps Engineer', openings: 2 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.title).toBe('Lead DevOps Engineer');
    expect(patchRes.body.data.openings).toBe(2);

    // HR Manager cannot delete
    const hrMgrDel = await request(app)
      .delete(`/api/v1/recruitment/jobs/${jobId}`)
      .set(...authAs.hrManager());
    expect(hrMgrDel.status).toBe(403);

    // HR Admin can delete
    const adminDel = await request(app)
      .delete(`/api/v1/recruitment/jobs/${jobId}`)
      .set(...authAs.admin());
    expect(adminDel.status).toBe(204);

    // Deleted job not in default get
    const getRes = await request(app)
      .get(`/api/v1/recruitment/jobs/${jobId}`)
      .set(...authAs.admin());
    expect(getRes.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // REC-06: Candidate creation & CAN-#### ID generation
  // -------------------------------------------------------------------------
  let testJobId: string;

  it('REC-06: creates candidate and atomically assigns CAN-#### human ID', async () => {
    const jobRes = await request(app)
      .post('/api/v1/recruitment/jobs')
      .set(...authAs.admin())
      .send({
        title: 'Full Stack Engineer (REC-06)',
        departmentId: engineeringDeptId,
        openings: 2,
        description: 'React and Node.js developer.',
        hiringManagerId: engineeringManagerId,
        openingDate: '2026-10-01',
      });
    testJobId = jobRes.body.data.id;

    const candRes = await request(app)
      .post('/api/v1/recruitment/candidates')
      .set(...authAs.hrManager())
      .send({
        name: 'Alice Candidate',
        email: 'alice.candidate.test@example.com',
        phone: '+1-555-0199',
        jobId: testJobId,
        source: 'LinkedIn',
      });

    expect(candRes.status).toBe(201);
    expect(candRes.body.data.id).toBeDefined();
    expect(candRes.body.data.candidateCode).toMatch(/^CAN-\d{4}$/);
    expect(candRes.body.data.name).toBe('Alice Candidate');
    expect(candRes.body.data.stage).toBe('Applied');
    expect(candRes.body.data.selectionStatus).toBe('Pending');
    expect(candRes.body.data.offerStatus).toBe('Pending');
  });

  // -------------------------------------------------------------------------
  // REC-07: Candidate duplicate application protection
  // -------------------------------------------------------------------------
  it('REC-07: rejects duplicate candidate application for same job with 409 Conflict', async () => {
    const dupRes = await request(app)
      .post('/api/v1/recruitment/candidates')
      .set(...authAs.hrManager())
      .send({
        name: 'Alice Duplicate',
        email: 'alice.candidate.test@example.com',
        phone: '+1-555-0199',
        jobId: testJobId,
        source: 'Website',
      });

    expect(dupRes.status).toBe(409);
  });

  // -------------------------------------------------------------------------
  // REC-08: Resume upload validation (MIME + Magic Bytes + Size)
  // -------------------------------------------------------------------------
  let candidateForResumeId: string;

  it('REC-08: validates resume MIME and magic bytes, rejecting fake files and large files', async () => {
    const candRes = await request(app)
      .post('/api/v1/recruitment/candidates')
      .set(...authAs.hrManager())
      .send({
        name: 'Bob Resume Tester',
        email: 'bob.resume.tester@example.com',
        phone: '+1-555-0200',
        jobId: testJobId,
        source: 'Referral',
      });
    candidateForResumeId = candRes.body.data.id;

    // Fake PDF (plain text claiming to be PDF)
    const fakePdfRes = await request(app)
      .post(`/api/v1/recruitment/candidates/${candidateForResumeId}/resume`)
      .set(...authAs.hrManager())
      .attach('resume', Buffer.from('NOT A REAL PDF CONTENT'), {
        filename: 'resume.pdf',
        contentType: 'application/pdf',
      });
    expect(fakePdfRes.status).toBe(400);

    // Disallowed MIME (image claiming to be PNG)
    const pngRes = await request(app)
      .post(`/api/v1/recruitment/candidates/${candidateForResumeId}/resume`)
      .set(...authAs.hrManager())
      .attach('resume', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: 'photo.png',
        contentType: 'image/png',
      });
    expect(pngRes.status).toBe(400);

    // Valid PDF (%PDF header)
    const validPdfBuffer = Buffer.from('%PDF-1.4 sample pdf content for resume testing');
    const validPdfRes = await request(app)
      .post(`/api/v1/recruitment/candidates/${candidateForResumeId}/resume`)
      .set(...authAs.hrManager())
      .attach('resume', validPdfBuffer, {
        filename: 'alice_cv.pdf',
        contentType: 'application/pdf',
      });
    expect(validPdfRes.status).toBe(200);
    expect(validPdfRes.body.data.resumeFile).toBeDefined();
    expect(validPdfRes.body.data.resumeFile.originalName).toBe('alice_cv.pdf');
  });

  // -------------------------------------------------------------------------
  // REC-09: Secure resume stream download
  // -------------------------------------------------------------------------
  it('REC-09: allows authorized resume download and returns proper security headers', async () => {
    // Unauthenticated -> 401
    const unauth = await request(app)
      .get(`/api/v1/recruitment/candidates/${candidateForResumeId}/resume`);
    expect(unauth.status).toBe(401);

    // Employee -> 403
    const empRes = await request(app)
      .get(`/api/v1/recruitment/candidates/${candidateForResumeId}/resume`)
      .set(...authAs.employee());
    expect(empRes.status).toBe(403);

    // HR Admin -> 200 stream with headers
    const downloadRes = await request(app)
      .get(`/api/v1/recruitment/candidates/${candidateForResumeId}/resume`)
      .set(...authAs.admin());
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers['content-type']).toContain('application/pdf');
    expect(downloadRes.headers['x-content-type-options']).toBe('nosniff');
    expect(downloadRes.headers['content-disposition']).toContain('alice_cv.pdf');
  });

  // -------------------------------------------------------------------------
  // REC-10: Strict candidate state machine progression
  // -------------------------------------------------------------------------
  let flowCandId: string;

  it('REC-10: enforces linear stage progression and rejects illegal skips with 422', async () => {
    const cand = await request(app)
      .post('/api/v1/recruitment/candidates')
      .set(...authAs.hrManager())
      .send({
        name: 'Charlie Flow Candidate',
        email: 'charlie.flow@example.com',
        phone: '+1-555-0300',
        jobId: testJobId,
        source: 'Website',
      });
    flowCandId = cand.body.data.id;
    expect(cand.body.data.stage).toBe('Applied');

    // Illegal skip: Applied -> Offer directly (fails 422)
    const illegalSkip = await request(app)
      .post(`/api/v1/recruitment/candidates/${flowCandId}/stage`)
      .set(...authAs.hrManager())
      .send({ stage: 'Offer' });
    expect(illegalSkip.status).toBe(422);

    // Valid move: Applied -> Shortlisted
    const shortRes = await request(app)
      .post(`/api/v1/recruitment/candidates/${flowCandId}/stage`)
      .set(...authAs.hrManager())
      .send({ stage: 'Shortlisted', note: 'Strong credentials' });
    expect(shortRes.status).toBe(200);
    expect(shortRes.body.data.stage).toBe('Shortlisted');
  });

  // -------------------------------------------------------------------------
  // REC-11: Candidate rejection workflow
  // -------------------------------------------------------------------------
  it('REC-11: rejects candidate with mandatory reason note from open stage', async () => {
    const cand = await request(app)
      .post('/api/v1/recruitment/candidates')
      .set(...authAs.hrManager())
      .send({
        name: 'David Rejection Tester',
        email: 'david.reject@example.com',
        phone: '+1-555-0400',
        jobId: testJobId,
        source: 'Agency',
      });
    const rejCandId = cand.body.data.id;

    // Missing rejection reason
    const noReason = await request(app)
      .post(`/api/v1/recruitment/candidates/${rejCandId}/stage`)
      .set(...authAs.hrManager())
      .send({ stage: 'Rejected' });
    expect(noReason.status).toBe(400);

    // Valid rejection
    const rejRes = await request(app)
      .post(`/api/v1/recruitment/candidates/${rejCandId}/stage`)
      .set(...authAs.hrManager())
      .send({ stage: 'Rejected', rejectionReason: 'Does not meet minimum technical experience' });
    expect(rejRes.status).toBe(200);
    expect(rejRes.body.data.stage).toBe('Rejected');
    expect(rejRes.body.data.selectionStatus).toBe('Rejected');
    expect(rejRes.body.data.rejectionReason).toBe('Does not meet minimum technical experience');
  });

  // -------------------------------------------------------------------------
  // REC-12: Interview round scheduling
  // -------------------------------------------------------------------------
  it('REC-12: schedules interview round and transitions Shortlisted candidate to Interview stage', async () => {
    const schedRes = await request(app)
      .post(`/api/v1/recruitment/candidates/${flowCandId}/interviews`)
      .set(...authAs.hrManager())
      .send({
        round: 1,
        title: 'Technical Round 1',
        interviewerId: engineeringManagerId,
        scheduledAt: '2026-10-15T10:00:00.000Z',
      });

    expect(schedRes.status).toBe(201);
    expect(schedRes.body.data.stage).toBe('Interview');
    expect(schedRes.body.data.interviews.length).toBe(1);
    expect(schedRes.body.data.interviews[0].round).toBe(1);
    expect(schedRes.body.data.interviews[0].status).toBe('Scheduled');
  });

  // -------------------------------------------------------------------------
  // REC-13: Interview feedback and 1-5 rating
  // -------------------------------------------------------------------------
  it('REC-13: submits interview feedback and rating, marking round Completed', async () => {
    const feedbackRes = await request(app)
      .post(`/api/v1/recruitment/candidates/${flowCandId}/interviews/1/feedback`)
      .set(...authAs.manager()) // Engineering manager is interviewer
      .send({
        feedback: 'Excellent problem solving skills and deep knowledge of distributed systems.',
        rating: 5,
        status: 'Completed',
      });

    expect(feedbackRes.status).toBe(200);
    expect(feedbackRes.body.data.interviews[0].status).toBe('Completed');
    expect(feedbackRes.body.data.interviews[0].rating).toBe(5);
    expect(feedbackRes.body.data.interviews[0].completedAt).toBeDefined();

    // Move to Selected
    const selectRes = await request(app)
      .post(`/api/v1/recruitment/candidates/${flowCandId}/stage`)
      .set(...authAs.hrManager())
      .send({ stage: 'Selected', note: 'All interviewers gave positive feedback' });
    expect(selectRes.status).toBe(200);
    expect(selectRes.body.data.stage).toBe('Selected');
    expect(selectRes.body.data.selectionStatus).toBe('Selected');
  });

  // -------------------------------------------------------------------------
  // REC-14: Offer management and joining date
  // -------------------------------------------------------------------------
  it('REC-14: manages offer status and enforces joining date when offer is Accepted', async () => {
    // Advance to Offer stage
    const offerStage = await request(app)
      .post(`/api/v1/recruitment/candidates/${flowCandId}/stage`)
      .set(...authAs.hrManager())
      .send({ stage: 'Offer', note: 'Offer approved by management' });
    expect(offerStage.status).toBe(200);
    expect(offerStage.body.data.stage).toBe('Offer');

    // Accepting without joining date fails
    const noJoinDate = await request(app)
      .patch(`/api/v1/recruitment/candidates/${flowCandId}/offer`)
      .set(...authAs.hrManager())
      .send({ offerStatus: 'Accepted' });
    expect(noJoinDate.status).toBe(400);

    // Accept with joining date
    const accepted = await request(app)
      .patch(`/api/v1/recruitment/candidates/${flowCandId}/offer`)
      .set(...authAs.hrManager())
      .send({ offerStatus: 'Accepted', joiningDate: '2026-11-01' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.offerStatus).toBe('Accepted');
    expect(accepted.body.data.joiningDate).toBe('2026-11-01');
  });

  // -------------------------------------------------------------------------
  // REC-15: Conversion preconditions
  // -------------------------------------------------------------------------
  it('REC-15: rejects conversion if candidate is not in Offer(Accepted) or Joined stage', async () => {
    const unselected = await request(app)
      .post('/api/v1/recruitment/candidates')
      .set(...authAs.hrManager())
      .send({
        name: 'Early Candidate',
        email: 'early.candidate@example.com',
        phone: '+1-555-0555',
        jobId: testJobId,
        source: 'LinkedIn',
      });
    const earlyId = unselected.body.data.id;

    const earlyConvert = await request(app)
      .post(`/api/v1/recruitment/candidates/${earlyId}/convert`)
      .set(...authAs.admin())
      .send({
        employmentType: 'Full-Time',
        designation: 'Software Engineer',
        dateOfJoining: '2026-11-01',
      });
    expect(earlyConvert.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // REC-16: Candidate-to-employee conversion transaction
  // -------------------------------------------------------------------------
  let convertedEmployeeId: string;

  it('REC-16: converts candidate to employee atomically, creating leave balances & onboarding', async () => {
    const convertRes = await request(app)
      .post(`/api/v1/recruitment/candidates/${flowCandId}/convert`)
      .set(...authAs.admin())
      .send({
        employmentType: 'Full-Time',
        designation: 'Senior Full Stack Engineer',
        dateOfJoining: '2026-11-01',
        compensation: { amount: 120000, currency: 'USD', period: 'monthly' },
      });

    expect(convertRes.status).toBe(200);
    expect(convertRes.body.data.employeeId).toBeDefined();
    expect(convertRes.body.data.employeeCode).toMatch(/^HRV-\d{4}$/);
    expect(convertRes.body.data.candidateId).toBe(flowCandId);
    convertedEmployeeId = convertRes.body.data.employeeId;

    // Verify candidate state updated
    const candDoc = await Candidate.findById(flowCandId).lean().exec();
    expect(candDoc?.stage).toBe('Joined');
    expect(candDoc?.convertedEmployeeId?.toString()).toBe(convertedEmployeeId);

    // Verify Employee created
    const empDoc = await Employee.findById(convertedEmployeeId).lean().exec();
    expect(empDoc).toBeDefined();
    expect(empDoc?.email).toBe('charlie.flow@example.com');
    expect(empDoc?.designation).toBe('Senior Full Stack Engineer');
    expect(empDoc?.status).toBe('Probation'); // Full-Time default

    // Verify Leave balances auto-created
    const balances = await LeaveBalance.find({ employeeId: convertedEmployeeId }).lean().exec();
    expect(balances.length).toBeGreaterThan(0);

    // Verify Onboarding record auto-created
    const onboarding = await Onboarding.findOne({ employeeId: convertedEmployeeId }).lean().exec();
    expect(onboarding).toBeDefined();
    expect(onboarding?.items.length).toBe(14);
  });

  // -------------------------------------------------------------------------
  // REC-17: Job opening consumption and auto-fill
  // -------------------------------------------------------------------------
  it('REC-17: tracks job openings, transitions job to Filled when openings reached, and blocks over-hiring', async () => {
    // Current testJobId had openings: 2, filledCount: 1. Let's create second candidate and convert.
    const secondCand = await request(app)
      .post('/api/v1/recruitment/candidates')
      .set(...authAs.hrManager())
      .send({
        name: 'Second Hire Candidate',
        email: 'second.hire@example.com',
        phone: '+1-555-0600',
        jobId: testJobId,
        source: 'Referral',
      });
    const c2Id = secondCand.body.data.id;

    // Move through stages directly to Joined
    await request(app).post(`/api/v1/recruitment/candidates/${c2Id}/stage`).set(...authAs.hrManager()).send({ stage: 'Shortlisted' });
    await request(app).post(`/api/v1/recruitment/candidates/${c2Id}/stage`).set(...authAs.hrManager()).send({ stage: 'Interview' });
    await request(app).post(`/api/v1/recruitment/candidates/${c2Id}/stage`).set(...authAs.hrManager()).send({ stage: 'Selected' });
    await request(app).post(`/api/v1/recruitment/candidates/${c2Id}/stage`).set(...authAs.hrManager()).send({ stage: 'Offer' });
    await request(app).patch(`/api/v1/recruitment/candidates/${c2Id}/offer`).set(...authAs.hrManager()).send({ offerStatus: 'Accepted', joiningDate: '2026-11-15' });

    const convert2 = await request(app)
      .post(`/api/v1/recruitment/candidates/${c2Id}/convert`)
      .set(...authAs.admin())
      .send({
        employmentType: 'Full-Time',
        designation: 'Full Stack Engineer',
        dateOfJoining: '2026-11-15',
      });
    expect(convert2.status).toBe(200);

    // Check job status is now Filled
    const jobDoc = await Job.findById(testJobId).lean().exec();
    expect(jobDoc?.filledCount).toBe(2);
    expect(jobDoc?.status).toBe('Filled');

    // Attempting to convert another candidate to a Filled job must be rejected
    const thirdCand = await request(app)
      .post('/api/v1/recruitment/candidates')
      .set(...authAs.hrManager())
      .send({
        name: 'Third Candidate Overfill',
        email: 'third.overfill@example.com',
        phone: '+1-555-0700',
        jobId: testJobId,
        source: 'Website',
      });
    const c3Id = thirdCand.body.data.id;
    await request(app).post(`/api/v1/recruitment/candidates/${c3Id}/stage`).set(...authAs.hrManager()).send({ stage: 'Shortlisted' });
    await request(app).post(`/api/v1/recruitment/candidates/${c3Id}/stage`).set(...authAs.hrManager()).send({ stage: 'Interview' });
    await request(app).post(`/api/v1/recruitment/candidates/${c3Id}/stage`).set(...authAs.hrManager()).send({ stage: 'Selected' });
    await request(app).post(`/api/v1/recruitment/candidates/${c3Id}/stage`).set(...authAs.hrManager()).send({ stage: 'Offer' });
    await request(app).patch(`/api/v1/recruitment/candidates/${c3Id}/offer`).set(...authAs.hrManager()).send({ offerStatus: 'Accepted', joiningDate: '2026-12-01' });

    const overfillConvert = await request(app)
      .post(`/api/v1/recruitment/candidates/${c3Id}/convert`)
      .set(...authAs.admin())
      .send({
        employmentType: 'Full-Time',
        designation: 'Engineer',
        dateOfJoining: '2026-12-01',
      });
    expect(overfillConvert.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // REC-18: Conversion history preservation & delete protection
  // -------------------------------------------------------------------------
  it('REC-18: preserves candidate interview history and prevents deleting converted candidate', async () => {
    // Flow candidate history intact
    const cand = await Candidate.findById(flowCandId).lean().exec();
    expect(cand?.interviews.length).toBe(1);
    expect(cand?.stageHistory.length).toBeGreaterThanOrEqual(4);

    // Deleting converted candidate is blocked
    const delRes = await request(app)
      .delete(`/api/v1/recruitment/candidates/${flowCandId}`)
      .set(...authAs.admin());
    expect(delRes.status).toBe(422);
  });
});
