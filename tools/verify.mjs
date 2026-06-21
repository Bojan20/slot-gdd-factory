#!/usr/bin/env node
/**
 * tools/verify.mjs
 *
 * Wave UQ-12 (2026-06-21) — Pre-commit gate.
 *
 * One orchestrator that runs the minimum "is the repo healthy?" set:
 *   1. featureArchetypes test          — 28 archetypes + alias + filter
 *   2. smartDefaults-archetype-backfill — stage 5 backfill plumbing
 *   3. scaffold-block tool test         — 25-archetype E2E scaffolding
 *   4. UQ-7 corpus audit                — assert unknownFeatureKinds = 0
 *   5. UQ-11 render smoke               — 20-GDD random subset build
 *
 * Exit code 0 = healthy, ≥ 1 = at least one gate failed.
 *
 * USAGE
 *   node tools/verify.mjs            — full gate
 *   node tools/verify.mjs --quick    — skip render smoke (steps 1-4 only)
 *   node tools/verify.mjs --json     — emit machine-readable summary
 *
 * INVOKED BY
 *   npm run verify
 *   git pre-commit hook (installed via tools/install-precommit.mjs)
 */
import { spawnSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const JSON_OUT = args.includes('--json');

const results = [];

/* Wave UQ-FORTIFY4 H1 — verify gate dependency tracking.
 * Steps may declare `dependsOn: [labels]`. If any upstream dep is in
 * results with ok=false, the dependent step is SKIPPED (not run) and
 * marked as `skipped: true` in results. Prevents downstream noise when
 * a foundational step (e.g. UQ-7 audit, semantic verifier) fails. */
function _isDepGreen(deps) {
  if (!Array.isArray(deps) || deps.length === 0) return true;
  for (const dep of deps) {
    const found = results.find(r => r.label === dep);
    if (!found || found.ok === false) return false;
  }
  return true;
}

function run(label, cmd, argv, opts = {}) {
  /* H1 — short-circuit if dependsOn fails. */
  if (opts.dependsOn && !_isDepGreen(opts.dependsOn)) {
    results.push({
      label, ok: false, exit: -1, durationS: 0,
      stderr: 'SKIPPED — dependency failed: ' + opts.dependsOn.join(', '),
      stdout: '',
      skipped: true,
    });
    if (!JSON_OUT) console.log(`  ⏭ ${label.padEnd(45)} (dep fail: ${opts.dependsOn.join(', ')})`);
    return false;
  }
  const t0 = Date.now();
  const r = spawnSync(cmd, argv, { cwd: REPO, encoding: 'utf8', ...opts });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = r.status === 0;
  results.push({
    label, ok,
    exit: r.status,
    durationS: parseFloat(dt),
    stderr: ok ? '' : (r.stderr || '').slice(-600),
    stdout: ok ? '' : (r.stdout || '').slice(-600),
  });
  if (!JSON_OUT) {
    const tag = ok ? '✓' : '✗';
    console.log(`  ${tag} ${label.padEnd(45)} (${dt}s)`);
    if (!ok) {
      console.log('    ── stderr (tail) ──');
      console.log('    ' + (r.stderr || '').trim().split('\n').slice(-10).join('\n    '));
      console.log('    ── stdout (tail) ──');
      console.log('    ' + (r.stdout || '').trim().split('\n').slice(-10).join('\n    '));
    }
  }
  return ok;
}

if (!JSON_OUT) console.log('\nUQ-12 pre-commit gate\n══════════════════════════════════════════════\n');

/* ── Step 1–3: Node test files ──────────────────────────────────────── */
run('archetype catalog + alias + filter',
  'node', ['--test', 'tests/registry/featureArchetypes.test.mjs']);

run('smartDefaults archetype backfill (stage 5)',
  'node', ['--test', 'tests/registry/smartDefaults-archetype-backfill.test.mjs']);

run('smartDefaults autofix gaps (stage 6)',
  'node', ['--test', 'tests/registry/smartDefaults-autofix.test.mjs']);

run('parser topology prose edge cases (UQ-CASH)',
  'node', ['--test', 'tests/blocks/parserTopologyProseEdge.test.mjs']);

run('scaffold-block tool (E2E across 25 archetypes)',
  'node', ['--test', 'tests/tools/scaffold-block.test.mjs']);

run('ingest tool (end-to-end pipeline)',
  'node', ['--test', 'tests/tools/ingest.test.mjs']);

run('archetype docs generator',
  'node', ['--test', 'tests/tools/gen-archetype-docs.test.mjs']);

run('install-precommit hook installer',
  'node', ['--test', 'tests/tools/install-precommit.test.mjs']);

run('UQ-FORTIFY3 third-tier audit fixes',
  'node', ['--test', 'tests/tools/uq-fortify3-thirdtier.test.mjs']);

run('UQ-FORTIFY5 fifth-tier audit fixes',
  'node', ['--test', 'tests/tools/uq-fortify5-fifthtier.test.mjs']);

/* ── Step 4: UQ-7 corpus audit (unknown must be 0) ──────────────────── */
const auditOk = run('UQ-7 cache audit',
  'node', ['tools/uq7-cache-audit.mjs', '--json']);
if (auditOk) {
  try {
    const txt = await readFile(resolve(REPO, 'tools/_eyes/uq7-report/uq7-summary.json'), 'utf8');
    const summary = JSON.parse(txt);
    const unk = Object.keys(summary.unknownFeatureKinds || {}).length;
    const auditPass = unk === 0;
    results.push({
      label: '  └ assert unknownFeatureKinds === 0',
      ok: auditPass,
      exit: auditPass ? 0 : 1,
      durationS: 0,
      stderr: auditPass ? '' : `${unk} unknown feature kinds: ${Object.keys(summary.unknownFeatureKinds).slice(0, 10).join(', ')}…`,
      stdout: '',
    });
    if (!JSON_OUT) {
      const tag = auditPass ? '✓' : '✗';
      console.log(`  ${tag} assert unknownFeatureKinds === 0 (got ${unk})`);
    }
  } catch (e) {
    results.push({ label: '  └ assert unknown=0 (read failed)', ok: false, exit: 1, durationS: 0, stderr: e.message, stdout: '' });
  }
}

/* ── Step 4.5: UQ-16 baseline drift on 20-slug smoke subset ─────────── */
const baselinePath = resolve(REPO, 'tests/baselines/uq16-render-baseline.json');
if (existsSync(baselinePath)) {
  run('UQ-16 baseline drift (20-slug subset)',
    'node', ['tools/uq16-baseline.mjs', '--limit', '20']);
} else {
  if (!JSON_OUT) console.log('  ⏭ UQ-16 baseline drift (no baseline — run --bake)');
}

/* ── Step 4.6: UQ-CASH A6 semantic accuracy verifier ─────────────────
 * Closes the gap that UQ-11/lw-25/parse-real opened: we check that the
 * parser produces SEMANTICALLY CORRECT models on 5 baseline GDDs, not
 * just that they don't throw. Pinned ground truth in
 * tests/fixtures/semantic-expected.json (≤80% asserts must pass for green).
 * H1 — depends on UQ-7 audit: if cache is broken, semantic verifier is
 * meaningless. */
const semVerifier = resolve(REPO, 'tools/uq-cash-semantic-verifier.mjs');
if (existsSync(semVerifier)) {
  run('UQ-CASH A6 semantic accuracy (5 baseline GDDs)',
    'node', [semVerifier],
    { dependsOn: ['UQ-7 cache audit'] });
} else if (!JSON_OUT) {
  console.log('  ⏭ UQ-CASH A6 semantic accuracy (no verifier tool)');
}

/* ── Step 4.7: UQ-TRAIN orchestrator E2E test ─────────────────────────
 * 8-pass orchestrator gate that exercises agents + parser + builder +
 * force chips + block activations end-to-end on 5 baseline GDDs.
 * Asserts agent V6 declared count > parser declared count (proves AI
 * is adding measurable value on top of regex baseline).
 * H1 — depends on semantic verifier (Pass 4 mirrors A6 ground truth). */
const e2eTool = resolve(REPO, 'tools/orchestrator-e2e-test.mjs');
if (existsSync(e2eTool)) {
  run('UQ-TRAIN orchestrator E2E (5 baseline GDDs · 8 passes)',
    'node', [e2eTool],
    { dependsOn: ['UQ-CASH A6 semantic accuracy (5 baseline GDDs)'] });
} else if (!JSON_OUT) {
  console.log('  ⏭ UQ-TRAIN orchestrator E2E (no tool)');
}

/* ── Step 4.8: UQ-FORTIFY2 G7 dirty PDF resilience ────────────────── */
const dirtyTool = resolve(REPO, 'tools/dirty-pdf-resilience-test.mjs');
if (existsSync(dirtyTool)) {
  run('UQ-FORTIFY2 G7 dirty PDF resilience',
    'node', [dirtyTool]);
}

/* ── Step 4.9: UQ-COVER cross-corpus force coverage ────────────────
 * Walks every V6 reconcile cache entry and asserts that every declared
 * feature has its force chip rendered (and no phantom chips are
 * rendered for features the GDD never declared). The 338-GDD corpus
 * is the most realistic stress test we have. */
const coverTool = resolve(REPO, 'tools/cross-corpus-force-coverage.mjs');
if (existsSync(coverTool)) {
  run('UQ-COVER cross-corpus force coverage (338 GDDs)',
    'node', [coverTool, '--limit', '60']);
}

/* ── Step 5: UQ-11 render smoke on a 20-GDD subset ──────────────────── */
if (!QUICK) {
  const RENDER_TOOL = resolve(REPO, 'tools/_full-corpus-render-parity.mjs');
  if (existsSync(RENDER_TOOL)) {
    run('UQ-11 render smoke (20-GDD subset)',
      'node', [RENDER_TOOL, '--limit', '20']);
  } else {
    /* UQ-12 audit fix: missing render tool is a hard FAIL, not a silent
       skip. The gate must protect the render pipeline; if the tool
       disappears the commit is blocked until it's restored. */
    const msg = 'render tool missing at tools/_full-corpus-render-parity.mjs';
    if (!JSON_OUT) console.log('  ✗ UQ-11 render smoke — ' + msg);
    results.push({ label: 'UQ-11 render smoke', ok: false, exit: 1, durationS: 0, stderr: msg, stdout: '' });
  }
} else if (!JSON_OUT) {
  console.log('  ⏭ UQ-11 render smoke (--quick)');
}

/* ── Summary ────────────────────────────────────────────────────────── */
const allOk = results.every(r => r.ok);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    runAt: new Date().toISOString(),
    overall: allOk ? 'pass' : 'fail',
    results,
  }, null, 2));
} else {
  console.log('\n══════════════════════════════════════════════');
  console.log(allOk ? '✓ ALL GATES GREEN — safe to commit' : '✗ AT LEAST ONE GATE FAILED — commit blocked');
  console.log('══════════════════════════════════════════════\n');
}

process.exit(allOk ? 0 : 1);
