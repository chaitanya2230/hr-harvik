import { Types } from 'mongoose';
import { env } from '../../config/env';
import { SystemSettings } from './settings.model';
import type { SystemSettingsDoc } from './settings.schema';

/**
 * Runtime view of the system settings row — always fully populated, either
 * from MongoDB or from the `.env` defaults when no row exists yet.
 */
export interface SystemSettings {
  companyName: string;
  timezone: string;
  minAgeIntern: number;
  minAgeOther: number;
  probationDefault: boolean;
}

/**
 * Cache TTL. The API and the worker are separate processes, so a write in
 * one process is picked up by the other within one minute even without an
 * explicit cross-process invalidation hook.
 */
const CACHE_TTL_MS = 60_000;

let cache: { value: SystemSettings; expiresAt: number } | null = null;

/** AGENTS.md §5 — `.env` defaults keep an un-seeded database behaving as before. */
export function settingsDefaultsFromEnv(): SystemSettings {
  return {
    companyName: env.COMPANY_NAME,
    timezone: env.COMPANY_TIMEZONE,
    minAgeIntern: 16,
    minAgeOther: 18,
    probationDefault: true,
  };
}

const toSettings = (doc: SystemSettingsDoc): SystemSettings => ({
  companyName: doc.companyName,
  timezone: doc.timezone,
  minAgeIntern: doc.minAgeIntern,
  minAgeOther: doc.minAgeOther,
  probationDefault: doc.probationDefault,
});

/**
 * Read the settings row (cached for 60s). Importers that must stay
 * synchronous — `utils/dates.todayInTimeZone`, the PDF template context —
 * use {@link getSettingsSnapshot} instead.
 */
export async function getSettings(): Promise<SystemSettings> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  const doc = await SystemSettings.findOne({ key: 'system', isDeleted: false }).lean();
  const value = doc ? toSettings(doc as unknown as SystemSettingsDoc) : settingsDefaultsFromEnv();
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/**
 * Synchronous view: the last value this process read, or the `.env`
 * defaults before the first async load completes. When the cache is stale
 * a background reload is kicked off so the next caller sees the database
 * value without making this path async.
 */
export function getSettingsSnapshot(): SystemSettings {
  if (cache && Date.now() < cache.expiresAt) return cache.value;
  void refreshCacheQuietly();
  return cache?.value ?? settingsDefaultsFromEnv();
}

let refreshInFlight: Promise<SystemSettings> | null = null;

function refreshCacheQuietly(): Promise<SystemSettings> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = getSettings()
    .catch(() => settingsDefaultsFromEnv())
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export interface UpdateSettingsContext {
  userId: string;
}

/**
 * Partially update the singleton row (upsert), then refresh the cache so
 * the change is visible immediately in this process.
 */
export async function updateSettings(
  patch: Partial<SystemSettings>,
  ctx: UpdateSettingsContext,
): Promise<SystemSettings> {
  const actorId = new Types.ObjectId(ctx.userId);
  const set: Record<string, unknown> = { ...patch, updatedBy: actorId };
  const setOnInsert: Record<string, unknown> = {
    key: 'system',
    createdBy: actorId,
    isDeleted: false,
  };

  const doc = await SystemSettings.findOneAndUpdate(
    { key: 'system', isDeleted: false },
    { $set: set, $setOnInsert: setOnInsert },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();

  const value = toSettings(doc as unknown as SystemSettingsDoc);
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** Test hook — drop the in-process cache. */
export function resetSettingsCache(): void {
  cache = null;
}
