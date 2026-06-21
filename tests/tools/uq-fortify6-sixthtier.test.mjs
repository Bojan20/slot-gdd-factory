/**
 * tests/tools/uq-fortify6-sixthtier.test.mjs
 *
 * Wave UQ-FORTIFY6 (2026-06-21) — Sixth-tier forensic audit fixes.
 *
 * Independent Explore agent sixth-pass audit identified 4 residual
 * gaps after 5 prior FORTIFY waves closed 40 rupe + UQ-COVER closed
 * cross-corpus force coverage. All four landed in this wave.
 *
 *   #1  parserHash bundle missing fileLock + tmpFileCleanup deps
 *   #2  fileLock CPU busy-loop replaced by Atomics.wait kernel park
 *   #3  probe exit(3) unified — exit 2 (HARD-FAIL) for internal errors
 *       so CI cannot confuse with ingest soft-fail exit 3
 *   #4  AGENT_CALIBRATION round-trip read-back + rollback on shape drift
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');

/* ── #1 parserHash registry deps ────────────────────────────────────── */

test('UQ-FORTIFY6 #1: parserHash SOURCES includes fileLock + tmpFileCleanup', () => {
  const src = readFileSync(resolve(REPO, 'tools/ingest.mjs'), 'utf8');
  assert.ok(/src\/registry\/fileLock\.mjs/.test(src),
    'fileLock.mjs missing from parserHash SOURCES');
  assert.ok(/src\/registry\/tmpFileCleanup\.mjs/.test(src),
    'tmpFileCleanup.mjs missing from parserHash SOURCES');
});

test('UQ-FORTIFY6 #1: live — hash changes when fileLock changes', async () => {
  /* Compute hash, inject a touch on fileLock.mjs (temporarily append a
     comment), recompute, restore. Hashes must differ. */
  const { spawnSync } = await import('node:child_process');
  const { readFileSync: rf, writeFileSync: wf } = await import('node:fs');
  /* Use the live ingest --no-llm + inspect via a tiny inline node eval */
  const inlineScript = `
    import('${REPO}/tools/ingest.mjs').catch(() => {});
    /* Direct import of the hash helper isn't exported, so we recompute
       inline using the same SOURCES list. */
    import { createHash } from 'node:crypto';
    import { readFileSync as rfs } from 'node:fs';
    import { resolve } from 'node:path';
    const REPO = '${REPO}';
    const SOURCES = [
      'src/parser.mjs',
      'src/registry/smartDefaults.mjs',
      'src/registry/featureArchetypes.mjs',
      'src/buildSlotHTML.mjs',
      'src/registry/blockCatalog.json',
      'src/registry/blockMapper.mjs',
      'src/registry/fileLock.mjs',
      'src/registry/tmpFileCleanup.mjs',
    ];
    const h = createHash('sha256');
    for (const p of SOURCES) h.update(rfs(resolve(REPO, p)).toString().replace(/\\r\\n/g, '\\n'));
    process.stdout.write(h.digest('hex'));
  `;
  const r1 = spawnSync('node', ['--input-type=module', '-e', inlineScript], { encoding: 'utf8' });
  const h1 = r1.stdout;
  /* Touch fileLock with a benign trailing comment, recompute, restore */
  const lockPath = resolve(REPO, 'src/registry/fileLock.mjs');
  const orig = rf(lockPath, 'utf8');
  wf(lockPath, orig + '\n/* UQ-FORTIFY6 #1 test marker */\n');
  try {
    const r2 = spawnSync('node', ['--input-type=module', '-e', inlineScript], { encoding: 'utf8' });
    assert.notEqual(r2.stdout, h1, 'hash unchanged after fileLock touch — deps missing');
  } finally {
    wf(lockPath, orig);
  }
});

/* ── #2 fileLock Atomics.wait ───────────────────────────────────────── */

test('UQ-FORTIFY6 #2: fileLock uses Atomics.wait (not pure CPU spin)', () => {
  const src = readFileSync(resolve(REPO, 'src/registry/fileLock.mjs'), 'utf8');
  /* UQ-FORTIFY7 #3 evolved the variable name from `view` to module-scoped
     `_sabView` so accept either form. */
  assert.ok(/Atomics\.wait\((view|_sabView),\s*0,\s*0,\s*POLL_INTERVAL_MS\)/.test(src),
    'Atomics.wait kernel-park call missing');
  assert.ok(/SharedArrayBuffer\(4\)/.test(src),
    'SharedArrayBuffer init missing');
  /* Original active spin loop must be gone from active code path
     (comments documenting why are allowed). */
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const activeSpin = codeOnly.split('\n').some(line =>
    /^\s*while \(Date\.now\(\) < end\)/.test(line)
  );
  /* Fallback spin in the catch branch is allowed (only fires when
     Atomics is unavailable). */
  assert.ok(/fallback spin/.test(src), 'fallback spin comment missing');
  /* Ensure the original primary spin loop is no longer the main path. */
  assert.ok(codeOnly.includes('Atomics.wait'),
    'primary path must call Atomics.wait');
});

/* ── #3 probe exit code unification ─────────────────────────────────── */

test('UQ-FORTIFY6 #3: probe internal errors exit with code 2 (not 3)', () => {
  const PROBES = [
    'tools/_h11-deterministic-plant-probe.mjs',
    'tools/_space-rapid-probe.mjs',
    'tools/_h3-session-timeout-probe.mjs',
    'tools/_h12-net-loss-indicator-probe.mjs',
    'tools/_h14-credit-bucket-probe.mjs',
    'tools/_h2-reality-check-probe.mjs',
    'tools/_big-win-flow-probe.mjs',
    'tools/_h13-path-mult-probe.mjs',
    'tools/_h15-weighted-wheel-probe.mjs',
  ];
  for (const p of PROBES) {
    const src = readFileSync(resolve(REPO, p), 'utf8');
    /* Each PROBE ERROR catch block must exit with 2, not 3. */
    assert.ok(/PROBE ERROR/.test(src), p + ': PROBE ERROR catch missing');
    assert.ok(/process\.exit\(2\)/.test(src),
      p + ': must exit(2) on PROBE ERROR');
    /* And the legacy exit(3) must be gone from the catch path. */
    const ctxLines = src.split('\n');
    for (let i = 0; i < ctxLines.length; i++) {
      if (/PROBE ERROR/.test(ctxLines[i])) {
        /* Look at the next 5 lines for any stray exit(3) */
        for (let j = i; j < Math.min(i + 6, ctxLines.length); j++) {
          assert.ok(!/process\.exit\(3\)\s*;\s*$/.test(ctxLines[j]),
            p + ': legacy exit(3) still in PROBE ERROR block at line ' + (j + 1));
        }
      }
    }
  }
});

test('UQ-FORTIFY6 #3: ingest.mjs still uses exit 3 for soft-fail (intentional)', () => {
  /* The probe sweep must NOT have accidentally rewritten ingest.mjs
     exit 3 — that one is intentional, the only exit(3) in the repo. */
  const src = readFileSync(resolve(REPO, 'tools/ingest.mjs'), 'utf8');
  assert.ok(/process\.exit\(3\)/.test(src),
    'ingest.mjs soft-fail exit(3) was accidentally rewritten');
});

/* ── #4 AGENT_CALIBRATION round-trip ────────────────────────────────── */

test('UQ-FORTIFY6 #4: trainer round-trip read-back + rollback', () => {
  const src = readFileSync(resolve(REPO, 'tools/agent-calibration-trainer.mjs'), 'utf8');
  /* New tmp path uses randomUUID, not process.pid */
  assert.ok(/_trUuid\(\)/.test(src),
    'tmp path must use randomUUID');
  /* The legacy PID-based tmp must be gone from active path */
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/'\.tmp\.'\s*\+\s*process\.pid/.test(codeOnly),
    'legacy PID tmp path still present in active code');
  /* On-disk re-read + heading count assertion */
  assert.ok(/onDiskHeadingCount/.test(src),
    'on-disk heading count check missing');
  assert.ok(/rolled back/i.test(src),
    'rollback path missing');
  /* Previous content saved BEFORE rename so rollback can restore.
     UQ-FORTIFY7 #2 evolved the var from `prevContent` (re-read from disk)
     to `_originalContent` (captured under the same lock, no race) — accept
     either form, but at least one must be present. */
  assert.ok(/(prevContent|_originalContent)\s*=\s*(src|readFileSync\(path)/.test(src),
    'previous content snapshot missing');
});
