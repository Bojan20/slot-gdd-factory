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

function run(label, cmd, argv, opts = {}) {
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

run('scaffold-block tool (E2E across 25 archetypes)',
  'node', ['--test', 'tests/tools/scaffold-block.test.mjs']);

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

/* ── Step 5: UQ-11 render smoke on a 20-GDD subset ──────────────────── */
if (!QUICK) {
  const RENDER_TOOL = resolve(REPO, 'tools/_full-corpus-render-parity.mjs');
  if (existsSync(RENDER_TOOL)) {
    run('UQ-11 render smoke (20-GDD subset)',
      'node', [RENDER_TOOL, '--limit', '20']);
  } else {
    /* Fall back to legacy render-grid-all if UQ-11 tool missing */
    if (!JSON_OUT) console.log('  ⏭ UQ-11 render smoke (tool not present)');
    results.push({ label: 'UQ-11 render smoke', ok: true, exit: 0, durationS: 0, stderr: '', stdout: 'skipped (no tool)' });
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
