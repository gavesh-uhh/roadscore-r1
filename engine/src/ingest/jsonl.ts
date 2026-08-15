/**
 * JSONL capture files — the substrate of the §10 replay harness.
 *
 * "Capture — dump real telemetry to JSONL. Annotate — drive a scripted route
 * with a phone stopwatch; label the JSONL. Replay — run the pure detectors over
 * the file with no DB and no clock." One row per line, `telemetry` columns
 * verbatim, no wrapper object.
 *
 * Why JSONL rather than a JSON array: a capture of one hour from one device is
 * 3 600 rows and roughly 2 MB, and a full annotated drive across a small fleet
 * is far larger. A JSON array must be parsed whole before the first row is
 * available and holds the entire file in memory as one value. Line-delimited
 * records stream, append, `grep`, `head`, `wc -l` and `split` — all of which are
 * things you actually do to a capture while calibrating thresholds, and none of
 * which work on a 200 MB array literal.
 *
 * Hence: streaming read via `readline`, never `readFileSync`.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import type { IngestSource, RawRow } from '../types.js';

export interface JsonlOptions {
  /** Only emit rows for this device. */
  deviceId?: string;
  /** Stop after this many delivered rows. */
  limit?: number;
  /**
   * Throw on a line that will not parse. Default false: a capture truncated by
   * a `^C` mid-write has one bad final line, and losing the other 3 599 good
   * rows over it would be absurd.
   */
  strict?: boolean;
  /** Called for each skipped line, so the CLI can report a count. */
  onParseError?: (line: number, err: unknown) => void;
}

export interface JsonlStats {
  linesRead: number;
  rowsDelivered: number;
  parseErrors: number;
  skippedDevice: number;
}

/**
 * Read a JSONL capture as an `IngestSource`.
 *
 * `start()` resolves when the file is exhausted (or `limit` is reached), which
 * is what makes the replay CLI a plain `await source.start(fn)` with no
 * shutdown dance.
 */
export function createJsonlSource(
  path: string,
  options: JsonlOptions = {},
): IngestSource & { stats: () => JsonlStats } {
  let stopped = false;
  const stats: JsonlStats = {
    linesRead: 0,
    rowsDelivered: 0,
    parseErrors: 0,
    skippedDevice: 0,
  };

  return {
    async start(onRow): Promise<void> {
      stopped = false;
      const stream = createReadStream(path, { encoding: 'utf8' });
      // `crlfDelay: Infinity` treats \r\n as one break, so a capture that has
      // been through a Windows editor still parses.
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      try {
        for await (const raw of rl) {
          if (stopped) break;
          const line = raw.trim();
          stats.linesRead++;
          // Blank lines and `#` comments: annotation (§10 step 2) is done by
          // hand on these files, and a human note in the margin should not be a
          // parse failure.
          if (line === '' || line.startsWith('#')) continue;

          let row: RawRow;
          try {
            row = JSON.parse(line) as RawRow;
          } catch (err) {
            stats.parseErrors++;
            options.onParseError?.(stats.linesRead, err);
            if (options.strict) {
              throw new Error(`${path}:${stats.linesRead}: malformed JSON`, { cause: err });
            }
            continue;
          }

          if (options.deviceId && row.device_id !== options.deviceId) {
            stats.skippedDevice++;
            continue;
          }

          await onRow(row);
          stats.rowsDelivered++;

          if (options.limit !== undefined && stats.rowsDelivered >= options.limit) break;
        }
      } finally {
        rl.close();
        stream.destroy();
      }
    },

    async stop(): Promise<void> {
      stopped = true;
    },

    stats: () => ({ ...stats }),
  };
}

/**
 * Write rows to a JSONL capture.
 *
 * Accepts an async iterable as well as an array so `scripts/capture.ts` can
 * stream a cursor straight to disk without materialising a month of telemetry in
 * memory.
 *
 * Backpressure is honoured: when `write` returns false we wait for `drain`.
 * Ignoring it is how a capture of a large range balloons the process's heap with
 * buffered strings and gets OOM-killed two thirds of the way through — leaving a
 * truncated file that looks complete.
 */
export async function writeJsonlCapture(
  rows: Iterable<RawRow> | AsyncIterable<RawRow>,
  path: string,
): Promise<number> {
  const out = createWriteStream(path, { encoding: 'utf8', flags: 'w' });
  let n = 0;

  try {
    for await (const row of rows as AsyncIterable<RawRow>) {
      // Key order follows `RawRow`'s declaration order via `stableRow`, so two
      // captures of the same range are byte-identical and diffable. `git diff`
      // over a re-captured drive should show data changes, not key shuffling.
      if (!out.write(`${JSON.stringify(stableRow(row))}\n`)) {
        await once(out, 'drain');
      }
      n++;
    }
  } finally {
    out.end();
    // Wait for the OS handle to actually close. Resolving before this means the
    // caller can `process.exit()` on a partially-flushed file.
    await once(out, 'close');
  }

  return n;
}

/**
 * Project a row onto `RawRow`'s fields in a fixed order.
 *
 * Determinism, not tidiness: `JSON.stringify` emits keys in insertion order, and
 * a row assembled by postgres.js has whatever order the `select *` produced.
 * Pinning it here is what makes a capture reproducible and a golden file stable.
 */
function stableRow(r: RawRow): Record<string, unknown> {
  return {
    id: r.id,
    device_id: r.device_id,
    ts: r.ts ?? null,
    uptime_ms: r.uptime_ms,
    seq: r.seq,
    samples: r.samples ?? null,
    accel_raw: r.accel_raw ?? null,
    accel_cal: r.accel_cal ?? null,
    gyro_raw: r.gyro_raw ?? null,
    gyro_cal: r.gyro_cal ?? null,
    gps: r.gps ?? null,
    mic: r.mic ?? null,
    calibration: r.calibration ?? null,
    wifi_rssi: r.wifi_rssi ?? null,
    accel_fs_g: r.accel_fs_g ?? null,
    gyro_fs_dps: r.gyro_fs_dps ?? null,
    fw_version: r.fw_version ?? null,
    dropped_posts: r.dropped_posts ?? null,
    server_received_at: r.server_received_at,
  };
}

/** Read a whole capture into memory. Tests and small files only — see the header. */
export async function readJsonlCapture(
  path: string,
  options: JsonlOptions = {},
): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  const src = createJsonlSource(path, options);
  await src.start((r) => {
    rows.push(r);
  });
  return rows;
}
