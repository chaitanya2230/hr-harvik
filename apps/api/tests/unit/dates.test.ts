import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  dateOnlyStartOfDay,
  eachDayInclusive,
  isDateOnlyString,
  isWeekend,
  parseDurationMs,
  toDateOnly,
} from '../../src/utils/dates';

/** AGENTS.md §11 — UTC timestamps, `YYYY-MM-DD` date-only fields. */
describe('date-only helpers', () => {
  it('validates YYYY-MM-DD strictly', () => {
    expect(isDateOnlyString('2026-01-31')).toBe(true);
    expect(isDateOnlyString('2026-1-31')).toBe(false);
    expect(isDateOnlyString('2026-02-30')).toBe(false);
    expect(isDateOnlyString('31-01-2026')).toBe(false);
    expect(isDateOnlyString(20260131)).toBe(false);
  });

  it('converts dates to YYYY-MM-DD in UTC', () => {
    expect(toDateOnly(new Date('2026-03-15T23:30:00.000Z'))).toBe('2026-03-15');
    expect(toDateOnly('2026-03-15T00:00:00.000Z')).toBe('2026-03-15');
  });

  it('adds and subtracts days across month and year boundaries', () => {
    expect(addDaysIso('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29'); // leap year
  });

  it('rejects invalid input to addDaysIso', () => {
    expect(() => addDaysIso('2026-13-01', 1)).toThrow();
    expect(() => addDaysIso('nonsense', 1)).toThrow();
  });

  it('builds an inclusive range', () => {
    expect(eachDayInclusive('2026-01-01', '2026-01-04')).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
  });

  it('returns nothing when the range is inverted', () => {
    expect(eachDayInclusive('2026-01-04', '2026-01-01')).toEqual([]);
  });

  it('identifies weekends (2026-01-01 is a Thursday)', () => {
    expect(isWeekend('2026-01-02')).toBe(false); // Friday
    expect(isWeekend('2026-01-03')).toBe(true); // Saturday
    expect(isWeekend('2026-01-04')).toBe(true); // Sunday
    expect(isWeekend('2026-01-05')).toBe(false); // Monday
  });

  it('anchors a date-only string at UTC midnight', () => {
    expect(dateOnlyStartOfDay('2026-06-01').toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('parseDurationMs', () => {
  it('parses the units used in .env', () => {
    expect(parseDurationMs('15m')).toBe(900_000);
    expect(parseDurationMs('7d')).toBe(604_800_000);
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('2h')).toBe(7_200_000);
    expect(parseDurationMs('250ms')).toBe(250);
  });

  it('is whitespace and case tolerant', () => {
    expect(parseDurationMs(' 15M ')).toBe(900_000);
  });

  it('rejects unsupported formats', () => {
    expect(() => parseDurationMs('15')).toThrow();
    expect(() => parseDurationMs('15y')).toThrow();
    expect(() => parseDurationMs('abc')).toThrow();
  });
});