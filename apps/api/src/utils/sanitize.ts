/**
 * Recursively strip secret fields before anything is written to an audit log
 * or a log line.
 *
 * AGENTS.md §2.16 / §11 — never expose bank details, license keys, passwords,
 * tokens or other secrets.
 *
 * Keys are treated in two ways:
 *  - a *container* secret such as `bankDetails` replaces the entire subtree, so
 *    a field added to that object later cannot silently start leaking;
 *  - a *leaf* secret such as `password` or `accountNumberEnc` replaces just
 *    that value, keeping the surrounding record useful.
 */
export const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'refreshtokenhash',
  'authorization',
  'cookie',
  'jwt',
  'secret',
  'smtppass',
  'accountnumber',
  'accountnumberenc',
  'bankdetails',
  'licensekey',
  'licensekeyref',
  'fieldencryptionkey',
]);

export const REDACTED = '[REDACTED]';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Deep-clone `value`, replacing sensitive keys with `[REDACTED]`.
 * Cycles are broken with a `[Circular]` marker. Dates become ISO strings.
 */
export function redactSensitive<T>(value: T): unknown {
  const seen = new WeakSet<object>();

  const walk = (input: unknown): unknown => {
    if (input === null || input === undefined) return input;
    if (input instanceof Date) return input.toISOString();
    if (typeof input === 'bigint') return input.toString();

    if (Array.isArray(input)) return input.map(walk);

    if (input instanceof Object) {
      if (seen.has(input)) return '[Circular]';
      seen.add(input);

      // Mongoose documents expose their data via toObject().
      const source = typeof (input as { toObject?: () => unknown }).toObject === 'function'
        ? ((input as { toObject: () => unknown }).toObject() as unknown)
        : input;

      if (isPlainObject(source)) {
        const output: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(source)) {
          output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : walk(child);
        }
        return output;
      }
      return String(source);
    }

    return input;
  };

  return walk(value);
}