import { env } from '../config/env';
import { badRequest } from './errors';

/**
 * AGENTS.md §11 — store timestamps in UTC; dates-only fields use `YYYY-MM-DD`.
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnlyString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Convert any date-ish value to a `YYYY-MM-DD` date-only string (UTC). */
export function toDateOnly(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest('Invalid date value');
  }
  return date.toISOString().slice(0, 10);
}

/** Today's date-only string in the company timezone (not the server timezone). */
export function todayInTimeZone(timeZone: string = env.COMPANY_TIMEZONE): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    throw badRequest(`Invalid company timezone: ${timeZone}`);
  }
}

/** Add (or subtract) whole days to a `YYYY-MM-DD` string. */
export function addDaysIso(dateOnly: string, days: number): string {
  if (!isDateOnlyString(dateOnly)) {
    throw badRequest(`Expected a YYYY-MM-DD date, received "${dateOnly}"`);
  }
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Parse a compact duration such as `15m`, `7d`, `30s`, `2h` into milliseconds.
 * Used for JWT lifetimes and refresh-token cookie max-age, so the same string
 * from `.env` drives both the token and the browser cookie.
 */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(value.trim());
  if (!match) {
    throw badRequest(`Invalid duration "${value}". Use a format such as 15m, 7d, 30s, 2h`);
  }
  const amount = Number(match[1]);
  const unit = (match[2] as string).toLowerCase();
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * (multipliers[unit] as number);
}

/** Inclusive list of date-only strings between two dates. */
export function eachDayInclusive(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  let cursor = fromDate;
  // Guard against pathological ranges.
  for (let i = 0; i < 4000 && cursor <= toDate; i += 1) {
    days.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return days;
}

export const isWeekend = (dateOnly: string): boolean => {
  const day = new Date(`${dateOnly}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
};

/** Full ISO timestamp for a date-only string at UTC midnight. */
export function dateOnlyStartOfDay(dateOnly: string): Date {
  if (!isDateOnlyString(dateOnly)) {
    throw badRequest(`Expected a YYYY-MM-DD date, received "${dateOnly}"`);
  }
  return new Date(`${dateOnly}T00:00:00.000Z`);
}