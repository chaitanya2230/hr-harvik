import { trusted } from 'mongoose';

/**
 * Mark a server-constructed MongoDB filter fragment as trusted.
 *
 * P0 sets `sanitizeFilter: true` globally (`src/db/mongo.ts`), which wraps ANY
 * filter value containing `$` keys in `$eq` — including legitimate operators
 * (`$in`, `$gte`, `$ne`, …) that P0 itself never uses. Without this escape
 * hatch every range/membership query throws a CastError.
 *
 * This is safe precisely because the operators are hard-coded by the server:
 * user input only ever supplies scalar values that have already passed Zod
 * validation AND the `express-mongo-sanitize` middleware. Nothing client-
 * controlled reaches an operator position. See docs/DECISIONS.md D-27.
 *
 * Rule: wrap the operator-bearing value, never a whole filter that contains
 * user-supplied objects.
 */
export function trustedFilter<T>(fragment: T): T {
  return trusted(fragment);
}
