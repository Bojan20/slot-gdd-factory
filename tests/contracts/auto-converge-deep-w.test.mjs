#!/usr/bin/env node
/**
 * tests/contracts/auto-converge-deep-w.test.mjs
 *
 * UQ-DEEP-W (Boki 2026-06-24): auto-converge endpoint + UI launcher.
 *
 * Stari problem: backend /batch sa 100K spinova daje halfwidth 7.78%
 * (>> 1% bound) → convergence_pass strict gate UVEK false. Boki: "target
 * uvek fail, ne za malo, uopste nije dobro odradjeno".
 *
 * Rešenje: novi POST /converge eskalira batch ladder 10K → 100K → 1M
 * → 10M → 100M dok pass=true ili maxSpins iscrpljen. UI dugme u batch
 * panel pokreće loop + prikazuje per-round progress.
 *
 * Exit 0 PASS, 1 FAIL.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name} — ${e.message}`); }
}

console.log('═══ auto-converge-deep-w.test.mjs ═══');

/* ────────────────────────────────────────────────────────────────────── */
/* Static stamps */

await test('Source: /converge endpoint registered in math-backend', async () => {
  const src = readFileSync(resolve(REPO, 'tools/math-backend.mjs'), 'utf8');
  assert(src.includes("p === '/converge'"), '/converge route missing');
  assert(src.includes('runBatchQueued'), 'queue runner not used');
  assert(src.includes('ladder'), 'ladder variable missing');
  assert(src.includes('passed'), 'passed flag missing');
});

await test('Source: ladder is 10K..100M geometric', async () => {
  const src = readFileSync(resolve(REPO, 'tools/math-backend.mjs'), 'utf8');
  assert(src.includes('10_000') && src.includes('100_000_000'),
    'ladder bounds missing');
  /* Confirm 5 ladder steps. */
  const ladderMatch = src.match(/const ladder = \[(.*?)\]\.filter/);
  assert(ladderMatch, 'ladder array not extractable');
  const sizes = ladderMatch[1].split(',').map(s => s.trim());
  assert(sizes.length === 5, `ladder should be 5 sizes, got ${sizes.length}`);
});

await test('UI: batchSimulatorPanel emits converge button + handler', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/batchSimulatorPanel.mjs'), 'utf8');
  assert(src.includes('bspConverge'), 'converge button id missing');
  assert(src.includes('bsp-converge-btn'), 'converge CSS class missing');
  assert(src.includes("BSP_BASE + '/converge'"), 'fetch /converge missing');
  assert(src.includes('Auto-Converge'), 'label text missing');
});

await test('UI: Cash Eruption rebuilt HTML contains converge launcher', async () => {
  const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');
  if (!existsSync(distPath)) throw new Error('dist not built — run ingest');
  const html = readFileSync(distPath, 'utf8');
  assert(html.includes('id="bspConverge"'), 'converge button not rendered');
  assert(html.includes('Auto-Converge'), 'label not rendered');
  assert(html.includes('bsp-converge-btn'), 'css class not rendered');
});

/* ────────────────────────────────────────────────────────────────────── */
/* Live E2E: spawn backend, hit /converge, verify convergence */

const TEST_PORT = 9120 + Math.floor(Math.random() * 30);
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

  await test('E2E /converge: returns rounds[] + passed flag', async () => {
    const r = await fetch(`${BASE}/converge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { payback: { rtp: 0.96, hitFrequency: 0.21, maxWinX: 5000 } },
        maxSpins: 10_000_000,
        precisionPct: 0.005,
        halfwidthBound: 0.01,
      }),
    });
    assert(r.ok, `HTTP ${r.status}`);
    const j = await r.json();
    assert(j.ok === true, 'ok flag missing');
    assert(Array.isArray(j.rounds), 'rounds array missing');
    assert(j.rounds.length >= 1, 'no rounds returned');
    assert(typeof j.passed === 'boolean', 'passed not boolean');
    assert(typeof j.totalSpins === 'number' && j.totalSpins > 0, 'totalSpins not positive');
    assert(j.final && typeof j.final.rtp === 'number', 'final.rtp missing');
  });

  await test('E2E /converge: 96% RTP model PASSES within 10M spinova', async () => {
    const r = await fetch(`${BASE}/converge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { payback: { rtp: 0.96, hitFrequency: 0.21, maxWinX: 5000 } },
        maxSpins: 10_000_000,
      }),
    });
    const j = await r.json();
    assert(j.passed === true,
      `did not converge — final rtp=${j.final?.rtp}, halfwidth=${j.final?.wilson_99_halfwidth}`);
    /* Final rtp must be within ±0.5% of declared 96%. */
    const delta = Math.abs(j.final.rtp - 0.96);
    assert(delta <= 0.005, `final delta ${delta * 100}% > 0.5%`);
  });

  await test('E2E /converge: precision override honored (laxer band 1% PASSES smaller batch)', async () => {
    const r = await fetch(`${BASE}/converge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { payback: { rtp: 0.96, hitFrequency: 0.21 } },
        maxSpins: 1_000_000,
        precisionPct: 0.01,       /* ±1% band */
        halfwidthBound: 0.025,    /* 2.5% CI */
      }),
    });
    const j = await r.json();
    /* With laxer criteria, ought to pass before reaching the 1M cap. */
    assert(j.passed === true, 'laxer convergence did not pass');
    assert(j.finalSpins <= 1_000_000, `escalated past 1M cap: ${j.finalSpins}`);
  });

  await test('E2E /converge: ladder is monotonic + last round attempted', async () => {
    const r = await fetch(`${BASE}/converge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { payback: { rtp: 0.96 } },
        maxSpins: 1_000_000,
      }),
    });
    const j = await r.json();
    assert(Array.isArray(j.rounds), 'rounds missing');
    /* Each subsequent round must have spins >= previous. */
    for (let i = 1; i < j.rounds.length; i++) {
      assert(j.rounds[i].spins > j.rounds[i - 1].spins,
        `round ${i} spins ${j.rounds[i].spins} not > ${j.rounds[i - 1].spins}`);
    }
    /* If passed=true, last round must have pass=true. */
    if (j.passed) {
      assert(j.rounds[j.rounds.length - 1].pass === true,
        'passed=true but last round.pass=false');
    }
  });

  await test('E2E /converge: criterion echoed back in response', async () => {
    const r = await fetch(`${BASE}/converge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { payback: { rtp: 0.96 } },
        maxSpins: 100_000,
        precisionPct: 0.003,
        halfwidthBound: 0.008,
      }),
    });
    const j = await r.json();
    assert(j.criterion, 'criterion echo missing');
    assert(j.criterion.precisionPct === 0.003, `precisionPct=${j.criterion.precisionPct}`);
    assert(j.criterion.halfwidthBound === 0.008, `halfwidthBound=${j.criterion.halfwidthBound}`);
  });

} finally {
  try { child.kill('SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 300));
}

/* ────────────────────────────────────────────────────────────────────── */

console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
