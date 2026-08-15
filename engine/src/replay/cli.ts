#!/usr/bin/env node
/**
 * The offline replay harness — ENGINE-PLAN §10, and the Phase 1 gate.
 *
 *   npx tsx src/replay/cli.ts drive-01.jsonl
 *   npx tsx src/replay/cli.ts drive-01.jsonl --device esp32-a1 --limit 500 --out golden.json
 *
 * §10: "the highest-leverage thing in this plan — build it in Phase 1, not at
 * the end." §11 Phase 1: "Done when the engine can consume a live device and
 * losslessly replay a recorded drive with byte-identical intermediate state.
 * This is the gate — do not start detectors before it passes."
 *
 * THREE HARD RULES, and every design choice below follows from them:
 *
 *   NO DATABASE.  Nothing here imports `db/client.ts`. Device identity comes
 *                 from the capture file itself, not from the `devices` table.
 *   NO CLOCK.     `Date.now()` is never read. The only timestamps in the output
 *                 are ones that came out of the input file, via §2.6's resolver.
 *                 A golden file containing the time it was generated is a golden
 *                 file that fails its own snapshot test one second later.
 *   NO NETWORK.   No Supabase client, no fetch.
 *
 * BYTE-STABILITY. The output is emitted through a canonical serialiser that
 * sorts every object's keys recursively and renders every float through a fixed
 * precision. Two runs over the same file — on different machines, in different
 * Node versions, in either order — produce identical bytes. That is what makes
 * `vitest` snapshotting the golden file meaningful: a diff then means a
 * threshold changed, not that a `Set` iterated differently (§10 step 4).
 *
 * DETECTORS ARE OPTIONAL. `src/detect/index.ts` is another agent's file and may
 * not exist yet. It is imported lazily inside a try/catch, and its absence
 * degrades to a normalize-only replay with an explicit message in the output —
 * which is exactly what Phase 1 needs to gate on, since Phase 1 *is* the
 * normalize half.
 */

import { basename } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { THRESHOLDS } from '../config/thresholds.js';
import type { Thresholds } from '../config/thresholds.js';
import { newDeviceState } from '../domain/state.js';
import type { DeviceState } from '../domain/state.js';
import { normalizeRow } from '../domain/normalize.js';
import { createJsonlSource } from '../ingest/jsonl.js';
import { ENGINE_VERSION, Flags } from '../types.js';
import type { DeviceMeta, EventCandidate, RawRow, Sample } from '../types.js';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
  file: string;
  device?: string;
  limit?: number;
  out?: string;
  /** Include the full normalised sample stream, not just the digest. */
  samples: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { file: '', samples: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;

    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--device') {
      args.device = argv[++i];
    } else if (a.startsWith('--device=')) {
      args.device = a.slice('--device='.length);
    } else if (a === '--limit') {
      args.limit = Number(argv[++i]);
    } else if (a.startsWith('--limit=')) {
      args.limit = Number(a.slice('--limit='.length));
    } else if (a === '--out' || a === '-o') {
      args.out = argv[++i];
    } else if (a.startsWith('--out=')) {
      args.out = a.slice('--out='.length);
    } else if (a === '--samples') {
      args.samples = true;
    } else if (a.startsWith('-')) {
      throw new Error(`unknown option: ${a}`);
    } else if (args.file === '') {
      args.file = a;
    } else {
      throw new Error(`unexpected argument: ${a}`);
    }
  }

  if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }

  return args;
}

const USAGE = `roadscore replay — offline detector re-run over a JSONL capture (ENGINE-PLAN §10)

  npx tsx src/replay/cli.ts <file.jsonl> [options]

Options:
  --device <id>   only replay rows from this device_id
  --limit <n>     stop after n rows
  --out <file>    write the golden JSON here instead of stdout
  --samples       include the full normalised sample stream in the output
  -h, --help      this

No database, no network, no clock. Output is byte-stable across runs, which is
what makes it snapshot-testable.`;

// ---------------------------------------------------------------------------
// Canonical serialisation — the byte-stability guarantee
// ---------------------------------------------------------------------------

/**
 * Round to a fixed number of significant decimals and normalise the zeros.
 *
 * Two floats that differ in the 15th decimal are the same physical measurement
 * and must not show as a diff. `-0` is folded to `0` because `JSON.stringify`
 * renders it as `0` anyway but `Object.is` does not agree, and non-finite values
 * become explicit strings rather than `null` — a NaN `aLong` means "GPS was not
 * usable", which is real information the plan cares about (§2.2) and which
 * `null` would silently merge with "field absent".
 */
function canonNumber(n: number): number | string {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  if (n === 0) return 0; // folds -0
  // 9 decimals: far beyond any sensor's meaningful precision (the accelerometer
  // resolves ~0.0006 m/s²) and far short of where float64 noise lives.
  const r = Number(n.toFixed(9));
  return r === 0 ? 0 : r;
}

/** Recursively sort object keys and canonicalise numbers. */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return canonNumber(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Set) {
    // A Set's iteration order is insertion order, which depends on arrival
    // order. Sorting makes it a value, not a history.
    return [...value].map((v) => String(v)).sort();
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(
        ([k, v]) => [String(k), canonicalize(v)],
      ),
    );
  }
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // localeCompare is locale-sensitive and therefore machine-sensitive; a plain
    // codepoint comparison is not. This matters more than it looks: a golden
    // file generated under LANG=tr_TR would sort 'I' differently.
    for (const k of Object.keys(src).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      out[k] = canonicalize(src[k]);
    }
    return out;
  }
  return String(value);
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Detector registry — loaded defensively (another agent owns src/detect/index.ts)
// ---------------------------------------------------------------------------

interface DetectorLike {
  readonly name: string;
  run(ctx: {
    sample: Sample;
    state: DeviceState;
    meta: DeviceMeta;
    cfg: Thresholds;
  }): EventCandidate[];
}

interface RegistryLoad {
  detectors: DetectorLike[];
  status: 'loaded' | 'absent' | 'error';
  note: string;
}

/**
 * Try to load the detector registry, and carry on without it if it is not there.
 *
 * §11's phase order puts detectors in Phase 2 and this harness in Phase 1, so
 * "the module does not exist" is the *expected* state while the gate is being
 * proved, not an error. Failing hard here would make the Phase 1 deliverable
 * depend on Phase 2 work — exactly the coupling the phase split exists to avoid.
 *
 * The note lands in the golden file so a reader can never mistake a
 * normalize-only run for a run that found no events.
 */
async function loadDetectors(): Promise<RegistryLoad> {
  try {
    // Non-literal specifier so the bundler does not hard-require the module at
    // build time; the whole point is that it may be absent.
    const spec = '../detect/index.js';
    const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;

    const candidate =
      (mod['detectors'] as DetectorLike[] | undefined) ??
      (mod['DETECTORS'] as DetectorLike[] | undefined) ??
      (mod['registry'] as DetectorLike[] | undefined) ??
      (typeof mod['createDetectors'] === 'function'
        ? ((mod['createDetectors'] as () => DetectorLike[])())
        : undefined);

    if (!Array.isArray(candidate)) {
      return {
        detectors: [],
        status: 'error',
        note: 'src/detect/index.ts exists but exports no `detectors` array; replay ran normalize-only',
      };
    }

    return {
      detectors: candidate,
      status: 'loaded',
      note: `${candidate.length} detector(s) loaded`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ERR_MODULE_NOT_FOUND for the registry itself is the Phase 1 case.
    const missing = /Cannot find module|ERR_MODULE_NOT_FOUND/i.test(msg);
    return {
      detectors: [],
      status: missing ? 'absent' : 'error',
      note: missing
        ? 'src/detect/index.ts not present — replay ran NORMALIZE-ONLY (expected during Phase 1)'
        : `src/detect/index.ts failed to load (${msg}) — replay ran NORMALIZE-ONLY`,
    };
  }
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Device identity without a database.
 *
 * The `devices` table carries `accel_fs_g` / `gyro_fs_dps`, and this harness may
 * not read it. The fallbacks are §2.1's hard-coded ±2 g / ±250 dps — the same
 * values the live engine defaults to — so a replay of a capture from firmware
 * that predates ask #1 produces exactly the same numbers the live engine did.
 * When the row *does* carry `accel_fs_g`, `resolveScales` prefers it and this
 * default never applies.
 */
function replayMeta(deviceId: string): DeviceMeta {
  return {
    deviceId,
    vehicleId: null,
    driverId: null,
    accelFsG: 2,
    gyroFsDps: 250,
    active: true,
  };
}

/** Human-readable flag names, so the golden file is diffable by eye. */
function flagNames(flags: number): string[] {
  return Object.entries(Flags)
    .filter(([, bit]) => (flags & bit) !== 0)
    .map(([name]) => name)
    .sort();
}

interface DeviceDigest {
  deviceId: string;
  rows: number;
  accepted: number;
  rejected: number;
  reboots: number;
  bootIds: string[];
  timeQuality: Record<string, number>;
  flagCounts: Record<string, number>;
  firstTSec: number | null;
  lastTSec: number | null;
  aLongFinite: number;
  aLongMin: number | null;
  aLongMax: number | null;
  speedMaxMps: number | null;
  vertPeakMaxMps2: number | null;
  clippedRows: number;
  events: number;
}

export interface ReplayResult {
  meta: {
    engineVersion: string;
    ruleVersion: string;
    capture: string;
    deviceFilter: string | null;
    limit: number | null;
    detectorRegistry: { status: string; note: string; names: string[] };
  };
  totals: {
    linesRead: number;
    rowsIn: number;
    accepted: number;
    rejected: number;
    reboots: number;
    parseErrors: number;
    events: number;
  };
  /** Reject reason (prefix before the first `:`) → count. Sorted by key on output. */
  rejections: Record<string, number>;
  devices: DeviceDigest[];
  events: EventCandidate[];
  samples?: Record<string, unknown>[];
}

export async function replay(args: Args, cfg: Thresholds = THRESHOLDS): Promise<ReplayResult> {
  const registry = await loadDetectors();

  const states = new Map<string, DeviceState>();
  const digests = new Map<string, DeviceDigest>();
  const rejections: Record<string, number> = {};
  const events: EventCandidate[] = [];
  const samples: Record<string, unknown>[] = [];

  let rowsIn = 0;
  let accepted = 0;
  let rejected = 0;
  let reboots = 0;
  let parseErrors = 0;

  function digestFor(deviceId: string): DeviceDigest {
    let d = digests.get(deviceId);
    if (!d) {
      d = {
        deviceId,
        rows: 0,
        accepted: 0,
        rejected: 0,
        reboots: 0,
        bootIds: [],
        timeQuality: {},
        flagCounts: {},
        firstTSec: null,
        lastTSec: null,
        aLongFinite: 0,
        aLongMin: null,
        aLongMax: null,
        speedMaxMps: null,
        vertPeakMaxMps2: null,
        clippedRows: 0,
        events: 0,
      };
      digests.set(deviceId, d);
    }
    return d;
  }

  const source = createJsonlSource(args.file, {
    ...(args.device !== undefined ? { deviceId: args.device } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    onParseError: () => {
      parseErrors++;
    },
  });

  await source.start((row: RawRow) => {
    rowsIn++;
    const deviceId = typeof row.device_id === 'string' ? row.device_id : '(missing)';
    const d = digestFor(deviceId);
    d.rows++;

    let state = states.get(deviceId);
    if (!state) {
      // `newDeviceState` takes a wall-clock ms only for the §9 eviction timer,
      // which this harness does not run. Passing 0 rather than `Date.now()` is
      // the difference between a reproducible run and a golden file that
      // changes every second.
      state = newDeviceState(replayMeta(deviceId), 0);
      states.set(deviceId, state);
    }

    const result = normalizeRow(row, state, cfg);

    if (!result.ok) {
      rejected++;
      d.rejected++;
      // Bucket on the reason prefix, dropping the value after the first `:`.
      // The values (a speed, a lat/lon) are unbounded cardinality and would make
      // this map a per-row log rather than a summary.
      const key = result.reason.split(':')[0] ?? result.reason;
      rejections[key] = (rejections[key] ?? 0) + 1;
      return;
    }

    accepted++;
    d.accepted++;

    const s = result.sample;
    if (result.rebooted) {
      reboots++;
      d.reboots++;
    }
    if (!d.bootIds.includes(s.bootId)) d.bootIds.push(s.bootId);

    d.timeQuality[s.timeQuality] = (d.timeQuality[s.timeQuality] ?? 0) + 1;
    for (const name of flagNames(s.flags)) {
      d.flagCounts[name] = (d.flagCounts[name] ?? 0) + 1;
    }
    if (d.firstTSec === null) d.firstTSec = s.tSec;
    d.lastTSec = s.tSec;

    if (Number.isFinite(s.aLong)) {
      d.aLongFinite++;
      d.aLongMin = d.aLongMin === null ? s.aLong : Math.min(d.aLongMin, s.aLong);
      d.aLongMax = d.aLongMax === null ? s.aLong : Math.max(d.aLongMax, s.aLong);
    }
    if (Number.isFinite(s.speed)) {
      d.speedMaxMps = d.speedMaxMps === null ? s.speed : Math.max(d.speedMaxMps, s.speed);
    }
    if (Number.isFinite(s.vertPeak)) {
      d.vertPeakMaxMps2 =
        d.vertPeakMaxMps2 === null ? s.vertPeak : Math.max(d.vertPeakMaxMps2, s.vertPeak);
    }
    if ((s.flags & Flags.CLIPPED) !== 0) d.clippedRows++;

    if (args.samples) samples.push(sampleDigest(s));

    // Detectors, if any. Each is isolated: §5's contract says a detector "must
    // not throw", and a harness that dies on the one that does is a harness that
    // cannot be used to debug it.
    for (const det of registry.detectors) {
      try {
        const out = det.run({ sample: s, state, meta: state.meta, cfg });
        for (const e of out) {
          events.push(e);
          d.events++;
        }
      } catch (err) {
        rejections[`detector_threw:${det.name}`] =
          (rejections[`detector_threw:${det.name}`] ?? 0) + 1;
        void err;
      }
    }
  });

  const stats = source.stats();

  // Deterministic ordering everywhere a Map or an append order leaks through.
  const deviceList = [...digests.values()].sort((a, b) =>
    a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0,
  );
  for (const d of deviceList) d.bootIds.sort();

  // Events sorted by their identity, not by the order detectors happen to be
  // registered in — so adding a detector does not reshuffle the whole file.
  events.sort(
    (a, b) =>
      a.deviceId.localeCompare(b.deviceId) ||
      a.anchorSeq - b.anchorSeq ||
      a.occurredAt - b.occurredAt ||
      a.type.localeCompare(b.type),
  );

  return {
    meta: {
      engineVersion: ENGINE_VERSION,
      ruleVersion: cfg.version,
      capture: basename(args.file),
      deviceFilter: args.device ?? null,
      limit: args.limit ?? null,
      detectorRegistry: {
        status: registry.status,
        note: registry.note,
        names: registry.detectors.map((x) => x.name).sort(),
      },
    },
    totals: {
      linesRead: stats.linesRead,
      rowsIn,
      accepted,
      rejected,
      reboots,
      parseErrors,
      events: events.length,
    },
    rejections,
    devices: deviceList,
    events,
    ...(args.samples ? { samples } : {}),
  };
}

/**
 * One sample, projected for the golden file.
 *
 * Deliberately not `Sample` verbatim: `accelRaw` and `gravityRef` are spot
 * checks (§2.3) that add three keys per row without informing any threshold, and
 * the raw counts are already summarised by the CLIPPED flag. What is here is
 * what a threshold change would move.
 */
function sampleDigest(s: Sample): Record<string, unknown> {
  return {
    telemetryId: s.telemetryId,
    bootId: s.bootId,
    seq: s.seq,
    tSec: s.tSec,
    timeQuality: s.timeQuality,
    speed: s.speed,
    aLong: s.aLong,
    yawRate: s.yawRate,
    vertRms: s.vertRms,
    vertPeak: s.vertPeak,
    horizPeak: s.horizPeak,
    magPeak: s.magPeak,
    heading: s.heading,
    lat: s.lat,
    lon: s.lon,
    sats: s.sats,
    hdop: s.hdop,
    micRms: s.micRms,
    micPeak: s.micPeak,
    calibrationState: s.calibrationState,
    flags: flagNames(s.flags),
  };
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

  if (args.help || args.file === '') {
    process.stderr.write(`${USAGE}\n`);
    return args.help ? 0 : 2;
  }

  const result = await replay(args);
  const json = canonicalJson(result);

  if (args.out) {
    await writeFile(args.out, json, 'utf8');
    // stderr, not stdout: stdout is the golden file's channel and must stay
    // clean enough to pipe.
    process.stderr.write(
      `replay: ${result.totals.accepted} accepted, ${result.totals.rejected} rejected, ` +
        `${result.totals.events} events → ${args.out}\n`,
    );
  } else {
    process.stdout.write(json);
  }

  if (result.meta.detectorRegistry.status !== 'loaded') {
    process.stderr.write(`replay: ${result.meta.detectorRegistry.note}\n`);
  }

  return 0;
}

// Run only when invoked directly, so tests can import `replay` without the CLI
// firing.
const invokedDirectly =
  process.argv[1] !== undefined && /replay[/\\]cli\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`replay failed: ${err instanceof Error ? err.stack : String(err)}\n`);
      process.exitCode = 1;
    });
}
