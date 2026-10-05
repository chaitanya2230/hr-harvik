/**
 * Test environment variables.
 *
 * This module must run BEFORE anything under `src/` is imported, because
 * `src/config/env.ts` validates `process.env` at import time and throws on a
 * missing/placeholder secret. Keep this file free of `src` imports.
 *
 * Import order matters: `tests/setup/setup.ts` imports this module first.
 */

// Provided by tests/setup/global-setup.ts (real mongod 7.x replica set).
if (!process.env.MONGO_URI) {
  process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/harvik_hr_test?replicaSet=rs0';
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '4001',

  REDIS_URL: 'redis://127.0.0.1:6379',

  // Real-looking, >= 32 chars, and NOT the .env.example placeholders, so the
  // same validation production runs is exercised here.
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-definitely-long-enough-0123456789',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-definitely-long-enough-9876543210',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',

  // Canonical base64 of exactly 32 bytes.
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),

  UPLOAD_DIR: 'C:/Users/CHAITANYA/AppData/Local/Temp/opencode/harvik-test-uploads',
  MAX_UPLOAD_MB: '10',

  SMTP_HOST: '',
  SMTP_PORT: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  MAIL_FROM: 'hr@harviktech.com',

  APP_BASE_URL: 'http://localhost:8080',
  CORS_ORIGINS: 'http://localhost:8080,http://localhost:5173',

  LOG_LEVEL: 'silent',

  // Trust exactly one proxy hop so tests can vary the effective client IP via
  // `X-Forwarded-For`. The per-IP login limiter (5/min) must not be shared by
  // every test in the run, otherwise one suite's deliberate failures starve the
  // next request with RATE_LIMITED.
  TRUST_PROXY_HOPS: '1',

  COMPANY_TIMEZONE: 'Asia/Kolkata',
  COMPANY_NAME: 'Harvik Technologies',
});