import 'dotenv/config';
import { z } from 'zod';

/** Treat empty-string env vars as "not provided" so optional SMTP settings can stay blank. */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** Must decode to exactly 32 bytes so it can be used as an AES-256 key. */
const isBase64_32Bytes = (value: string): boolean => {
  try {
    const buf = Buffer.from(value, 'base64');
    if (buf.length !== 32) return false;
    // Reject values that are not canonically encoded base64 of 32 bytes.
    return buf.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '').trim();
  } catch {
    return false;
  }
};

/**
 * AGENTS.md §2.7 — never hardcode secrets. Any secret still carrying the
 * `.env.example` placeholder must fail fast rather than boot insecurely.
 */
const PLACEHOLDERS = new Set(['change_me', 'base64_32_bytes']);

const secretField = (name: string, minLength: number) =>
  z
    .string()
    .refine((v) => !PLACEHOLDERS.has(v.trim()), {
      message: `${name} is still the .env.example placeholder — generate a real secret`,
    })
    .refine((v) => v.trim().length >= minLength, {
      message: `${name} must be at least ${minLength} characters`,
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),

  // --- Data stores ---
  MONGO_URI: z
    .string()
    .min(1, 'MONGO_URI is required')
    .refine((v) => v.startsWith('mongodb'), { message: 'MONGO_URI must start with mongodb://' }),
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required')
    .refine((v) => v.startsWith('redis'), { message: 'REDIS_URL must start with redis://' }),

  // --- JWT ---
  JWT_ACCESS_SECRET: secretField('JWT_ACCESS_SECRET', 32),
  JWT_REFRESH_SECRET: secretField('JWT_REFRESH_SECRET', 32),
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),
  JWT_REFRESH_TTL: z.string().min(1).default('7d'),

  // --- Field-level encryption ---
  FIELD_ENCRYPTION_KEY: z.string().refine(isBase64_32Bytes, {
    message:
      'FIELD_ENCRYPTION_KEY must be a base64 string that decodes to exactly 32 bytes (AES-256-GCM). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
  }),

  // --- Uploads ---
  UPLOAD_DIR: z.string().min(1).default('/data/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),

  // --- Mail (blank => console/log transport) ---
  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  SMTP_USER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SMTP_PASS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MAIL_FROM: z.string().min(3).default('hr@harviktech.com'),

  // --- Web ---
  APP_BASE_URL: z.string().url('APP_BASE_URL must be a valid URL').default('http://localhost:8080'),
  CORS_ORIGINS: z
    .string()
    .min(1)
    .default('http://localhost:8080,http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // --- Observability ---
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  /**
   * Number of trusted reverse-proxy hops in front of the API. Needed so that
   * rate limiting keys off the real client IP (AGENTS.md §11) rather than the
   * nginx container address. Set to 0 when the API is exposed directly.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

  // --- Company settings defaults ---
  COMPANY_TIMEZONE: z.string().min(1).default('Asia/Kolkata'),
  COMPANY_NAME: z.string().min(1).default('Harvik Technologies'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `Invalid environment configuration. Copy .env.example to .env and fix:\n${details}\n`,
  );
}

export const env = result.data;

export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';