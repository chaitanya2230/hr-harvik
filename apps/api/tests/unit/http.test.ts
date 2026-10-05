import { describe, expect, it } from 'vitest';
import { buildPagination, buildSort, listMeta } from '../../src/utils/http';

/** AGENTS.md §10 — `?page=&limit=&q=&sort=`, max limit 100. */
describe('buildPagination', () => {
  it('defaults to page 1, limit 20', () => {
    expect(buildPagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('computes skip from page and limit', () => {
    expect(buildPagination({ page: '3', limit: '25' })).toEqual({ page: 3, limit: 25, skip: 50 });
  });

  it('caps enforcement: rejects a limit above 100 rather than clamping it', () => {
    expect(() => buildPagination({ limit: '101' })).toThrow(/must not exceed 100/);
    expect(() => buildPagination({ limit: '10000' })).toThrow(/must not exceed 100/);
    expect(buildPagination({ limit: '100' }).limit).toBe(100);
  });

  it('rejects invalid pages and limits', () => {
    expect(() => buildPagination({ page: '0' })).toThrow(/greater than or equal to 1/);
    expect(() => buildPagination({ page: '-1' })).toThrow();
    expect(() => buildPagination({ page: '1.5' })).toThrow();
    expect(() => buildPagination({ page: 'abc' })).toThrow();
    expect(() => buildPagination({ limit: '0' })).toThrow();
    expect(() => buildPagination({ limit: 'abc' })).toThrow();
  });

  it('treats an empty string as absent', () => {
    expect(buildPagination({ page: '', limit: '' })).toEqual({ page: 1, limit: 20, skip: 0 });
  });
});

describe('buildSort', () => {
  const allowed = ['createdAt', 'firstName'] as const;
  const fallback = { createdAt: -1 as const };

  it('returns the fallback when no sort is supplied', () => {
    expect(buildSort(undefined, allowed, fallback)).toEqual({ createdAt: -1 });
    expect(buildSort('', allowed, fallback)).toEqual({ createdAt: -1 });
  });

  it('supports ascending and descending', () => {
    expect(buildSort('firstName', allowed, fallback)).toEqual({ firstName: 1 });
    expect(buildSort('-firstName', allowed, fallback)).toEqual({ firstName: -1 });
  });

  it('rejects sorting by a field outside the allow-list', () => {
    expect(() => buildSort('passwordHash', allowed, fallback)).toThrow(/Cannot sort by/);
    expect(() => buildSort('-passwordHash', allowed, fallback)).toThrow(/Cannot sort by/);
  });

  it('rejects non-string sort values', () => {
    expect(() => buildSort({ firstName: 1 }, allowed, fallback)).toThrow(/must be a string/);
  });
});

describe('listMeta', () => {
  it('emits the §10 meta shape', () => {
    expect(listMeta({ page: 2, limit: 10, skip: 10 }, 37)).toEqual({
      page: 2,
      limit: 10,
      total: 37,
    });
  });
});