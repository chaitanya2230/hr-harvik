import pino, { type Logger, type LoggerOptions } from 'pino';
import { env, isProduction } from '../config/env';

/**
 * AGENTS.md §2.16 / §11 — never expose bank details, license keys, passwords,
 * tokens or other secrets in logs. Redaction is centralised here so a new
 * module cannot accidentally start logging a secret.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.confirmPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.refreshTokenHash',
  '*.authorization',
  '*.accountNumber',
  '*.accountNumberEnc',
  '*.bankDetails',
  '*.bankDetails.*',
  '*.licenseKey',
  '*.licenseKeyRef',
  '*.smtpPass',
  '*.SMTP_PASS',
  '*.jwt',
  'password',
  'passwordHash',
  'body.password',
  'body.currentPassword',
  'body.newPassword',
  'body.refreshToken',
  'body.bankDetails',
  'body.accountNumber',
  'body.licenseKey',
];

export { redactPaths };

/** Shared option factory so tests can assert redaction using the real config. */
export function buildLoggerOptions(): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    base: { service: 'harvik-hr-api', env: env.NODE_ENV },
    redact: {
      paths: redactPaths,
      censor: '[REDACTED]',
    },
    // Keep timestamps UTC — AGENTS.md §11 requires all timestamps in UTC.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
}

export const logger: Logger = isProduction
  ? pino(buildLoggerOptions())
  : pino({
      ...buildLoggerOptions(),
      // Development-friendly single-line output without pulling in pino-pretty.
      mixin: () => ({ pid: undefined }),
    });

export const createLogger = (bindings: Record<string, unknown>): Logger =>
  logger.child(bindings);

/** Never log these values directly, even at debug level. */
export const SAFE_LOG_HINT =
  'Use logger.debug({ actorId, resourceId }) — never log credentials, tokens, bank details or license keys.';