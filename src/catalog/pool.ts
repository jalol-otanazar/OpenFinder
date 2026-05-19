/**
 * Bounded-concurrency worker pool (rules/03 §3.4). At most `limit` workers run
 * at once — the deliberate ceiling that prevents the Stage A rate-limit
 * crashes. The `onSettled` callback runs **one at a time, in completion order**,
 * never interleaved, so the orchestrator can mutate shared state (universe.json,
 * the run manifest) inside it without a lost-update race between two workers.
 */

export type PoolOutcome<T, R> =
  | { item: T; ok: true; result: R }
  | { item: T; ok: false; error: unknown };

export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
  onSettled: (outcome: PoolOutcome<T, R>) => Promise<void> | void,
): Promise<void> {
  if (items.length === 0) return;
  const lanes = Math.max(1, Math.min(Math.floor(limit), items.length));

  let next = 0;
  // Each onSettled call is appended to this chain, so they run strictly in
  // sequence even when two workers finish at the same moment.
  let settleChain: Promise<void> = Promise.resolve();

  async function runLane(): Promise<void> {
    while (next < items.length) {
      const item = items[next++]!;
      let outcome: PoolOutcome<T, R>;
      try {
        outcome = { item, ok: true, result: await worker(item) };
      } catch (error) {
        outcome = { item, ok: false, error };
      }
      settleChain = settleChain.then(() => onSettled(outcome));
      await settleChain;
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => runLane()));
}
