import { describe, expect, it, beforeEach } from 'vitest';
import { Counter } from '../../src/modules/counters/counter.model';
import { formatHumanId, nextHumanId, nextSequence, peekSequence } from '../../src/utils/ids';
import { ID_PREFIXES } from '../../src/config/constants';

/** AGENTS.md §7 / §14 — atomic human-readable IDs (HRV-0001, AST-0001, ...). */

describe('human-readable ID generation (§7)', () => {
  beforeEach(async () => {
    await Counter.deleteMany({});
  });

  describe('formatHumanId', () => {
    it('zero-pads to four digits', () => {
      expect(formatHumanId('HRV', 1)).toBe('HRV-0001');
      expect(formatHumanId('AST', 42)).toBe('AST-0042');
      expect(formatHumanId('JOB', 1234)).toBe('JOB-1234');
    });

    it('does not truncate beyond the configured width', () => {
      expect(formatHumanId('LIC', 12345)).toBe('LIC-12345');
    });
  });

  describe('nextHumanId', () => {
    it('starts each entity series at 0001', async () => {
      expect(await nextHumanId('employee')).toBe('HRV-0001');
      expect(await nextHumanId('asset')).toBe('AST-0001');
      expect(await nextHumanId('job')).toBe('JOB-0001');
      expect(await nextHumanId('license')).toBe('LIC-0001');
      expect(await nextHumanId('candidate')).toBe('CAN-0001');
    });

    it('increments sequentially', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) ids.push(await nextHumanId('employee'));

      expect(ids).toEqual(['HRV-0001', 'HRV-0002', 'HRV-0003', 'HRV-0004', 'HRV-0005']);
    });

    it('uses the prefix mandated by AGENTS.md', () => {
      expect(ID_PREFIXES).toEqual({
        employee: 'HRV',
        asset: 'AST',
        job: 'JOB',
        license: 'LIC',
        candidate: 'CAN',
      });
    });

    it('keeps the series per entity independent', async () => {
      await nextHumanId('employee');
      await nextHumanId('employee');
      await nextHumanId('candidate');

      expect(await nextHumanId('candidate')).toBe('CAN-0002');
      expect(await nextHumanId('employee')).toBe('HRV-0003');
    });
  });

  describe('concurrency (§7 "atomically")', () => {
    it('never hands out a duplicate under 25 parallel allocations', async () => {
      const ids = await Promise.all(
        Array.from({ length: 25 }, () => nextHumanId('employee')),
      );

      expect(new Set(ids).size).toBe(25);
      expect(ids.every((id) => /^HRV-\d{4}$/.test(id))).toBe(true);
    });

    it('produces a gapless run when 40 sequences are allocated concurrently', async () => {
      const numbers = await Promise.all(Array.from({ length: 40 }, () => nextSequence('asset')));

      expect(new Set(numbers).size).toBe(40);
      expect(Math.min(...numbers)).toBe(1);
      expect(Math.max(...numbers)).toBe(40);
    });
  });

  describe('peekSequence', () => {
    it('reports the current high-water mark without consuming a number', async () => {
      expect(await peekSequence('employee')).toBe(0);

      await nextHumanId('employee');
      await nextHumanId('employee');

      expect(await peekSequence('employee')).toBe(2);
      expect(await nextHumanId('employee')).toBe('HRV-0003');
    });
  });

  describe('persistence (§7 counters collection)', () => {
    it('stores the counter under a stable key', async () => {
      await nextHumanId('employee');

      const doc = await Counter.findById('employee').lean().exec();
      expect(doc?.seq).toBe(1);
    });
  });
});