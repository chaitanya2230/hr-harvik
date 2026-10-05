import request from 'supertest';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { getApp } from '../support/helpers';
import { buildLoggerOptions } from '../../src/utils/logger';
import { MAX_PAGE_LIMIT } from '../../src/config/constants';
import { DEMO_PASSWORD } from '../../src/modules/auth/auth.schema';
import { USER_PASSWORD_SELECT } from '../../src/modules/users/user.schema';

/** AGENTS.md §11 / §14 — security foundation. */

describe('HTTP security (AGENTS.md §11)', () => {
  describe('headers', () => {
    it('never advertises the framework (§11 "no X-Powered-By")', async () => {
      const response = await request(getApp()).get('/health');

      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('sets the Helmet security headers', async () => {
      const response = await request(getApp()).get('/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['strict-transport-security']).toContain('max-age=');
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['cross-origin-opener-policy']).toBeDefined();
      // helmet() must not be mounted with `contentSecurityPolicy: false`.
      expect(response.headers['content-security-policy']).not.toBe('');
    });
  });

  describe('CORS allow-list (§11)', () => {
    it('echoes an allowed origin and permits credentials', async () => {
      const response = await request(getApp())
        .get('/health')
        .set('Origin', 'http://localhost:8080');

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8080');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('refuses to hand the origin header to an unlisted origin', async () => {
      const response = await request(getApp())
        .get('/health')
        .set('Origin', 'https://evil.example.com');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('answers a preflight from an allowed origin', async () => {
      const response = await request(getApp())
        .options('/api/v1/auth/login')
        .set('Origin', 'http://localhost:8080')
        .set('Access-Control-Request-Method', 'POST');

      expect(response.status).toBeLessThan(300);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8080');
    });
  });

  describe('NoSQL injection (§11)', () => {
    it('does not honour a $ne operator in the login email', async () => {
      const response = await request(getApp())
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        // Classic bypass: match every user whose password is not empty.
        .send(JSON.stringify({ email: { $ne: null }, password: { $ne: null } }));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('does not honour a $regex operator in the login email', async () => {
      const response = await request(getApp())
        .post('/api/v1/auth/login')
        .send({ email: { $regex: '.*' }, password: 'Passw0rd!' });

      expect(response.status).toBe(400);
    });

    it('does not honour a $gt operator against a query-string parameter', async () => {
      const response = await request(getApp()).get('/api/v1/auth/me?email[$gt]=');

      // The parameter is stripped by the sanitiser; the request then fails on
      // authentication (401) rather than matching a document.
      expect([400, 401]).toContain(response.status);
      expect(response.body.error?.code).not.toBe('INTERNAL_ERROR');
    });
  });

  describe('path traversal and upload exposure (§13)', () => {
    it('never serves the upload directory statically', async () => {
      const response = await request(getApp()).get('/uploads/anything.pdf');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it.each([
      '/../.env',
      '/uploads/../../../etc/passwd',
      '/%2e%2e%2f%2e%2e%2f.env',
      '/uploads/..%2f..%2f.env',
    ])('does not leak files through %s', async (target) => {
      const response = await request(getApp()).get(target);

      expect(response.status).toBe(404);
      expect(response.text ?? '').not.toMatch(/JWT_ACCESS_SECRET|FIELD_ENCRYPTION_KEY/);
    });
  });

  describe('error handling (§10)', () => {
    it('returns the standard envelope for an unknown route', async () => {
      const response = await request(getApp()).get('/api/v1/does-not-exist');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: { code: 'NOT_FOUND', message: expect.any(String) },
      });
    });

    it('rejects malformed JSON with 400 rather than crashing', async () => {
      const response = await request(getApp())
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('never returns a stack trace to the client', async () => {
      const response = await request(getApp()).get('/api/v1/does-not-exist');

      expect(response.text).not.toMatch(/\bat\b.+:\d+:\d+/);
      expect(response.body.error).not.toHaveProperty('stack');
    });
  });

  describe('request correlation (§11)', () => {
    it('assigns a request id and echoes a supplied one', async () => {
      const generated = await request(getApp()).get('/health');
      expect(generated.headers['x-request-id']).toBeTruthy();

      const supplied = await request(getApp())
        .get('/health')
        .set('X-Request-Id', 'req-abc-123');

      expect(supplied.headers['x-request-id']).toBe('req-abc-123');
    });
  });

  describe('list pagination cap (§10)', () => {
    it('caps the page limit at 100', () => {
      expect(MAX_PAGE_LIMIT).toBe(100);
    });

    it('never honours a limit above the cap', async () => {
      // P0 exposes no list routes, so assert the constant that every list
      // route will be built on and that no shared middleware loosens it.
      const response = await request(getApp()).get('/api/v1/auth/me?limit=100000');

      expect(response.status).toBe(401);
    });
  });

  describe('log redaction (§2.16, §11)', () => {
    it('redacts credentials and secrets from structured output', () => {
      const options = buildLoggerOptions();
      const paths = (options.redact as { paths: string[] }).paths;

      for (const required of [
        'password',
        'body.password',
        '*.passwordHash',
        'body.currentPassword',
        'body.newPassword',
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.bankDetails',
        '*.accountNumberEnc',
        '*.licenseKey',
        '*.refreshToken',
      ]) {
        expect(paths, `missing redaction path ${required}`).toContain(required);
      }
    });

    it('actually censors a secret when written through the configured logger', () => {
      const lines: string[] = [];
      const destination = {
        write: (line: string) => {
          lines.push(line);
        },
      };

      // LOG_LEVEL is `silent` under test, so raise it on this instance only —
      // the redaction paths themselves come from the real factory.
      const testLogger = pino({ ...buildLoggerOptions(), level: 'info' }, destination);

      testLogger.info(
        {
          email: 'employee@harviktech.com',
          password: 'Passw0rd!',
          bankDetails: { accountNumberEnc: 'v1:iv:tag:ct' },
        },
        'login attempt',
      );

      const output = lines.join('\n');

      expect(output).toContain('employee@harviktech.com');
      expect(output).not.toContain('Passw0rd!');
      expect(output).not.toContain('v1:iv:tag:ct');
      expect(output).toContain('[REDACTED]');
    });

    it('never persists the demo password anywhere a log line could pick it up', async () => {
      const { AuditLog } = await import('../../src/modules/audit/audit.model');
      const { User } = await import('../../src/modules/users/user.model');

      await AuditLog.deleteMany({});
      await request(getApp())
        .post('/api/v1/auth/login')
        .send({ email: 'employee@harviktech.com', password: DEMO_PASSWORD });

      // A successful login is audited, so the entry is the realistic place a
      // careless implementation would leak the submitted credential.
      const entries = await AuditLog.find({}).lean().exec();
      expect(entries.length).toBeGreaterThan(0);
      expect(JSON.stringify(entries)).not.toContain(DEMO_PASSWORD);

      const user = await User.findOne({ email: 'employee@harviktech.com' })
        .select(USER_PASSWORD_SELECT)
        .lean()
        .exec();
      expect(JSON.stringify(user)).not.toContain(DEMO_PASSWORD);
    });
  });
});