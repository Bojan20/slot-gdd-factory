#!/usr/bin/env node
/**
 * tools/_run-block-tests.mjs
 *
 * UQ-U-9 (Boki 2026-06-25, performance U-8-B #2 deferred) — single-
 * process driver for `tests/blocks/*.test.mjs`. Replaces the giant
 * 269-entry `&&`-chained npm script with one Node process that imports
 * each test module via dynamic `import()`.
 *
 * # MEASURED IMPACT
 *
 * Baseline (3 block tests sequential via `node tests/blocks/X.test.mjs &&
 * node tests/blocks/Y.test.mjs && ...`): ~0.30s for 3 tests, linear
 * extrapolation ≈ 27s for the 269 tests in the `test:blocks` npm
 * script.
 *
 * Batched (this driver): each test imports its dependencies in a
 * shared module cache, so the 2nd..269th import is essentially free.
 * Expected 5-8× speedup → ~3-5s for the full set.
 *
 * # WHY NOT JUST USE `node --test tests/blocks/`?
 *
 * The block tests don't use the `node:test` runner — they use a
 * homegrown `t(name, fn)` pattern with a global `pass/fail` counter
 * and `process.exit(1)` on failure. Switching every file to `node:test`
 * is a 269-file refactor; this driver gets us the perf win without
 * touching the existing test contract.
 *
 * # USAGE
 *
 *   node tools/_run-block-tests.mjs              # full sweep
 *   node tools/_run-block-tests.mjs --quiet      # only print summary
 *   node tools/_run-block-tests.mjs --grep <re>  # filter by filename regex
 *   node tools/_run-block-tests.mjs --json       # machine output
 *   node tools/_run-block-tests.mjs --skip-audio # skip audio block tests
 *                                                # (HARD RULE #4)
 *
 * # EXIT CODES
 *
 *   0  every block test passed
 *   1  at least one block test failed
 *   2  driver setup error (test dir missing)
 */

import { readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO      = resolve(__dirname, '..');
const BLOCKS    = resolve(REPO, 'tests', 'blocks');

if (!existsSync(BLOCKS)) {
  process.stderr.write(`error: ${BLOCKS} does not exist\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const QUIET   = args.includes('--quiet');
const JSON_OUT = args.includes('--json');
const SKIP_AUDIO = args.includes('--skip-audio');
const grepIdx = args.indexOf('--grep');
const GREP_RE = grepIdx >= 0 && args[grepIdx + 1]
  ? new RegExp(args[grepIdx + 1])
  : null;

function log(msg) {
  if (!QUIET && !JSON_OUT) process.stdout.write(msg);
}

const allFiles = readdirSync(BLOCKS)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

const files = allFiles.filter((f) => {
  if (SKIP_AUDIO && /\baudio\b/i.test(f)) return false;
  if (GREP_RE && !GREP_RE.test(f)) return false;
  return true;
});

if (files.length === 0) {
  process.stderr.write(`error: no test files matched filters\n`);
  process.exit(2);
}

log(`block test driver · ${files.length} test file(s) (${allFiles.length} total)\n\n`);

const results = [];
let anyFail = false;
const t0Total = Date.now();

/* Sentinel for capturing process.exit() calls from inside test files
   without aborting our parent. Each test file ends with
   `if (fail > 0) process.exit(1)`; we wrap process.exit to throw a
   sentinel that we catch per-file. */
class _BlockExitSentinel extends Error {
  constructor(code) {
    super(`_BlockExitSentinel(${code})`);
    this.code = code;
  }
}

for (const file of files) {
  const t0 = Date.now();
  let ok = true;
  let exitCode = 0;
  let error = null;
  const realExit = process.exit;
  process.exit = (code) => {
    exitCode = code || 0;
    throw new _BlockExitSentinel(code || 0);
  };
  /* Silence per-test verbose output by redirecting console.log to a
     ring buffer; print only on failure for postmortem. */
  const logBuffer = [];
  const realConsoleLog = console.log;
  if (QUIET || JSON_OUT) {
    console.log = (...a) => logBuffer.push(a.join(' '));
  }
  try {
    const url = pathToFileURL(resolve(BLOCKS, file)).href + `?ts=${t0}`;
    await import(url);
  } catch (err) {
    if (err instanceof _BlockExitSentinel) {
      exitCode = err.code;
    } else {
      ok = false;
      error = err && err.stack ? err.stack.split('\n').slice(0, 5).join('\n') : String(err);
    }
  } finally {
    process.exit = realExit;
    console.log = realConsoleLog;
  }
  if (exitCode !== 0) ok = false;
  const dt = ((Date.now() - t0) / 1000).toFixed(3);
  if (!ok) anyFail = true;
  results.push({ file, ok, exitCode, durationS: parseFloat(dt), error });
  if (!QUIET && !JSON_OUT) {
    const tag = ok ? '✓' : '✗';
    log(`  ${tag} ${file.padEnd(50)} (${dt}s)\n`);
    if (!ok && logBuffer.length > 0) {
      log('    ── last 10 log lines ──\n');
      log('    ' + logBuffer.slice(-10).join('\n    ') + '\n');
    }
    if (error) {
      log(`    ${error}\n`);
    }
  }
}

const totalDt = ((Date.now() - t0Total) / 1000).toFixed(2);
const passCount = results.filter((r) => r.ok).length;
const failCount = results.length - passCount;

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    overall: anyFail ? 'fail' : 'pass',
    totalDurationS: parseFloat(totalDt),
    passCount,
    failCount,
    files: results,
  }, null, 2) + '\n');
} else {
  log('\n');
  log(`══════════════════════════════════════════════\n`);
  log(`${anyFail ? '✗ AT LEAST ONE BLOCK TEST FAILED' : '✓ ALL BLOCK TESTS GREEN'}\n`);
  log(`  files: ${results.length}   pass: ${passCount}   fail: ${failCount}   total: ${totalDt}s\n`);
  log(`══════════════════════════════════════════════\n`);
}

process.exit(anyFail ? 1 : 0);
