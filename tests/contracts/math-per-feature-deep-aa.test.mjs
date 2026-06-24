#!/usr/bin/env node
/**
 * tests/contracts/math-per-feature-deep-aa.test.mjs
 *
 * UQ-DEEP-AA (Boki 2026-06-24): "ne radi matematika. razlikuje se drasticno
 * rtp. Mora po standardima... u realnom vremenu da racuna sa svim proverama."
 *
 * Dijagnoza:
 *   GDD declares rtpBreakdown {baseLine: 41.9%, fsLine: 7%, hwBase: 40.91%,
 *   hwFs: 6.19%, total 96%}. PRE fix-a backend executor input koristio
 *   generic `base_rtp = cfTargetRtp * 0.38` → measured baseLine 36.4%
 *   (delta -5.5pp od declared 41.9). Total RTP slučajno hit 96% ali
 *   per-feature breakdown drastično off.
 *
 * Fix:
 *   1. buildExecutorInput konzumira declared rtpBreakdown ako postoji
 *   2. session_e kalibrisana: fs_session_e = declared.fsLine / fs_trigger_p
 *   3. /converge response uključuje featureValidation × 4 (baseLine, fsLine,
 *      holdAndWin, totalRtp, hitFrequency) sa per-feature pass/fail
 *   4. passedAllFeatures = passed AND every featureRow.pass !== false
 *
 * Exit 0 PASS, 1 FAIL.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name} — ${e.message}`); }
}

console.log('═══ math-per-feature-deep-aa.test.mjs ═══');

/* ────────────────────────────────────────────────────────────────────── */
/* Source stamps */

await test('SOURCE: buildExecutorInput reads rtpBreakdown', async () => {
  const src = readFileSync(resolve(REPO, 'tools/math-backend.mjs'), 'utf8');
  assert(src.includes('payback.rtpBreakdown'), 'rtpBreakdown read missing');
  assert(src.includes('declaredBase'), 'declaredBase var missing');
  assert(src.includes('declaredFsLine'), 'declaredFsLine var missing');
});

await test('SOURCE: session_e calibrated from declared fsLine/hwBase', async () => {
  const src = readFileSync(resolve(REPO, 'tools/math-backend.mjs'), 'utf8');
  assert(src.includes('declaredFsLine / fsTrigP'), 'fs_session_e calibration missing');
  assert(src.includes('declaredHwTotal / hnwTrigP'), 'hnw_session_e calibration missing');
});

await test('SOURCE: getDeclaredTargets helper exposed', async () => {
  const src = readFileSync(resolve(REPO, 'tools/math-backend.mjs'), 'utf8');
  assert(src.includes('function getDeclaredTargets'), 'helper function missing');
});

await test('SOURCE: /converge response includes featureValidation', async () => {
  const src = readFileSync(resolve(REPO, 'tools/math-backend.mjs'), 'utf8');
  assert(src.includes('featureValidation'), 'featureValidation key missing');
  assert(src.includes('passedAllFeatures'), 'passedAllFeatures flag missing');
});

/* ────────────────────────────────────────────────────────────────────── */
/* Live E2E: spawn backend, run /converge sa declared rtpBreakdown */

const TEST_PORT = 9150 + Math.floor(Math.random() * 30);
const child = spawn('node', [resolve(REPO, 'tools/math-backend.mjs'), '--port', String(TEST_PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 1500));

let actualPort = TEST_PORT;
try {
  for (let p = TEST_PORT; p < TEST_PORT + 10; p++) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/health`);
      if (r.ok) { actualPort = p; break; }
    } catch {}
  }
  const BASE = `http://127.0.0.1:${actualPort}`;

  await test('E2E /converge: Cash Eruption breakdown PASSES per-feature', async () => {
    const r = await fetch(`${BASE}/converge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: {
          payback: {
            rtp: 0.96,
            hitFrequency: 0.1903,
            maxWinX: 50000,
            rtpBreakdown: { baseLine: 0.419, fsLine: 0.07, hwBase: 0.4091, hwFs: 0.0619 },
          },
        },
        maxSpins: 10_000_000,
      }),
    });
    const j = await r.json();
    assert(j.passed === true, `total not passed: rtp=${j.final?.rtp}`);
    assert(j.passedAllFeatures === true, `per-feature not passed: ${JSON.stringify(j.featureValidation)}`);
    /* Each declared row must be within ±2pp tolerance. */
    const fv = j.featureValidation;
    assert(fv.baseLine.pass === true, `baseLine off: declared=${fv.baseLine.declared} measured=${fv.baseLine.measured}`);
    assert(fv.fsLine.pass === true, `fsLine off: declared=${fv.fsLine.declared} measured=${fv.fsLine.measured}`);
    assert(fv.holdAndWin.pass === true, `holdAndWin off: declared=${fv.holdAndWin.declared} measured=${fv.holdAndWin.measured}`);
    assert(fv.totalRtp.pass === true, `total off: declared=${fv.totalRtp.declared} measured=${fv.totalRtp.measured}`);
  });

  await test('E2E /converge: model without rtpBreakdown still works (regression guard)', async () => {
    const r = await fetch(`${BASE}/converge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { payback: { rtp: 0.96, hitFrequency: 0.21, maxWinX: 5000 } },
        maxSpins: 10_000_000,
      }),
    });
    const j = await r.json();
    assert(j.passed === true, `model without breakdown did not converge: ${j.final?.rtp}`);
    /* featureValidation rows will have declared=null for missing breakdown — that's OK. */
    assert(j.featureValidation, 'featureValidation always present');
  });

  await test('E2E /converge: declared returned echo', async () => {
    const r = await fetch(`${BASE}/converge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { payback: { rtp: 0.96, rtpBreakdown: { baseLine: 0.42 } } },
        maxSpins: 100_000,
      }),
    });
    const j = await r.json();
    assert(j.declared, 'declared object missing');
    assert(j.declared.baseLine === 0.42, `declared baseLine=${j.declared.baseLine}`);
    assert(j.declared.total === 0.96, `declared total=${j.declared.total}`);
  });

  await test('E2E /converge: per-feature delta calculated correctly', async () => {
    const r = await fetch(`${BASE}/converge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: {
          payback: {
            rtp: 0.96,
            hitFrequency: 0.1903,
            rtpBreakdown: { baseLine: 0.419, fsLine: 0.07, hwBase: 0.4091, hwFs: 0.0619 },
          },
        },
        maxSpins: 10_000_000,
      }),
    });
    const j = await r.json();
    const bl = j.featureValidation.baseLine;
    /* delta = measured - declared, deltaPct = delta * 100. */
    const expectedDelta = bl.measured - bl.declared;
    assert(Math.abs(bl.delta - expectedDelta) < 1e-10, `delta calc mismatch: ${bl.delta} vs ${expectedDelta}`);
    assert(Math.abs(bl.deltaPct - expectedDelta * 100) < 1e-8, `deltaPct mismatch`);
  });

} finally {
  try { child.kill('SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 300));
}

/* ────────────────────────────────────────────────────────────────────── */
/* UI: batchSimulatorPanel emits featureValidation render. */

await test('UI: batch panel renders per-feature ladder', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/batchSimulatorPanel.mjs'), 'utf8');
  assert(src.includes('featureValidation'), 'featureValidation read missing');
  assert(src.includes("'baseLine'"), 'baseLine row missing');
  assert(src.includes("'fsLine'"), 'fsLine row missing');
  assert(src.includes("'holdWin'"), 'holdWin label missing');
  assert(src.includes("'totalRtp'"), 'totalRtp row missing');
});

/* ────────────────────────────────────────────────────────────────────── */

console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
