import { describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../src/jobs/queues';

/**
 * AGENTS.md §3 — BullMQ queues must be usable against Redis 7.
 *
 * This guards a defect that only surfaces at runtime against a real Redis:
 * BullMQ builds its Redis keys as `bull:<queueName>:...`, so a queue name
 * containing `:` makes the Worker throw "Queue name cannot contain :" at
 * construction time and crash-loop the worker container. Nothing in the test
 * suite needs Redis to catch it, so the constraint is asserted directly.
 */
describe('BullMQ queue names (AGENTS.md §3)', () => {
  const names = Object.values(QUEUE_NAMES);

  it('declares every queue P0 wires up', () => {
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });

  it('contains no colon, which BullMQ rejects at construction time', () => {
    for (const name of names) {
      expect(name, `queue name "${name}" must not contain ":"`).not.toContain(':');
    }
  });

  it.each(names)('"%s" is accepted by BullMQ Queue', (name) => {
    // BullMQ validates the name synchronously in the Queue constructor.
    expect(() => new Queue(name, { connection: { host: '127.0.0.1', port: 6379 } })).not.toThrow();
  });
});
