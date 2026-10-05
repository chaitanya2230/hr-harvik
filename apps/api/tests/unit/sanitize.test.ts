import { describe, expect, it } from 'vitest';
import { REDACTED, SENSITIVE_KEYS, redactSensitive } from '../../src/utils/sanitize';

/** AGENTS.md §2.16 / §11 — secrets must never reach logs or audit rows. */
describe('redactSensitive', () => {
  it('replaces sensitive keys at any depth', () => {
    const result = redactSensitive({
      email: 'hr@harviktech.com',
      password: 'Passw0rd!',
      nested: {
        accountNumber: '411111111111',
        accountNumberEnc: 'v1:iv:tag:ct',
        bankDetails: { bankName: 'HDFC', accountNumberEnc: 'v1:iv:tag:ct' },
      },
      list: [{ licenseKey: 'KEY-123', softwareName: 'GitHub' }],
    }) as {
      email: unknown;
      password: unknown;
      nested: { accountNumber: unknown; accountNumberEnc: unknown; bankDetails: unknown };
      list: Array<{ licenseKey: unknown; softwareName: unknown }>;
    };

    // Non-secret fields survive so the audit trail stays useful.
    expect(result.email).toBe('hr@harviktech.com');
    expect(result.list[0].softwareName).toBe('GitHub');

    // Leaf secrets are replaced value-wise.
    expect(result.password).toBe(REDACTED);
    expect(result.nested.accountNumber).toBe(REDACTED);
    expect(result.nested.accountNumberEnc).toBe(REDACTED);
    expect(result.list[0].licenseKey).toBe(REDACTED);

    // `bankDetails` is a container secret: the whole subtree goes, so a field
    // added under it later cannot start leaking by accident.
    expect(result.nested.bankDetails).toBe(REDACTED);
  });

  it('matches keys case-insensitively', () => {
    const result = redactSensitive({
      Password: 'x',
      passwordHash: 'y',
      REFRESHTOKEN: 'z',
    }) as Record<string, string>;

    expect(result.Password).toBe(REDACTED);
    expect(result.passwordHash).toBe(REDACTED);
    expect(result.REFRESHTOKEN).toBe(REDACTED);
  });

  it('serialises dates as ISO strings', () => {
    const result = redactSensitive({ at: new Date('2026-01-02T03:04:05.000Z') }) as Record<
      string,
      string
    >;

    expect(result.at).toBe('2026-01-02T03:04:05.000Z');
  });

  it('breaks cycles instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;

    const result = redactSensitive(cyclic) as Record<string, unknown>;

    expect(result.name).toBe('root');
    expect(result.self).toBe('[Circular]');
  });

  it('does not mutate the input', () => {
    const input = { password: 'secret', keep: 'me' };

    redactSensitive(input);

    expect(input.password).toBe('secret');
  });

  it('handles primitives and nullish values', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive('plain')).toBe('plain');
  });

  it('unwraps Mongoose-like documents via toObject()', () => {
    const fakeDoc = {
      toObject: () => ({ password: 'secret', name: 'Sneha' }),
    };

    expect(redactSensitive(fakeDoc)).toEqual({ password: REDACTED, name: 'Sneha' });
  });

  it('covers every secret class named in AGENTS.md', () => {
    for (const key of [
      'password',
      'passwordHash',
      'refreshToken',
      'authorization',
      'accountNumber',
      'bankDetails',
      'licenseKey',
    ]) {
      expect(SENSITIVE_KEYS.has(key.toLowerCase())).toBe(true);
    }
  });
});