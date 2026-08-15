#!/usr/bin/env node
/**
 * Migration runner.
 *
 *   npx tsx scripts/migrate.ts            apply everything pending
 *   npx tsx scripts/migrate.ts --status   show what is applied and what is not
 *   npx tsx scripts/migrate.ts --dry-run  list what would run, touch nothing
 *   npx tsx scripts/migrate.ts --skip 003_seed_dev.sql
 *
 * ENGINE-PLAN §11, Phase 0: "Done when the migration applies to a Supabase
 * branch and the container starts."
 *
 * Design notes, since this is the one script that can damage a database:
 *
 *   - Files run in filename order. The numeric prefix is the ordering key, so
 *     `010_` sorts after `009_` — plain lexicographic comparison, which is why
 *     the prefixes are zero-padded and must stay that way.
 *   - Each file is applied inside a transaction together with the insert into
 *     `schema_migrations`. Postgres has transactional DDL, so a file either
 *     applies completely and is recorded, or does neither. There is no state in
 *     which the schema moved but the ledger did not.
 *   - A checksum of each file is stored. Editing an already-applied migration is
 *     reported loudly rather than ignored: the database no longer matches the
 *     file, and every later environment will diverge from this one. That is a
 *     warning, not a hard failure, because the two legitimate cases — a comment
 *     fix, and a deliberate re-baseline — are common enough that refusing to
 *     start would train people to bypass the runner entirely.
 *   - The whole run holds an advisory lock, so two containers deploying at once
 *     cannot interleave. The loser waits rather than racing.
 */

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDbEnv, EnvValidationError } from '../src/config/env.js';
import { createDb, closeDb, ADVISORY_LOCKS } from '../src/db/client.js';
import type { Db } from '../src/db/client.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DB_DIR = path.resolve(HERE, '..', '..', 'db');
const LOCAL_MIGRATIONS_DIR = path.resolve(HERE, '..', 'migrations');
const MIGRATIONS_DIR = (await readdir(ROOT_DB_DIR).then(() => true).catch(() => false))
  ? ROOT_DB_DIR
  : LOCAL_MIGRATIONS_DIR;

interface MigrationFile {
  filename: string;
  fullPath: string;
  sql: string;
  checksum: string;
}

interface AppliedRow {
  filename: string;
  checksum: string;
  applied_at: Date;
}

// ---------------------------------------------------------------------------
// Logging — plain, ordered, greppable. This runs in CI logs and in a deploy
// stream, not through the engine's pino logger (which needs a validated env
// that may itself be the thing that is broken).
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stdout.write(`[migrate] ${msg}\n`);
}

function warn(msg: string): void {
  process.stderr.write(`[migrate] WARN  ${msg}\n`);
}

function fail(msg: string): void {
  process.stderr.write(`[migrate] ERROR ${msg}\n`);
}

// ---------------------------------------------------------------------------

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Read `migrations/*.sql` in filename order. */
export async function readMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    // Locale-independent: `localeCompare` would order `_` against digits
    // differently depending on ICU data, and migration order must not depend on
    // which machine ran the deploy.
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const out: MigrationFile[] = [];
  for (const filename of names) {
    const fullPath = path.join(dir, filename);
    const sql = await readFile(fullPath, 'utf8');
    out.push({ filename, fullPath, sql, checksum: sha256(sql) });
  }
  return out;
}

/**
 * The ledger. Created outside the per-file transaction because every later step
 * reads it, and because it must survive a migration that fails and rolls back.
 */
async function ensureLedger(sql: Db): Promise<void> {
  await sql`
    create table if not exists public.schema_migrations (
      filename   text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now(),
      duration_ms int
    )
  `;
}

async function fetchApplied(sql: Db): Promise<Map<string, AppliedRow>> {
  const rows = await sql<AppliedRow[]>`
    select filename, checksum, applied_at
    from public.schema_migrations
    order by filename
  `;
  const m = new Map<string, AppliedRow>();
  for (const r of rows) m.set(r.filename, r);
  return m;
}

/**
 * Apply one file.
 *
 * `sql.file` / `sql.unsafe` is required here rather than a tagged template: the
 * content is trusted developer-authored DDL that must reach the server verbatim,
 * including `$$`-quoted plpgsql bodies and multiple statements. Parameterisation
 * is neither possible nor wanted — there is no user input anywhere near it.
 */
async function applyOne(sql: Db, m: MigrationFile): Promise<number> {
  const started = Date.now();
  await sql.begin(async (tx) => {
    // `unsafe()` with no bound parameters uses the *simple* wire protocol,
    // which is the only one that accepts more than one statement per message.
    // The extended protocol — what every tagged template here uses — is
    // one-statement-only, so a migration file would fail on its second
    // semicolon. That is also why nothing in these files may be parameterised.
    await tx.unsafe(m.sql);
    await tx`
      insert into public.schema_migrations (filename, checksum, duration_ms)
      values (${m.filename}, ${m.checksum}, ${Date.now() - started})
      on conflict (filename) do update
        set checksum = excluded.checksum,
            applied_at = now(),
            duration_ms = excluded.duration_ms
    `;
  });
  return Date.now() - started;
}

// ---------------------------------------------------------------------------

export interface MigrateOptions {
  dir?: string;
  dryRun?: boolean;
  statusOnly?: boolean;
  skip?: string[];
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  pending: string[];
  drifted: string[];
}

export async function migrate(sql: Db, options: MigrateOptions = {}): Promise<MigrateResult> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const skip = new Set(options.skip ?? []);

  const files = await readMigrations(dir);
  log(`found ${files.length} migration file${files.length === 1 ? '' : 's'} in ${dir}`);

  await ensureLedger(sql);
  const applied = await fetchApplied(sql);

  const result: MigrateResult = { applied: [], skipped: [], pending: [], drifted: [] };

  for (const m of files) {
    const prior = applied.get(m.filename);

    if (prior) {
      if (prior.checksum !== m.checksum) {
        // The database and the repository disagree about what this migration
        // says. Whatever the file now contains was never run here.
        result.drifted.push(m.filename);
        warn(
          `${m.filename} has changed since it was applied ` +
            `(recorded ${prior.checksum.slice(0, 12)}, file ${m.checksum.slice(0, 12)}). ` +
            `The database does NOT reflect the current file. ` +
            `Add a new migration instead of editing an applied one.`,
        );
      } else {
        log(`${m.filename} — already applied`);
      }
      continue;
    }

    if (skip.has(m.filename)) {
      result.skipped.push(m.filename);
      log(`${m.filename} — skipped by request`);
      continue;
    }

    result.pending.push(m.filename);

    if (options.statusOnly || options.dryRun) {
      log(`${m.filename} — PENDING${options.dryRun ? ' (dry run, not applied)' : ''}`);
      continue;
    }

    log(`${m.filename} — applying...`);
    const ms = await applyOne(sql, m);
    result.applied.push(m.filename);
    log(`${m.filename} — applied in ${ms} ms`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): MigrateOptions & { help: boolean } {
  const opts: MigrateOptions & { help: boolean } = { help: false, skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--status') opts.statusOnly = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--dir') {
      const v = argv[++i];
      if (v !== undefined) opts.dir = path.resolve(v);
    } else if (a === '--skip') {
      const v = argv[++i];
      if (v !== undefined) opts.skip?.push(v);
    } else if (a !== undefined) {
      warn(`unrecognised argument: ${a}`);
    }
  }
  return opts;
}

const USAGE = `
Usage: npx tsx scripts/migrate.ts [options]

  --status        report applied / pending, change nothing
  --dry-run       list what would be applied, change nothing
  --skip <file>   do not apply this file (repeatable, e.g. --skip 003_seed_dev.sql)
  --dir <path>    migrations directory (default: ./migrations)
  -h, --help      this message

Reads DATABASE_URL from the environment or .env.
`.trim();

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  // `loadDbEnv`, not `loadEnv`: migrations need a database and nothing else.
  // Demanding SUPABASE_URL and the service_role key here would make it
  // impossible to build the schema against a plain local Postgres or a CI
  // container, which is exactly where you most want to run it.
  let env;
  try {
    env = loadDbEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      fail(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  // A distinct application_name so a migration holding a lock is identifiable
  // in `pg_stat_activity` without guessing. max: 2 because the run is strictly
  // sequential — one connection for the work, one spare for the lock reserve.
  const sql = createDb(env, { applicationName: 'roadscore-migrate', max: 2 });

  try {
    // Serialise concurrent deploys. Blocking rather than try-lock: the second
    // container genuinely does want to proceed once the first has finished, and
    // it will then find every file already applied and exit cleanly.
    await sql`select pg_advisory_lock(${ADVISORY_LOCKS.MIGRATIONS.toString()}::bigint)`;

    const result = await migrate(sql, opts);

    log(
      `done — applied ${result.applied.length}, ` +
        `pending ${opts.dryRun || opts.statusOnly ? result.pending.length : 0}, ` +
        `skipped ${result.skipped.length}, drifted ${result.drifted.length}`,
    );

    // Drift is a warning during a normal run but a failure in --status, which
    // is what CI calls: a pipeline should notice that the repo and the database
    // have diverged even though nothing is pending.
    if (opts.statusOnly && result.drifted.length > 0) process.exitCode = 1;
  } catch (err) {
    fail(err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
    process.exitCode = 1;
  } finally {
    try {
      await sql`select pg_advisory_unlock(${ADVISORY_LOCKS.MIGRATIONS.toString()}::bigint)`;
    } catch {
      /* connection already gone; the server released it with the session */
    }
    await closeDb(sql, 5);
  }
}

// Only run when invoked directly, so the exported `migrate()` can be reused by
// the test suite to build a schema in a throwaway database.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
