/**
 * Merge every ingest path into one deduplicated stream.
 *
 * ENGINE-PLAN §5: `ingest/source.ts` — "merge, dedupe by id, hand to the router".
 *
 * The two sources overlap ON PURPOSE. Realtime and the sweeper will both deliver
 * most rows, and the sweeper re-scans its own 10 s overlap window every pass on
 * top of that. Duplication is the mechanism by which §3's "Realtime for latency,
 * sweeper for completeness" split works, so this file is where that design
 * choice is paid for — in exactly one bounded LRU set, once, rather than
 * scattered through the detectors.
 *
 * Two properties are non-negotiable here:
 *
 *   * ONE dedupe set shared across all sources. Per-source sets would dedupe
 *     each source against itself and let every cross-source duplicate through,
 *     which is the entire population of duplicates.
 *   * SERIALISED delivery. The router downstream mutates per-device ring buffers
 *     and boot state; two concurrent `onRow` calls for the same device would
 *     interleave `state.ring.push` with `normalizeRow`'s reads and corrupt both.
 *     §5 requires a "per-device sequential queue"; a single global chain is the
 *     conservative superset of that and costs nothing at 1 kHz aggregate.
 *
 * Note that dedupe is a best-effort optimisation, not the correctness mechanism.
 * The real idempotency guarantee is `driving_events.event_key` being UNIQUE
 * (§4): if a duplicate escapes this set — because it arrived more than `cap`
 * insertions later — the event it produces collapses onto the existing row
 * instead of double-counting a penalty. This set exists to save the *work*, not
 * to prevent the *corruption*.
 */

import type { IngestSource, RawRow } from '../types.js';
import { BoundedIdSet } from './lru.js';

export interface MergedStats {
  delivered: number;
  duplicates: number;
  malformed: number;
  lru: { size: number; cap: number; duplicates: number; rotations: number };
}

export interface MergedSource extends IngestSource {
  stats(): MergedStats;
}

export function createMergedSource(sources: IngestSource[], dedupeCap: number): MergedSource {
  const seen = new BoundedIdSet(dedupeCap);
  let delivered = 0;
  let duplicates = 0;
  let malformed = 0;

  let onRow: ((row: RawRow) => Promise<void> | void) | null = null;

  /**
   * The serialisation chain.
   *
   * Every source's callback appends to this promise instead of running
   * concurrently. The `catch` swallowing is deliberate: one bad row must not
   * poison the chain for every subsequent row, and the error has already been
   * surfaced by the router that threw it. A rejected `chain` left unhandled
   * would also crash the process on Node's default policy.
   */
  let chain: Promise<void> = Promise.resolve();

  function handle(row: RawRow): Promise<void> {
    // Validate the dedupe key itself before it can poison the set. A row with a
    // NaN id would be "new" on every arrival (NaN !== NaN in a Set is actually
    // false — Set uses SameValueZero, so NaN *does* match itself — but the id is
    // then useless as an audit reference either way).
    if (typeof row.id !== 'number' || !Number.isFinite(row.id)) {
      malformed++;
      return Promise.resolve();
    }

    // Check-and-insert in one call, synchronously, BEFORE the await point below.
    // Splitting it would let two sources both pass the `has` check on the same
    // id before either had inserted it.
    if (!seen.addIfNew(row.id)) {
      duplicates++;
      return Promise.resolve();
    }

    delivered++;
    chain = chain.then(() => onRow?.(row)).then(
      () => {},
      () => {},
    );
    return chain;
  }

  return {
    async start(handler): Promise<void> {
      onRow = handler;
      // `start` is the lifetime of a source, so this resolves only when every
      // source has stopped. `allSettled`, not `all`: one source failing to start
      // (Realtime with a bad key, say) must not abort the other — a
      // sweeper-only engine is slower but provably complete, and that is a far
      // better degraded state than no ingest at all.
      await Promise.allSettled(sources.map((s) => s.start(handle)));
    },

    async stop(): Promise<void> {
      await Promise.allSettled(sources.map((s) => s.stop()));
      // Drain whatever is still queued so an in-flight row is not lost on a
      // graceful shutdown.
      await chain;
    },

    stats: () => ({ delivered, duplicates, malformed, lru: seen.stats }),
  };
}
