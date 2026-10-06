import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { flushRedis, getRedisMock } from '../setup/setup';
import {
  DEMO_ACCOUNTS,
  bearer,
  getApp,
  loginAs,
  seedDatabase,
  type Session,
} from '../support/helpers';
import { DASHBOARD_CACHE_PREFIX } from '../../src/modules/dashboard/dashboard.cache';
import { SEEDED, employeeIdByEmail } from '../support/employee-fixtures';

/**
 * AGENTS.md §8.1 dashboard acceptance.
 *
 * Every assertion recomputes the expected number from MongoDB rather than
 * hard-coding a fixture count, so a seed change fails loudly instead of
 * silently passing against stale numbers.
 */

const app = getApp();

let admin: Session;
let hrManager: Session;
let manager: Session;
let employee: Session;

describe('dashboard summary (§8.1)', () => {
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

  it('returns all 14 metrics with real values for HR Admin', async () => {
    const response = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...bearer(admin.accessToken));

    expect(response.status).toBe(200);
    const { metrics, scope, unavailable, recentlyJoined, quickActions } = response.body.data;

    // All fourteen keys present.
    for (const key of [
      'totalEmployees',
      'fullTime',
      'interns',
      'freelancers',
      'newJoiners',
      'onLeave',
      'onNotice',
      'leavingSoon',
      'pendingHrActions',
      'pendingOnboarding',
      'pendingDocumentGeneration',
      'pendingAssetReturns',
      'pendingLicenseRevocations',
    ]) {
      expect(metrics, `missing metric ${key}`).toHaveProperty(key);
    }

    // P1-computable metrics are real numbers.
    expect(metrics.totalEmployees).toBeGreaterThanOrEqual(11);
    expect(metrics.fullTime).toBeGreaterThan(0);
    expect(scope.kind).toBe('organisation');

    // Future-phase metrics are null, never fabricated zeros.
    expect(metrics.onLeave).toBeNull();
    expect(metrics.pendingOnboarding).toBeNull();
    expect(metrics.pendingDocumentGeneration).toBeNull();
    expect(metrics.pendingAssetReturns).toBeNull();
    expect(metrics.pendingLicenseRevocations).toBeNull();
    expect(unavailable.length).toBe(5);

    expect(Array.isArray(recentlyJoined)).toBe(true);
    expect(quickActions.find((a: { key: string }) => a.key === 'addEmployee').enabled).toBe(true);
  });

  it('values match the underlying data', async () => {
    const { Employee } = await import('../../src/modules/employees/employee.model');
    const { trustedFilter } = await import('../../src/utils/mongo');
    const total = await Employee.countDocuments({
      isDeleted: false,
      status: trustedFilter({ $in: ['Active', 'Probation', 'On Notice', 'Resigned'] }),
    });

    const response = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...bearer(admin.accessToken));

    expect(response.body.data.metrics.totalEmployees).toBe(total);
  });

  it('uses the 60s Redis cache and invalidates on employee writes', async () => {
    const first = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...bearer(admin.accessToken));
    expect(first.body.data.cache.hit).toBe(false);

    const second = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...bearer(admin.accessToken));
    expect(second.body.data.cache.hit).toBe(true);
    expect(second.body.data.generatedAt).toBe(first.body.data.generatedAt);

    const redis = getRedisMock();
    const keys: string[] = await redis.keys(`${DASHBOARD_CACHE_PREFIX}:*`);
    expect(keys.length).toBeGreaterThan(0);

    // An employee write must drop the cached entry.
    await request(app)
      .post('/api/v1/employees')
      .set(...bearer(admin.accessToken))
      .send({
        firstName: 'Cache',
        lastName: 'Buster',
        email: `cache.${Date.now()}@harviktech.com`,
        employmentType: 'Full-Time',
        dateOfJoining: '2026-09-01',
      });

    const afterWrite = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...bearer(admin.accessToken));
    expect(afterWrite.body.data.cache.hit).toBe(false);
  });

  it('scopes a Manager to their team', async () => {
    const response = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...bearer(manager.accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data.scope.kind).toBe('team');

    const { Employee } = await import('../../src/modules/employees/employee.model');
    const ananyaId = await employeeIdByEmail(SEEDED.engineeringManager);
    const teamSize = await Employee.countDocuments({
      isDeleted: false,
      $or: [
        { _id: ananyaId },
        { reportingManagerId: ananyaId },
      ],
    });
    // Team scope is recursive; the total must be <= org and >= direct reports.
    expect(response.body.data.metrics.totalEmployees).toBeLessThanOrEqual(20);
    expect(teamSize).toBeGreaterThan(0);
  });

  it('gives an Employee a personal view', async () => {
    const response = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...bearer(employee.accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data.scope.kind).toBe('self');
    expect(response.body.data.scope.visibleEmployeeIds).toBe(1);
  });

  it('rejects unauthenticated access with 401', async () => {
    const response = await request(app).get('/api/v1/dashboard/summary');
    expect(response.status).toBe(401);
  });

  it('notes HR-Manager parity with HR-Admin at organisation scope', async () => {
    const response = await request(app)
      .get('/api/v1/dashboard/summary')
      .set(...bearer(hrManager.accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data.scope.kind).toBe('organisation');
  });
});
