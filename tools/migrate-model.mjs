#!/usr/bin/env node
/**
 * tools/migrate-model.mjs
 *
 * N+2 atom I (Boki 2026-06-25) — CLI runner for the top-level model
 * schema migration registry (`src/registry/modelMigrations.mjs`).
 *
 * # USAGE
 *
 *   node tools/migrate-model.mjs --in <model.json> [--out <out.json>]
 *     [--to <semver>] [--dry-run] [--quiet]
 *   node tools/migrate-model.mjs --list
 *   node tools/migrate-model.mjs --version <model.json>
 *
 * # FLAGS
 *
 *   --in <path>       Input model JSON (or `-` for stdin).
 *   --out <path>      Write the migrated model here. Defaults to
 *                     overwriting --in (atomic write: tmp + rename).
 *   --to <semver>     Migrate to this version. Default: current
 *                     MODEL_SCHEMA_VERSION.
 *   --dry-run         Plan + report what would change, write nothing.
 *   --quiet           Suppress progress lines; exit code is the signal.
 *   --list            Print every registered migration step and exit 0.
 *   --version <path>  Print the detected schema version of <path>.
 *
 * # EXIT CODES
 *
 *   0  success (or dry-run that found no work)
 *   1  generic failure (bad flag, write error)
 *   2  source missing / unreadable
 *   3  no migration path (e.g. target is older than source)
 *
 * # SAFETY
 *
 *   - Atomic write: `<out>.tmp` → `fsync` → `rename(<out>)`. A crash
 *     mid-write leaves the original `<out>` intact.
 *   - `--dry-run` never touches disk.
 *   - The runner refuses to overwrite the input if migration would be
 *     a no-op (already at target). Stays out of `git status`.
 *
 * # WHY THIS TOOL EXISTS
 *
 * `tools/_wave-v-cache/<slug>.json` contains 338 GDD reconcile caches
 * from earlier waves. When the schema bumps MAJOR, every one of those
 * files needs a one-time pass to add/rename/coerce fields. Without a
 * runner, that would be an `xargs` chain per release — error-prone and
 * undiscoverable. This CLI gives a single, scriptable entry point
 * (`find tools/_wave-v-cache -name '*.json' | xargs -I {} node tools/migrate-model.mjs --in {}`).
 */

import {
  readFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';

import {
  MODEL_SCHEMA_VERSION,
  readModelVersion,
  compareSemver,
  parseSemver,
} from '../src/registry/modelSchemaVersion.mjs';
import {
  migrate,
  planMigration,
  listMigrations,
} from '../src/registry/modelMigrations.mjs';

/* ── tiny argv parser (no external dep) ──────────────────────────── */
/* UQ-U-2 atom #8 (Boki 2026-06-25): the previous greedy `argv[++i]` had
   NO guard against the next token being another flag. `--in --out a.json`
   would assign `--out` as the value of `--in`, then `a.json` became `--out`
   value, then `--list` would be missing if not last. New parser validates
   that the NEXT token is not itself a `--flag`, throws explicit error. */
function _consumeValueArg(argv, i, flag) {
  const next = argv[i + 1];
  if (next === undefined) {
    throw new Error(`${flag} requires a value but none was given`);
  }
  if (typeof next === 'string' && next.startsWith('--')) {
    throw new Error(`${flag} requires a value but got next flag: ${next}`);
  }
  return next;
}

function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in' || a === '--out' || a === '--to') {
      out[a.slice(2)] = _consumeValueArg(argv, i, a);
      i++;
    } else if (a === '--version') {
      out.version = _consumeValueArg(argv, i, a);
      i++;
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--quiet') {
      out.quiet = true;
    } else if (a === '--list') {
      out.list = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const args = parseArgv(process.argv.slice(2));

function log(msg) {
  if (!args.quiet) process.stdout.write(`${msg}\n`);
}

function die(code, msg) {
  process.stderr.write(`migrate-model: ${msg}\n`);
  process.exit(code);
}

function printHelp() {
  process.stdout.write(`migrate-model.mjs — top-level model.json schema migration runner

USAGE
  node tools/migrate-model.mjs --in <path> [--out <path>] [--to <semver>] [--dry-run] [--quiet]
  node tools/migrate-model.mjs --list
  node tools/migrate-model.mjs --version <path>

Current schema: ${MODEL_SCHEMA_VERSION}
`);
}

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.list) {
  const all = listMigrations();
  if (all.length === 0) {
    log('(no migrations registered)');
  } else {
    log(`registered migrations (current schema: ${MODEL_SCHEMA_VERSION}):`);
    for (const k of all) log(`  ${k}`);
  }
  process.exit(0);
}

if (args.version) {
  const p = resolve(args.version);
  if (!existsSync(p)) die(2, `not found: ${p}`);
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (err) {
    die(2, `read failed: ${err.message}`);
  }
  let model;
  try {
    model = JSON.parse(raw);
  } catch (err) {
    die(2, `JSON parse failed: ${err.message}`);
  }
  log(readModelVersion(model));
  process.exit(0);
}

if (!args.in) {
  printHelp();
  die(1, '--in is required (or use --list / --version / --help)');
}

const inPath = args.in === '-' ? null : resolve(args.in);
const outPath = args.out ? resolve(args.out) : inPath;
const target = args.to || MODEL_SCHEMA_VERSION;

/* UQ-U-2 atom #9 (Boki 2026-06-25): --to validated up-front via parseSemver.
   Before this, garbage like `--to abc` survived until planMigration which
   would emit a misleading "no migration path" instead of "bad input".
   Throw clear error fast (strict mode rejects malformed semver). */
try {
  parseSemver(target, { strict: true });
} catch (e) {
  die(1, `--to value is not valid semver: ${target} (${e.message})`);
}

/* UQ-U-2 atom #7 (Boki 2026-06-25): stdin TTY guard. `readFileSync(0)`
   blocks FOREVER if stdin is a TTY (interactive terminal), so a forgotten
   `--in -` flag freezes the CLI with no diagnostic. Detect TTY and exit
   with helpful message. */
let raw;
if (inPath === null) {
  if (process.stdin.isTTY) {
    die(2, '--in - expects piped stdin, but stdin is a TTY (no data). Pipe a file or pass --in <path>.');
  }
  /* read stdin sync — small payload, fine for CLI use */
  try {
    raw = readFileSync(0, 'utf8');
  } catch (err) {
    die(2, `stdin read failed: ${err.message}`);
  }
} else {
  if (!existsSync(inPath)) die(2, `not found: ${inPath}`);
  try {
    raw = readFileSync(inPath, 'utf8');
  } catch (err) {
    die(2, `read failed: ${err.message}`);
  }
}

let model;
try {
  model = JSON.parse(raw);
} catch (err) {
  die(2, `JSON parse failed: ${err.message}`);
}

const fromVersion = readModelVersion(model);

if (compareSemver(fromVersion, target) === 0) {
  log(`already at ${target} — no migration needed (${inPath || 'stdin'})`);
  process.exit(0);
}

let chain;
try {
  chain = planMigration(fromVersion, target);
} catch (err) {
  die(3, err.message);
}

log(`migrating ${inPath || 'stdin'}: ${fromVersion} → ${target}`);
for (const step of chain) log(`  · ${step}`);

if (args.dryRun) {
  log('(dry-run — no write)');
  process.exit(0);
}

let migrated;
try {
  migrated = migrate(model, target);
} catch (err) {
  die(1, `migrate failed: ${err.message}`);
}

if (!outPath) {
  /* stdin → stdout */
  process.stdout.write(`${JSON.stringify(migrated, null, 2)}\n`);
  process.exit(0);
}

/* Wave U-1 P0-5 (Boki 2026-06-25 audit U-2 #10) — honest atomic write.
   Previous version used `writeFileSync` + `renameSync` and the header
   PROMISED `fsync` but never called it. A power loss or hard kernel
   panic between the rename and the actual disk flush can lose the new
   data (or worse, leave the file looking complete but holding garbage
   from a different inode block on some filesystems). Real atomic
   write:
     1. openSync(tmpPath, 'w', 0o644)
     2. writeSync(fd, body)
     3. fsyncSync(fd)            ← flush file data to disk
     4. closeSync(fd)
     5. renameSync(tmpPath, outPath)  ← atomic on POSIX same-fs
     6. fsyncSync(dirFd)         ← flush the rename to the directory
   Errors mid-flight: unlink the tmp file so we don't leave litter,
   then die with the real cause. */
const tmpPath = `${outPath}.migrate-tmp.${process.pid}`;
const body = `${JSON.stringify(migrated, null, 2)}\n`;
let fd = null;
try {
  fd = openSync(tmpPath, 'w', 0o644);
  writeSync(fd, body);
  fsyncSync(fd);
  closeSync(fd);
  fd = null;
  renameSync(tmpPath, outPath);
  /* fsync the parent directory so the rename itself is durable. On
     macOS/HFS+/APFS this is a no-op for the dir fd path but harmless;
     on Linux/ext4/xfs it's the difference between "rename committed"
     and "rename pending in the journal". */
  try {
    const dirFd = openSync(dirname(outPath), 'r');
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  } catch (e) {
    /* UQ-U-8 P0 #1 (Boki 2026-06-25, observability U-8-C #1): the previous
       blanket swallow marketed durable rename in the header but silently
       hid Linux-specific dir-fsync failures. Now we log a one-line warn
       to stderr so an operator running `migrate-model` and seeing exit 0
       still has visibility into a non-fatal hardening failure (Windows /
       some FUSE mounts refuse fsync on a directory — that's expected and
       still gets logged). The rename itself is durable regardless. */
    if (!args.quiet) {
      process.stderr.write(
        `migrate-model: warn: directory fsync failed (rename is durable; this is best-effort): ${e.message}\n`,
      );
    }
  }
} catch (err) {
  /* Clean up tmp so we don't accumulate `*.migrate-tmp.PID` litter
     when --in is hammered in a loop with a write-failing --out. */
  if (fd !== null) { try { closeSync(fd); } catch (_) { /* ignore */ } }
  try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch (_) { /* ignore */ }
  die(1, `write failed: ${err.message}`);
}

log(`wrote ${outPath} (schema=${target})`);
process.exit(0);
