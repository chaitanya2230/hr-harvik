import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getApp, loginAs, bearer } from '../support/helpers';
import { runSeed } from '../../src/seed';
import { connectMongo, disconnectMongo } from '../../src/db/mongo';

describe('Reports Integration Tests (REP-01 .. REP-12)', () => {
  let adminToken: string;
  let hrManagerToken: string;
  let managerToken: string;
  let employeeToken: string;

  beforeAll(async () => {
    await connectMongo();
    await runSeed();

    const admin = await loginAs('admin@harviktech.com');
    adminToken = admin.accessToken;

    const hrManager = await loginAs('hrmanager@harviktech.com');
    hrManagerToken = hrManager.accessToken;

    const manager = await loginAs('manager@harviktech.com');
    managerToken = manager.accessToken;

    const emp = await loginAs('employee@harviktech.com');
    employeeToken = emp.accessToken;
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  // REP-01: Employee report JSON & CSV
  it('REP-01: HR Admin can get Employee report JSON and CSV export', async () => {
    const resJson = await request(getApp())
      .get('/api/v1/reports/employees')
      .set(...bearer(adminToken));

    expect(resJson.status).toBe(200);
    expect(resJson.body.data).toBeInstanceOf(Array);
    expect(resJson.body.data.length).toBeGreaterThan(0);
    expect(resJson.body.meta.columns).toBeInstanceOf(Array);

    // Verify bank details are NOT in any row
    for (const row of resJson.body.data) {
      expect(row.accountNumberEnc).toBeUndefined();
      expect(row.bankDetails).toBeUndefined();
      expect(row.accountNumber).toBeUndefined();
    }

    // CSV export
    const resCsv = await request(getApp())
      .get('/api/v1/reports/employees/export?format=csv')
      .set(...bearer(adminToken));

    expect(resCsv.status).toBe(200);
    expect(resCsv.headers['content-type']).toContain('text/csv');
    expect(resCsv.text).toContain('Employee Code');
    expect(resCsv.text).toContain('HRV-');
    expect(resCsv.text).not.toContain('accountNumberEnc');
  });

  // REP-02: New joiner report
  it('REP-02: New joiner report returns recent joiners within date range', async () => {
    const res = await request(getApp())
      .get('/api/v1/reports/new-joiners')
      .set(...bearer(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.meta.title).toBe('New Joiners Report');
  });

  // REP-03: Attendance report & XLSX export
  it('REP-03: Attendance report supports XLSX format export', async () => {
    const res = await request(getApp())
      .get('/api/v1/reports/attendance/export?format=xlsx')
      .set(...bearer(adminToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // Binary payloads need an explicit parser: supertest leaves res.body empty otherwise.
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(100);
    // XLSX files are ZIP archives — magic bytes 'PK'.
    expect((res.body as Buffer).subarray(0, 2).toString('ascii')).toBe('PK');
  });

  // REP-04: Cost report RBAC (HR Admin / HR Manager only)
  it('REP-04: Cost report is allowed for HR Admin & HR Manager, but 403 Forbidden for Manager & Employee', async () => {
    // HR Admin -> 200
    const resAdmin = await request(getApp())
      .get('/api/v1/reports/cost-summary')
      .set(...bearer(adminToken));
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.data).toBeInstanceOf(Array);
    expect(resAdmin.body.meta.totalMonthlyCost).toBeDefined();

    // HR Manager -> 200
    const resHrMgr = await request(getApp())
      .get('/api/v1/reports/cost-summary')
      .set(...bearer(hrManagerToken));
    expect(resHrMgr.status).toBe(200);

    // Manager -> 403
    const resMgr = await request(getApp())
      .get('/api/v1/reports/cost-summary')
      .set(...bearer(managerToken));
    expect(resMgr.status).toBe(403);

    // Employee -> 403
    const resEmp = await request(getApp())
      .get('/api/v1/reports/cost-summary')
      .set(...bearer(employeeToken));
    expect(resEmp.status).toBe(403);
  });

  // REP-05: Department-wise employee headcount report
  it('REP-05: Department counts report provides breakdown by employment type and status', async () => {
    type DepartmentCountRow = {
      departmentName: string;
      totalCount: number;
      fullTime: number;
    };

    const res = await request(getApp())
      .get('/api/v1/reports/department-counts')
      .set(...bearer(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThan(0);
    const engineering = (res.body.data as DepartmentCountRow[]).find(
      (d) => d.departmentName === 'Engineering',
    );
    expect(engineering).toBeDefined();
    if (!engineering) throw new Error('Engineering department row missing');
    expect(engineering.totalCount).toBeGreaterThanOrEqual(0);
    expect(engineering.fullTime).toBeDefined();
  });

  // REP-06: Manager leave report scoping
  it('REP-06: Manager can access leave reports scoped to their hierarchy, but regular Employee is forbidden', async () => {
    const resMgr = await request(getApp())
      .get('/api/v1/reports/leave')
      .set(...bearer(managerToken));

    expect(resMgr.status).toBe(200);
    expect(resMgr.body.data).toBeInstanceOf(Array);

    const resEmp = await request(getApp())
      .get('/api/v1/reports/leave')
      .set(...bearer(employeeToken));

    expect(resEmp.status).toBe(403);
  });

  // REP-07: Pending asset returns report
  it('REP-07: Pending asset returns report includes outstanding items', async () => {
    const res = await request(getApp())
      .get('/api/v1/reports/pending-asset-returns')
      .set(...bearer(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });

  // REP-08: Pending license revocations report
  it('REP-08: Pending license revocations report identifies licenses held by notice/relieved employees', async () => {
    const res = await request(getApp())
      .get('/api/v1/reports/pending-license-revocations')
      .set(...bearer(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });

  // REP-09: Software / license report hides secrets
  it('REP-09: Software license report never exposes license keys or passwords', async () => {
    const res = await request(getApp())
      .get('/api/v1/reports/licenses')
      .set(...bearer(adminToken));

    expect(res.status).toBe(200);
    for (const lic of res.body.data) {
      expect(lic.licenseKeyRef).toBeUndefined();
      expect(lic.licenseKey).toBeUndefined();
      expect(lic.key).toBeUndefined();
    }
  });

  // REP-10: Large export queued with async=true
  it('REP-10: Large export can be queued asynchronously returning 202 and jobId', async () => {
    const res = await request(getApp())
      .get('/api/v1/reports/employees/export?format=csv&async=true')
      .set(...bearer(adminToken));

    expect(res.status).toBe(202);
    expect(res.body.data.jobId).toBeDefined();
    expect(res.body.data.status).toBe('queued');

    const jobId = res.body.data.jobId;
    const statusRes = await request(getApp())
      .get(`/api/v1/reports/exports/${jobId}`)
      .set(...bearer(adminToken));

    expect(statusRes.status).toBe(200);
    expect(['pending', 'completed']).toContain(statusRes.body.data.status);
  });

  // REP-11: Unknown report returns 404
  it('REP-11: Requesting an unknown report type returns 400 validation or 404', async () => {
    const res = await request(getApp())
      .get('/api/v1/reports/unknown-non-existent-report')
      .set(...bearer(adminToken));

    expect([400, 404]).toContain(res.status);
  });

  // REP-12: Unauthenticated report request returns 401
  it('REP-12: Unauthenticated request to reports returns 401', async () => {
    const res = await request(getApp()).get('/api/v1/reports/employees');
    expect(res.status).toBe(401);
  });

  // REP-13: JSON report honours server-side pagination
  it('REP-13: Employee report JSON honours page/limit pagination metadata', async () => {
    const res = await request(getApp())
      .get('/api/v1/reports/employees?page=2&limit=3')
      .set(...bearer(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
    expect(res.body.meta.page).toBe(2);
    expect(res.body.meta.limit).toBe(3);
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.meta.totalPages).toBeGreaterThan(0);
  });

  // REP-14: Export job lifecycle — 404 for unknown, 403 for foreign owner,
  // completed CSV downloadable by the owner
  it('REP-14: Export job poll/download enforces ownership and 404s unknown job ids', async () => {
    // Unknown job id -> 404
    const missing = await request(getApp())
      .get('/api/v1/reports/exports/export_does_not_exist')
      .set(...bearer(adminToken));
    expect(missing.status).toBe(404);

    // Queue a job as the admin, poll as a different (non-Admin) user -> 403
    const queued = await request(getApp())
      .get('/api/v1/reports/employees/export?format=csv&async=true')
      .set(...bearer(adminToken));
    expect(queued.status).toBe(202);
    const jobId = queued.body.data.jobId;

    const foreign = await request(getApp())
      .get(`/api/v1/reports/exports/${jobId}`)
      .set(...bearer(hrManagerToken));
    expect(foreign.status).toBe(403);

    // Owner polls and (when the job reached a terminal state) downloads CSV
    const poll = await request(getApp())
      .get(`/api/v1/reports/exports/${jobId}`)
      .set(...bearer(adminToken));
    expect(poll.status).toBe(200);
    expect(['pending', 'completed']).toContain(poll.body.data.status);

    if (poll.body.data.status === 'completed') {
      const download = await request(getApp())
        .get(`/api/v1/reports/exports/${jobId}?download=true`)
        .set(...bearer(adminToken));
      expect(download.status).toBe(200);
      expect(download.headers['content-type']).toContain('text/csv');
      expect(download.text).toContain('Employee Code');
    }
  });
});
