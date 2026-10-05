import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { internalError } from './errors';

/**
 * AGENTS.md §11 — field-level encryption for bank details and license keys
 * using AES-256-GCM (authenticated encryption).
 *
 * Stored payload format: `v1:<iv>:<authTag>:<ciphertext>` (all base64).
 * The version prefix allows future key rotation / algorithm changes.
 */
const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function fieldKey(): Buffer {
  if (cachedKey) return cachedKey;
  // env validation guarantees this, but assert defensively rather than let
  // crypto throw an opaque error.
  const key = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64');
  if (key.length !== KEY_BYTES) {
    throw internalError('Field encryption key must decode to 32 bytes');
  }
  cachedKey = key;
  return key;
}

/** Encrypt a sensitive value for storage. Never logged. */
export function encryptField(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw internalError('encryptField requires a non-empty string');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, fieldKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** Decrypt a stored value. Failures never reveal whether the payload existed. */
export function decryptField(payload: string): string {
  const parts = typeof payload === 'string' ? payload.split(':') : [];
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw internalError('Encrypted value is malformed');
  }

  const iv = Buffer.from(parts[1] as string, 'base64');
  const authTag = Buffer.from(parts[2] as string, 'base64');
  const ciphertext = Buffer.from(parts[3] as string, 'base64');

  try {
    const decipher = createDecipheriv(ALGORITHM, fieldKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Tampered or key-rotated payload. Deliberately opaque.
    throw internalError('Unable to decrypt stored value');
  }
}

export function isEncryptedPayload(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(`${VERSION}:`) &&
    value.split(':').length === 4
  );
}

/**
 * AGENTS.md §6 — refresh tokens are stored hashed, never in plaintext.
 * SHA-256 is appropriate here: the input is a high-entropy random token, not a
 * low-entropy password (bcrypt is used for passwords).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time string comparison. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Generate a cryptographically random, URL-safe opaque token. */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}