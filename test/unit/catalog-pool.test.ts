import { describe, expect, it } from 'vitest';
import { type PoolOutcome, runPool } from '../../src/catalog/pool.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('runPool', () => {
  it('never runs more than `limit` workers at once', async () => {
    let active = 0;
    let peak = 0;
    const items = [1, 2, 3, 4, 5, 6, 7];

    await runPool(
      items,
      2,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await delay(10);
        active--;
      },
      () => {},
    );

    expect(peak).toBeLessThanOrEqual(2);
  });

  it('settles every item exactly once', async () => {
    const items = ['a', 'b', 'c', 'd'];
    const settled: string[] = [];

    await runPool(
      items,
      3,
      (x) => Promise.resolve(x.toUpperCase()),
      (outcome) => {
        expect(outcome.ok).toBe(true);
        if (outcome.ok) settled.push(outcome.result);
      },
    );

    expect(settled.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('runs onSettled serially — never interleaved', async () => {
    let inside = false;
    let overlapped = false;

    await runPool(
      [1, 2, 3, 4, 5],
      4,
      (x) => Promise.resolve(x),
      async () => {
        if (inside) overlapped = true;
        inside = true;
        await delay(5);
        inside = false;
      },
    );

    expect(overlapped).toBe(false);
  });

  it('captures a worker error as a failed outcome instead of throwing', async () => {
    const outcomes: PoolOutcome<number, number>[] = [];

    await runPool(
      [1, 2, 3],
      2,
      (x) => (x === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(x)),
      (outcome) => {
        outcomes.push(outcome);
      },
    );

    expect(outcomes).toHaveLength(3);
    const failed = outcomes.find((o) => !o.ok);
    expect(failed?.item).toBe(2);
  });

  it('is a no-op for an empty item list', async () => {
    let called = false;
    await runPool(
      [],
      2,
      () => Promise.resolve(),
      () => {
        called = true;
      },
    );
    expect(called).toBe(false);
  });
});
