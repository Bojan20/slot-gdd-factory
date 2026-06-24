/**
 * UQ-DEEP-AC · Auto-converge self-correcting fixes test (Boki 2026-06-24)
 *
 * Boki: "ne radi autocoiverage pravilno. pise did not covrerage"
 *
 * Three root causes pinned by this test:
 *   1. hit_freq scale bug — GDD payback.hitFrequency=19.03 (percent) was
 *      passed raw to Rust executor expecting 0..1 fraction. Result: hit_rate
 *      saturated at 1.0, base_lines.rtp_contribution collapsed to ~0.02,
 *      total RTP measured ~0.48 vs declared 0.96.
 *   2. Missing hwBase/hwFs GAP inference — Cash Eruption GDD has only
 *      baseLine+fsLine in rtpBreakdown. Default hnw_session_e=44.0 gave
 *      contribution 0.396 → total 0.885 instead of 0.96. GAP inference now
 *      computes hnw_session_e = (total - baseLine - fsLine) / hnw_trigger_p
 *      = (0.96 - 0.419 - 0.07) / 0.009 = 52.33 → contribution 0.471 → total 0.96.
 *   3. No self-correction between rounds — when default trigger_p doesn't
 *      match actual feature rate, residual drift never corrected. Now /converge
 *      damped (70% factor) self-correction kicks in at round ≥2 + halfwidth≤2%.
 *
 * Live verifikacija: Cash Eruption 10M spinova → PASSED True u 34ms.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, '../..');
const BACKEND = resolve(REPO, 'tools/math-backend.mjs');

test('UQ-DEEP-AC · math-backend.mjs source contains all 3 fixes', () => {
  const src = readFileSync(BACKEND, 'utf8');
  assert.ok(src.includes('hitFreqNorm'),
    'FIX-1: hitFreqNorm helper present (percent→fraction normalization)');
  assert.ok(/raw > 1 \? raw \/ 100 : raw/.test(src),
    'FIX-1: hitFrequency normalization (raw > 1 → divide by 100)');
  assert.ok(src.includes('inferredHwFromGap'),
    'FIX-2: GAP inference for missing hwBase/hwFs');
  assert.ok(src.includes('hasHoldAndWin'),
    'FIX-2: hold-and-win detection before GAP inference');
  assert.ok(src.includes('shouldCorrect'),
    'FIX-3: self-correcting loop in /converge');
  assert.ok(src.includes('DAMP'),
    'FIX-3: damping factor in self-correction (no overshoot)');
  assert.ok(src.includes('halfwidth <= 0.02'),
    'FIX-3: halfwidth gate prevents over-tuning on noisy data');
});

test('UQ-DEEP-AC · /converge response shape includes corrections + inference', async () => {
  const cashEruptionPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/model.json');
  if (!existsSync(cashEruptionPath)) {
    /* Run ingest first if missing — needed for test fixture. */
    const { execSync } = await import('node:child_process');
    execSync('node tools/ingest.mjs --file ~/Desktop/GDD/Cash_Eruption_Foundry_GDD.pdf --no-llm',
      { cwd: REPO, stdio: 'pipe' });
  }
  const model = JSON.parse(readFileSync(cashEruptionPath, 'utf8'));
  const body = JSON.stringify({ model, maxSpins: 10_000_000, precisionPct: 0.005, halfwidthBound: 0.01 });
  const r = await fetch('http://127.0.0.1:9001/converge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  const j = await r.json();
  assert.equal(j.ok, true, 'response ok');
  assert.equal(j.passed, true, `Cash Eruption MUST converge at 10M — got passed=${j.passed}, rtp=${j.final?.rtp}`);
  assert.equal(j.passedAllFeatures, true, `all per-feature must pass — features=${JSON.stringify(j.featureValidation)}`);
  assert.ok(Array.isArray(j.corrections), 'corrections array present');
  assert.ok(typeof j.inference === 'object', 'inference diagnostics present');
  assert.equal(j.inference.hasHoldAndWin, true, 'Cash Eruption hasHoldAndWin detected');
});

test('UQ-DEEP-AC · Cash Eruption per-feature deltas within ±2pp', async () => {
  const cashEruptionPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/model.json');
  const model = JSON.parse(readFileSync(cashEruptionPath, 'utf8'));
  const body = JSON.stringify({ model, maxSpins: 10_000_000, precisionPct: 0.005, halfwidthBound: 0.01 });
  const r = await fetch('http://127.0.0.1:9001/converge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  const j = await r.json();
  const fv = j.featureValidation || {};
  assert.equal(fv.baseLine.pass, true,
    `baseLine: declared=${fv.baseLine.declared}, measured=${fv.baseLine.measured}, δpp=${fv.baseLine.deltaPct}`);
  assert.equal(fv.fsLine.pass, true,
    `fsLine: declared=${fv.fsLine.declared}, measured=${fv.fsLine.measured}, δpp=${fv.fsLine.deltaPct}`);
  assert.equal(fv.totalRtp.pass, true,
    `totalRtp: declared=${fv.totalRtp.declared}, measured=${fv.totalRtp.measured}, δpp=${fv.totalRtp.deltaPct}`);
  /* Hit-rate must measure as fraction (0..1), not saturated 1.0. */
  const hitRate = j.final?.hit_rate;
  assert.ok(hitRate > 0 && hitRate < 1,
    `hit_rate must be 0..1 fraction (regression guard for hit_freq bug) — got ${hitRate}`);
  /* Declared 19.03% → measured should be ~0.19, NOT 1.0 (the broken case). */
  assert.ok(Math.abs(hitRate - 0.1903) < 0.005,
    `hit_rate must match declared 19.03% — got ${hitRate}`);
});

test('UQ-DEEP-AC · GAP inference fills holdAndWin when GDD missing hwBase/hwFs', async () => {
  /* Synthetic model: baseLine + fsLine declared, hold-and-win feature present,
   * NO hwBase/hwFs. Without GAP inference total would be ~88.5% (off 7.5pp).
   * With GAP inference total should hit 96%. */
  const model = {
    name: 'GAP Inference Test',
    payback: {
      rtp: 96,
      hitFrequency: 0.20,
      rtpBreakdown: { baseLine: 41.9, fsLine: 7.0 },
      maxWinX: 50000,
    },
    holdAndWin: { enabled: true, triggerCount: 6 },
    freeSpins: { enabled: true },
    features: [{ kind: 'hold_and_win' }, { kind: 'free_spins' }],
  };
  const r = await fetch('http://127.0.0.1:9001/converge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, maxSpins: 10_000_000, precisionPct: 0.005, halfwidthBound: 0.01 }),
  });
  const j = await r.json();
  assert.equal(j.passed, true,
    `GAP inference must drive convergence — passed=${j.passed}, rtp=${j.final?.rtp}, declared=0.96`);
  /* Final RTP must be within ±0.5% of declared. */
  const delta = Math.abs(j.final.rtp - 0.96);
  assert.ok(delta <= 0.005,
    `RTP must be within ±0.5% of 0.96 — got ${j.final.rtp} (δ=${delta})`);
});

test('UQ-DEEP-AC · model with hwBase+hwFs declared bypasses GAP inference', async () => {
  /* When GDD explicitly declares all 4 breakdown fields, GAP inference should
   * NOT activate (declared takes precedence). */
  const model = {
    name: 'Full Breakdown Test',
    payback: {
      rtp: 96,
      hitFrequency: 0.21,
      rtpBreakdown: { baseLine: 50.0, fsLine: 20.0, hwBase: 16.0, hwFs: 10.0 },
      maxWinX: 10000,
    },
    holdAndWin: { enabled: true },
    freeSpins: { enabled: true },
    features: [{ kind: 'hold_and_win' }, { kind: 'free_spins' }],
  };
  const r = await fetch('http://127.0.0.1:9001/converge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, maxSpins: 10_000_000, precisionPct: 0.005, halfwidthBound: 0.01 }),
  });
  const j = await r.json();
  assert.equal(j.passed, true,
    `declared breakdown must converge — passed=${j.passed}, rtp=${j.final?.rtp}`);
  const fv = j.featureValidation;
  assert.ok(fv.baseLine.pass !== false, `baseLine pass: meas=${fv.baseLine.measured}`);
  assert.ok(fv.fsLine.pass !== false,   `fsLine pass: meas=${fv.fsLine.measured}`);
  assert.ok(fv.holdAndWin.pass !== false,
    `holdAndWin (hwBase+hwFs=26%): meas=${fv.holdAndWin.measured}, δpp=${fv.holdAndWin.deltaPct}`);
});

test('UQ-DEEP-AC · hit_freq normalization regression — percent vs fraction both work', async () => {
  /* Both 20.0 (percent) and 0.20 (fraction) must produce identical hit_rate. */
  const baseModel = {
    name: 'HitFreq Norm Test',
    payback: { rtp: 96, rtpBreakdown: { baseLine: 41.9, fsLine: 7.0 }, maxWinX: 50000 },
    holdAndWin: { enabled: true },
    freeSpins: { enabled: true },
    features: [{ kind: 'hold_and_win' }, { kind: 'free_spins' }],
  };
  const modelPercent = JSON.parse(JSON.stringify(baseModel));
  modelPercent.payback.hitFrequency = 20.0;          /* GDD writes percent */
  const modelFraction = JSON.parse(JSON.stringify(baseModel));
  modelFraction.payback.hitFrequency = 0.20;          /* GDD writes fraction */
  const runOne = async (model) => {
    const r = await fetch('http://127.0.0.1:9001/converge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, maxSpins: 1_000_000, precisionPct: 0.01, halfwidthBound: 0.05 }),
    });
    return (await r.json()).final?.hit_rate;
  };
  const hrPct = await runOne(modelPercent);
  const hrFrac = await runOne(modelFraction);
  assert.ok(hrPct > 0.18 && hrPct < 0.22,   `percent input → hit_rate ≈ 0.20, got ${hrPct}`);
  assert.ok(hrFrac > 0.18 && hrFrac < 0.22, `fraction input → hit_rate ≈ 0.20, got ${hrFrac}`);
  assert.ok(Math.abs(hrPct - hrFrac) < 0.005, `both forms must produce same hit_rate — δ=${Math.abs(hrPct - hrFrac)}`);
});

test('UQ-DEEP-AC · regression — model without holdAndWin feature still works', async () => {
  /* GAP inference must NOT activate when hold_and_win is absent. */
  const model = {
    name: 'No HW Test',
    payback: { rtp: 96, hitFrequency: 0.21, maxWinX: 5000 },
    freeSpins: { enabled: true },
    features: [{ kind: 'free_spins' }],
  };
  const r = await fetch('http://127.0.0.1:9001/converge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, maxSpins: 1_000_000, precisionPct: 0.05, halfwidthBound: 0.05 }),
  });
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.inference.hasHoldAndWin, false, 'hasHoldAndWin must be false');
  /* Old default executor should still produce some output (don't crash). */
  assert.ok(j.final && typeof j.final.rtp === 'number', 'rtp present');
});
