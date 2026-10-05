import { describe, expect, it } from 'vitest';
import {
  decryptField,
  encryptField,
  generateOpaqueToken,
  hashToken,
  isEncryptedPayload,
  safeCompare,
} from '../../src/utils/crypto';

/**
 * AGENTS.md §11 — field-level encryption (AES-256-GCM) for bank details and
 * licence keys, plus hashed refresh tokens.
 */
describe('field encryption', () => {
  it('round-trips a value', () => {
    const ciphertext = encryptField('4111111111111111');

    expect(ciphertext).not.toContain('4111111111111111');
    expect(decryptField(ciphertext)).toBe('4111111111111111');
  });

  it('uses a random IV so the same plaintext encrypts differently each time', () => {
    const first = encryptField('same-secret');
    const second = encryptField('same-secret');

    expect(first).not.toBe(second);
    expect(decryptField(first)).toBe('same-secret');
    expect(decryptField(second)).toBe('same-secret');
  });

  it('stores a versioned, pipe-delimited payload', () => {
    const ciphertext = encryptField('value');
    const parts = ciphertext.split(':');

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    // 12-byte IV and 16-byte GCM auth tag.
    expect(Buffer.from(parts[1] as string, 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[2] as string, 'base64')).toHaveLength(16);
  });

  it('handles unicode payloads', () => {
    const value = 'café — ₹1,20,000 / 日本語';
    expect(decryptField(encryptField(value))).toBe(value);
  });

  it('rejects a tampered ciphertext (authenticated encryption)', () => {
    const [version, iv, tag, ciphertext] = encryptField('sensitive').split(':');
    const flipped = `${(ciphertext as string).at(0) === 'A' ? 'B' : 'A'}${(ciphertext as string).slice(1)}`;

    expect(() => decryptField([version, iv, tag, flipped].join(':'))).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const [version, iv, , ciphertext] = encryptField('sensitive').split(':');
    const bogusTag = Buffer.alloc(16, 9).toString('base64');

    expect(() => decryptField([version, iv, bogusTag, ciphertext].join(':'))).toThrow();
  });

  it('rejects malformed and non-encrypted input', () => {
    expect(() => decryptField('not-encrypted')).toThrow();
    expect(() => decryptField('v1:only:three')).toThrow();
    expect(() => decryptField('v2:a:b:c')).toThrow();
    expect(() => decryptField('')).toThrow();
  });

  it('refuses to encrypt an empty string', () => {
    expect(() => encryptField('')).toThrow();
  });

  it('recognises only its own payload format', () => {
    expect(isEncryptedPayload(encryptField('x'))).toBe(true);
    expect(isEncryptedPayload('plain text')).toBe(false);
    expect(isEncryptedPayload('v1:a:b')).toBe(false);
    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload(12345)).toBe(false);
  });
});

describe('token hashing', () => {
  it('is deterministic and 64 hex characters (SHA-256)', () => {
    const hash = hashToken('refresh-token-value');

    expect(hash).toBe(hashToken('refresh-token-value'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('safeCompare', () => {
  it('matches identical strings and rejects everything else', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
    expect(safeCompare('abc', 'abd')).toBe(false);
    expect(safeCompare('abc', 'abcd')).toBe(false);
    expect(safeCompare('', '')).toBe(true);
  });
});

describe('generateOpaqueToken', () => {
  it('produces distinct URL-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateOpaqueToken()));

    expect(tokens.size).toBe(500);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});