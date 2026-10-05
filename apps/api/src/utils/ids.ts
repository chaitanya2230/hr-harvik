import { ID_PREFIXES, ID_SEQUENCE_WIDTH, type IdPrefixKey } from '../config/constants';
import { Counter } from '../modules/counters/counter.model';
import { internalError } from './errors';

/**
 * AGENTS.md §7 — human-readable IDs are generated atomically through a
 * counters collection:
 *   Employee HRV-0001 | Asset AST-0001 | Job JOB-0001 | License LIC-0001 | Candidate CAN-0001
 */

const MAX_UPSERT_RETRIES = 3;

export function formatHumanId(prefix: string, seq: number, width: number = ID_SEQUENCE_WIDTH): string {
  return `${prefix}-${String(seq).padStart(width, '0')}`;
}

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

/**
 * `$inc` on a single counter document is atomic in MongoDB, so concurrent
 * callers can never receive the same sequence number.
 */
export async function nextSequence(key: IdPrefixKey | string): Promise<number> {
  for (let attempt = 0; attempt < MAX_UPSERT_RETRIES; attempt += 1) {
    try {
      const doc = await Counter.findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
        .lean()
        .exec();

      if (doc) return doc.seq;
    } catch (error) {
      // Two concurrent upserts can collide on the unique _id; the loser retries
      // and now matches the already-created document.
      if (!isDuplicateKey(error)) {
        throw internalError(`Unable to allocate sequence "${key}"`);
      }
    }
  }

  throw internalError(`Unable to allocate sequence "${key}" after ${MAX_UPSERT_RETRIES} attempts`);
}

export async function nextHumanId(key: IdPrefixKey): Promise<string> {
  return formatHumanId(ID_PREFIXES[key], await nextSequence(key));
}

/** Current high-water mark without consuming a number. Used by tests/seed. */
export async function peekSequence(key: IdPrefixKey | string): Promise<number> {
  const doc = await Counter.findById(key).lean().exec();
  return doc?.seq ?? 0;
}