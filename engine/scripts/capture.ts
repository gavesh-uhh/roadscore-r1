#!/usr/bin/env node
/**
 * Telemetry → JSONL capture. ENGINE-PLAN §10, step 1.
 *
 *   npx tsx scripts/capture.ts --device esp32-a1 --from 2026-08-09T06:00:00Z --to 2026-08-09T07:00:00Z
 *   npx tsx scripts/capture.ts --device esp32-a1 --last 2h --out drives/drive-01.jsonl
 *
 * §10: "Capture — dump real telemetry to JSONL: `select * from telemetry where
 * device_id=$1 and server_received_at between …`". The file this produces is the
 * input to step 2 (hand annotation) and step 3 (`src/replay/cli.ts`), and
 * ultimately the fixture that step 4's vitest snapshot asserts against. Two or
 * three annotated drives is enough to anchor every threshold in §6.
 *
 * Three properties that make a capture usable as a test fixture:
 *
 *   1. ORDERED BY `(device_id, server_received_at, id)`. The replay harness feeds
 *      rows to `normalizeRow` in file order, and §2.6's reboot detection reads
 *      `seq`/`uptime_ms` *decreases* — so a file in arbitrary order would
 *      manufacture phantom reboots on every out-of-order pair. `id` breaks ties,
 *      because `server_received_at` has 1 µs resolution but two rows genuinely
 *      can share a value.
 *
 *   2. STREAMED, both ends. `.cursor()` on the read side and backpressure-aware
 *      writes on the other, so capturing a week does not need a week of
 *      telemetry in RAM. At ~500 B/row a day of one device is ~43 MB of JSONL;
 *      a fleet-month would OOM any buffered implementation.
 *
 *   3. `select *`. Not a column list. When firmware asks #1/#4/#6 add columns,
 *      the capture picks them up with no change here — and a capture that
 *      silently dropped `accel_fs_g` would be replayed at the wrong scale, which
 *      is precisely the failure §2.1 exists to prevent.
 *
 * Read-only. This script never writes to the database.
 */

import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { loadDbEnv, EnvValidationError } from '../src/config/env.js';
import { createDb, closeDb } from '../src/db/client.js';
import type { Db } from '../src/db/client.js';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
  device?: string;
  from?: Date;
  to?: Date;
  last?: number; // seconds
  out?: string;
  limit?: number;
  help: boolean;
}

/** `90s` / `30m` / `2h` / `3d`, or a bare number of seconds. */
export function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i.exec(s.trim());
  if (!m) throw new Error(`bad duration: ${s} (expected e.g. 90s, 30m, 2h, 3d)`);
  const n = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  const mult = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return n * mult;
}

function parseWhen(s: string, flag: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${flag}: not a parseable timestamp: ${s} (use ISO-8601, e.g. 2026-08-09T06:00:00Z)`);
  }
  return d;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { help: false };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };

    switch (a) {
      case '--device':
      case '-d':
        args.device = next();
        break;
      case '--from':
        args.from = parseWhen(next(), '--from');
        break;
      case '--to':
        args.to = parseWhen(next(), '--to');
        break;
      case '--last':
        args.last = parseDuration(next());
        break;
      case '--out':
      case '-o':
        args.out = next();
        break;
      case '--limit':
        args.limit = Number(next());
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`unknown option: ${a}`);
    }
  }

  if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  if (args.from && args.to && args.from.getTime() >= args.to.getTime()) {
    throw new Error('--from must be before --to');
  }

  return args;
}

const USAGE = `roadscore capture — dump telemetry to JSONL for offline replay (ENGINE-PLAN §10)

  npx tsx scripts/capture.ts [options]

Options:
  -d, --device <id>   device_id to capture (omit for every device — usually not what you want)
      --from <iso>    inclusive start, on server_received_at
      --to <iso>      exclusive end
      --last <dur>    shorthand for --from (now - dur); 90s / 30m / 2h / 3d
      --limit <n>     stop after n rows
  -o, --out <file>    output file (default: stdout)
  -h, --help          this

Reads DATABASE_URL from the environment or .env. Read-only; never writes.

Then:
  npx tsx src/replay/cli.ts <file.jsonl> --out golden.json`;

// ---------------------------------------------------------------------------
// Row shaping
// ---------------------------------------------------------------------------

/**
 * A telemetry row, serialised for the capture file.
 *
 * `select *` returns whatever columns exist, and they go out verbatim with two
 * normalisations:
 *
 *   * `Date` → ISO-8601 string. JSON has no date type; letting `JSON.stringify`
 *     do it implicitly works but depends on `Date.prototype.toJSON`, and being
 *     explicit means the capture is identical whether the driver returned a
 *     `Date` or a string.
 *   * `bigint` → number. postgres.js returns `int8` as a string to avoid the
 *     silent precision loss of `Number`; `telemetry.id` is nowhere near 2^53 and
 *     every consumer downstream — the LRU, `telemetry_ids`, the replay CLI —
 *     wants a number.
 *
 * Key order is the column order Postgres returned, which is the table's
 * declaration order and therefore stable for a given schema. That is what makes
 * two captures of the same range byte-identical and `git diff`-able.
 */
function serialiseRow(row: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'bigint') out[k] = Number(v);
    else if (typeof v === 'string' && (k === 'id' || k === 'seq' || k === 'uptime_ms')) {
      // int8 columns arrive as strings from postgres.js.
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : v;
    } else out[k] = v;
  }
  return JSON.stringify(out);
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export interface CaptureFilter {
  deviceId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/**
 * Stream matching rows to `write`, returning the count.
 *
 * `.cursor(n)` keeps a server-side cursor open and hands back batches of `n`, so
 * memory is O(batch) rather than O(result). The batch of 1 000 is a round trip
 * per ~500 KB of JSONL, which keeps the network busy without letting a slow disk
 * on the writing side back a large buffer up in the driver.
 *
 * The ordering is `(device_id, server_received_at, id)` — see the file header for
 * why an unordered capture manufactures phantom reboots on replay.
 */
export async function captureRows(
  db: Db,
  filter: CaptureFilter,
  write: (line: string) => Promise<void> | void,
): Promise<number> {
  let n = 0;

  // Built as fragments so the optional predicates stay parameterised — string
  // concatenation into SQL is how a device id with a quote in it becomes an
  // incident, even in a read-only script.
  const deviceClause = filter.deviceId
    ? db`and t.device_id = ${filter.deviceId}`
    : db``;
  const fromClause = filter.from ? db`and t.server_received_at >= ${filter.from}` : db``;
  const toClause = filter.to ? db`and t.server_received_at < ${filter.to}` : db``;
  const limitClause = filter.limit ? db`limit ${filter.limit}` : db``;

  const cursor = db<Record<string, unknown>[]>`
    select t.*
    from public.telemetry t
    where true
      ${deviceClause}
      ${fromClause}
      ${toClause}
    order by t.device_id, t.server_received_at, t.id
    ${limitClause}
  `.cursor(1000);

  for await (const batch of cursor) {
    for (const row of batch) {
      await write(`${serialiseRow(row)}\n`);
      n++;
    }
  }

  return n;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}\n`);
    return 2;
  }

  if (args.help) {
    process.stderr.write(`${USAGE}\n`);
    return 0;
  }

  if (!args.device) {
    process.stderr.write(
      'capture: no --device given; capturing EVERY device. A replay of a mixed file is ' +
        'still correct (state is keyed per device) but it will be large.\n',
    );
  }

  // A capture with no time bound on a table growing at 86 400 rows/device/day is
  // a mistake, not a request. Refuse rather than dump the whole table.
  if (!args.from && !args.last && !args.limit) {
    process.stderr.write(
      'capture: refusing to dump an unbounded range. Pass --from/--to, --last, or --limit.\n',
    );
    return 2;
  }

  let env;
  try {
    env = loadDbEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  }

  // `--last` is resolved against the wall clock exactly once, here, at the edge.
  // Everything downstream of it receives an absolute range, so the *capture* is
  // reproducible even though the convenience flag that produced it is not.
  const from = args.from ?? (args.last !== undefined ? new Date(Date.now() - args.last * 1000) : undefined);

  const db = createDb(env, { max: 2, applicationName: 'roadscore-capture' });

  // stdout when no --out, so the script composes: `capture.ts ... | head -100`.
  const stream = args.out
    ? createWriteStream(args.out, { encoding: 'utf8', flags: 'w' })
    : process.stdout;

  const write = async (line: string): Promise<void> => {
    // Backpressure. Ignoring it is how a large capture balloons the heap with
    // buffered strings and gets OOM-killed two thirds of the way through,
    // leaving a truncated file that looks complete.
    if (!stream.write(line)) await once(stream, 'drain');
  };

  const started = Date.now();
  let count = 0;
  try {
    count = await captureRows(
      db,
      {
        ...(args.device !== undefined ? { deviceId: args.device } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(args.to !== undefined ? { to: args.to } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      },
      write,
    );
  } catch (err) {
    process.stderr.write(`capture failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    if (args.out) {
      stream.end();
      await once(stream, 'close');
    }
    await closeDb(db, 2);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  process.stderr.write(
    `capture: ${count} row${count === 1 ? '' : 's'} in ${secs}s` +
      `${args.device ? ` for ${args.device}` : ''}` +
      `${from ? ` from ${from.toISOString()}` : ''}` +
      `${args.to ? ` to ${args.to.toISOString()}` : ''}` +
      `${args.out ? ` → ${args.out}` : ''}\n`,
  );

  if (count === 0) {
    process.stderr.write(
      'capture: no rows matched. Check the device_id spelling and that the range is in UTC.\n',
    );
  }

  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && /capture\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`capture failed: ${err instanceof Error ? err.stack : String(err)}\n`);
      process.exitCode = 1;
    });
}
