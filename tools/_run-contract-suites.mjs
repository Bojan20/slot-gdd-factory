#!/usr/bin/env node
/**
 * tools/_run-contract-suites.mjs
 *
 * UQ-U-8 deferred → UQ-U-9 (Boki 2026-06-25, performance U-8-B #2/#4) —
 * single-process driver for all UQ-U-6 contract suites.
 *
 * # WHY
 *
 * `tools/verify.mjs` (and `ci.yml`) used to invoke 7 contract suites
 * via 7 separate `spawnSync('node', ['tests/_*.test.mjs'])` calls.
 * Each spawn pays ~80–120 ms cold-start (V8 init + Node bootstrap +
 * lockfile-lookup + initial module resolution). 7 spawns ≈ 700–900 ms
 * pure overhead BEFORE the first assertion runs. On CI that's ~3–5 s
 * wasted; locally on `verify:quick` it compounds with the other
 * orchestrator probes.
 *
 * This driver loads all 7 suites via `await import()` in ONE Node
 * process. Each suite still owns its `t(name, fn)` helper + its own
 * `pass/fail` counter; we just route the print/exit-code through a
 * shared aggregator so failures don't short-circuit the next suite.
 *
 * The contract test files are pure: they only use Node std APIs
 * (`node:assert`, `node:fs`, `node:child_process` for CLI tests).
 * Imports are idempotent. Re-runs across all 7 do not pollute state.
 *
 * # USAGE
 *
 *   node tools/_run-contract-suites.mjs            full sweep, exit 1 on any fail
 *   node tools/_run-contract-suites.mjs --json     machine output
 *   node tools/_run-contract-suites.mjs --suite X  run one suite (X is short id)
 *
 * # SUITES INDEX
 *
 *   model-schema   tests/_modelSchema.test.mjs           (18 cases)
 *   vision-guard   tests/_visionCostGuard.test.mjs       (20 cases)
 *   deep-freeze    tests/_deepFreeze.test.mjs            (21 cases)
 *   ixf-coverage   tests/_ixfCoverage.test.mjs           (7 cases)
 *   rust-executor  tests/_rustExecutorAdapter.test.mjs   (TBD)
 *   kernel-init    tests/blocks/kernelInit.test.mjs      (TBD)
 *   rect-transform tests/_rectTransform.test.mjs         (TBD)
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO      = resolve(__dirname, '..');

const SUITES = [
  { id: 'model-schema',   path: 'tests/_modelSchema.test.mjs' },
  { id: 'vision-guard',   path: 'tests/_visionCostGuard.test.mjs' },
  { id: 'deep-freeze',    path: 'tests/_deepFreeze.test.mjs' },
  { id: 'ixf-coverage',   path: 'tests/_ixfCoverage.test.mjs' },
  { id: 'rust-executor',  path: 'tests/_rustExecutorAdapter.test.mjs' },
  { id: 'kernel-init',    path: 'tests/blocks/kernelInit.test.mjs' },
  { id: 'rect-transform', path: 'tests/_rectTransform.test.mjs' },
  { id: 'parser-cache',   path: 'tests/_parserCache.test.mjs' },
  { id: 'anti-vendor',    path: 'tests/_antiVendorShield.test.mjs' },
  { id: 'backend-toggle', path: 'tests/_backendModeToggle.test.mjs' },
  { id: 'lv3-wiring',     path: 'tests/_lv3RegulatorWiring.test.mjs' },
  { id: 'cert-pack-w2',   path: 'tests/_certPackWave2.test.mjs' },
  { id: 'lv3-wave3',      path: 'tests/_lv3Wave3.test.mjs' },
];

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const SUITE_FILTER = (() => {
  const i = args.indexOf('--suite');
  return i >= 0 ? args[i + 1] : null;
})();

const targets = SUITE_FILTER
  ? SUITES.filter((s) => s.id === SUITE_FILTER)
  : SUITES;

if (targets.length === 0) {
  process.stderr.write(`error: unknown --suite '${SUITE_FILTER}'\n`);
  process.exit(2);
}

const results = [];
let anyFail = false;
const t0Total = Date.now();

for (const suite of targets) {
  const t0 = Date.now();
  if (!JSON_OUT) {
    process.stdout.write(`\n┌─ contract suite: ${suite.id} ─────────────────────\n`);
  }
  let suiteOk = true;
  let suiteError = null;
  let exitCode = 0;
  /* Intercept process.exit so a suite that exit(1)s on assertion fail
     doesn't kill our process. The suite still PRINTS its tally; we
     capture the exit code, record it, and move on. */
  const realExit = process.exit;
  process.exit = (code) => {
    exitCode = code || 0;
    /* Throw a sentinel that we catch below so the suite's runtime
       stops at the exit() call without aborting the parent process. */
    throw new _SuiteExitSentinel(code || 0);
  };
  try {
    const fullPath = resolve(REPO, suite.path);
    /* Cache-bust query so a second run in the same process re-imports
       cleanly. Not needed today (we only run each suite once), but
       defends against future re-run loops. */
    const url = pathToFileURL(fullPath).href + `?ts=${t0}`;
    await import(url);
  } catch (err) {
    if (err instanceof _SuiteExitSentinel) {
      exitCode = err.code;
    } else {
      suiteOk = false;
      suiteError = err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : String(err);
    }
  } finally {
    process.exit = realExit;
  }
  if (exitCode !== 0) suiteOk = false;
  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  if (!suiteOk) anyFail = true;
  results.push({ id: suite.id, path: suite.path, ok: suiteOk, exitCode, durationS: parseFloat(dt), error: suiteError });
  if (!JSON_OUT) {
    process.stdout.write(`└─ ${suiteOk ? '✓' : '✗'} ${suite.id} (${dt}s)\n`);
    if (suiteError) {
      process.stdout.write(`   error: ${suiteError}\n`);
    }
  }
}

const totalDt = ((Date.now() - t0Total) / 1000).toFixed(2);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    overall: anyFail ? 'fail' : 'pass',
    totalDurationS: parseFloat(totalDt),
    suites: results,
  }, null, 2) + '\n');
} else {
  process.stdout.write('\n');
  process.stdout.write(`══════════════════════════════════════════════\n`);
  process.stdout.write(`${anyFail ? '✗ AT LEAST ONE SUITE FAILED' : '✓ ALL CONTRACT SUITES GREEN'} (${totalDt}s)\n`);
  process.stdout.write(`══════════════════════════════════════════════\n`);
}

process.exit(anyFail ? 1 : 0);

/* Helper class — kept at the bottom because contract suite imports
   happen above and we don't want it hoisted-and-misinterpreted. */
function _SuiteExitSentinel(code) {
  this.code = code;
  this.name = '_SuiteExitSentinel';
}
_SuiteExitSentinel.prototype = Object.create(Error.prototype);
