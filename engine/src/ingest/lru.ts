/**
 * A bounded, O(1) set of recently-seen telemetry ids.
 *
 * ENGINE-PLAN §3: the sweeper re-scans a 10 s overlap window every pass and
 * de-duplicates "on `id` through a bounded LRU set". Realtime and the sweeper
 * also deliver the same row twice by construction — that is not a bug, it is the
 * completeness guarantee working.
 *
 * Bounded is the operative word. An unbounded `Set<number>` over a fleet at 1 Hz
 * grows by 86 400 entries per device per day and is a guaranteed OOM in a
 * long-lived container (§9, "runaway state"). The cap is what makes it safe to
 * run forever.
 *
 * Implementation: two generations, not a linked list.
 *
 * The textbook LRU is a hash map plus a doubly-linked list, which is O(1) but
 * allocates a node per entry and rewires three pointers on every *hit*. This
 * workload does not need recency ordering at all — it needs "have I seen this id
 * in the recent past", where "recent" only has to comfortably exceed the overlap
 * window. So we keep two `Set`s: everything goes into `hot`, and when `hot`
 * reaches the capacity it becomes `cold` and a fresh `hot` is started. A lookup
 * checks both. Eviction is one object drop instead of N deletions, and the
 * garbage collector reclaims a whole generation at once rather than incremental
 * per-node garbage.
 *
 * The trade: memory is up to 2× capacity, and an id is guaranteed retained for
 * at least `cap` insertions and at most `2 * cap`. Both are exactly the
 * properties the sweeper needs — the guarantee is a *floor* on retention, and
 * the floor is what prevents a duplicate slipping through. It also means this
 * class is not a true LRU (a hit does not promote an entry), which is why it is
 * named `BoundedIdSet` rather than `LruSet`.
 *
 * Sizing: at 1 Hz per device the overlap window holds `devices × overlap_s`
 * rows, so the default 100 000 covers a 1 000-device fleet's 10 s window a
 * hundred times over. Memory is roughly 2 × cap × ~40 B ≈ 8 MB at that size.
 */

export class BoundedIdSet {
  private hot = new Set<number>();
  private cold = new Set<number>();
  readonly cap: number;

  /** Diagnostics: how many `add` calls hit an id we already had. */
  private duplicates = 0;
  private rotations = 0;

  constructor(cap: number) {
    if (!Number.isFinite(cap) || cap < 1) {
      throw new RangeError(`BoundedIdSet capacity must be >= 1, got ${cap}`);
    }
    this.cap = Math.trunc(cap);
  }

  has(id: number): boolean {
    return this.hot.has(id) || this.cold.has(id);
  }

  add(id: number): void {
    if (this.has(id)) {
      this.duplicates++;
      return;
    }
    this.insert(id);
  }

  /**
   * `true` if this id is new (and record it), `false` if it is a duplicate.
   *
   * The check-and-insert the merged source actually wants, as one call: doing it
   * as separate `has` then `add` around an `await` is precisely where a dedupe
   * race lives, because two sources can interleave between the two statements.
   */
  addIfNew(id: number): boolean {
    if (this.has(id)) {
      this.duplicates++;
      return false;
    }
    this.insert(id);
    return true;
  }

  private insert(id: number): void {
    this.hot.add(id);
    if (this.hot.size >= this.cap) {
      // Rotate. The previous `cold` generation is dropped whole — one reference
      // released, no per-entry deletion, no incremental GC pressure.
      this.cold = this.hot;
      this.hot = new Set<number>();
      this.rotations++;
    }
  }

  /** Live entry count across both generations. Between `cap` and `2*cap` when full. */
  get size(): number {
    return this.hot.size + this.cold.size;
  }

  get stats(): { size: number; cap: number; duplicates: number; rotations: number } {
    return {
      size: this.size,
      cap: this.cap,
      duplicates: this.duplicates,
      rotations: this.rotations,
    };
  }

  clear(): void {
    this.hot = new Set<number>();
    this.cold = new Set<number>();
    this.duplicates = 0;
    this.rotations = 0;
  }
}
