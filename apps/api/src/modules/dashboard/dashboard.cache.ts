import { DASHBOARD_CACHE_TTL_SECONDS } from '../../config/constants';
import { cacheDeletePattern } from '../../utils/cache';

/**
 * AGENTS.md §3 — the dashboard summary is cached in Redis with a 60s TTL and
 * invalidated after relevant employee / leave / asset / licence / exit /
 * onboarding writes.
 *
 * The key pattern is the single source of truth for "what is cached", so a new
 * scope kind cannot accidentally reuse another scope's entry.
 */

export const DASHBOARD_CACHE_PREFIX = 'dashboard:summary:v1';

export const dashboardCacheKey = (scopeKind: string, scopeId: string): string =>
  `${DASHBOARD_CACHE_PREFIX}:${scopeKind}:${scopeId}`;

export const DASHBOARD_CACHE_TTL = DASHBOARD_CACHE_TTL_SECONDS;

/**
 * Drop every cached summary.
 *
 * Uses SCAN rather than KEYS so a large key space cannot block Redis. Called on
 * writes, where correctness matters more than shaving a millisecond.
 */
export async function invalidateDashboardCache(): Promise<void> {
  await cacheDeletePattern(`${DASHBOARD_CACHE_PREFIX}:*`);
}
