/**
 * UQ-DEEP-AD · BSP_MODEL pruning fix (Boki 2026-06-24)
 *
 * Boki live UI: "Auto-Converge ✗ DID NOT CONVERGE · measured 93.67% target 96.00%"
 *   baseLine ✓ (41.85% vs 41.90%, δ -0.05pp)
 *   fsLine   ✓ (7.00% vs 7.00%, δ -0.00pp)
 *   totalRtp ✗ (93.67% vs 96.00%, δ 2.33pp)
 *
 * ROOT CAUSE:
 *   src/blocks/batchSimulatorPanel.mjs emitBatchSimulatorPanelRuntime() pruned
 *   model za browser BSP_MODEL na SAMO { payback, freeSpins.trigger/session }.
 *   Backend GAP inference (UQ-DEEP-AC) detektuje hold-and-win preko
 *   `model.holdAndWin.enabled` OR `model.features[].kind === 'hold_and_win'`.
 *   Bez ovih signala u BSP_MODEL → hasHoldAndWin=false → GAP inference NIJE
 *   fire-ovala → hnw_session_e ostao na default 44.0 (umesto 52.33 from GAP)
 *   → measured 93.67% umesto 96.00%.
 *
 * FIX: prune now includes holdAndWin params + features kind list (mali wire
 * payload, ne ceo model).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, '../..');
const PANEL = resolve(REPO, 'src/blocks/batchSimulatorPanel.mjs');

test('UQ-DEEP-AD · panel source emits holdAndWin + features in pruned BSP_MODEL', () => {
  const src = readFileSync(PANEL, 'utf8');
  /* Old pruning was: payback + freeSpins only. Regression guard. */
  assert.ok(src.includes('holdAndWin: model.holdAndWin'),
    'pruned must include holdAndWin block');
  assert.ok(src.includes('features:'),
    'pruned must include features array');
  assert.ok(src.includes("typeof f.kind === 'string'"),
    'features map keeps only entries with kind');
});

test('UQ-DEEP-AD · rendered Cash Eruption HTML contains holdAndWin + features in BSP_MODEL', () => {
  const html = readFileSync(resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html'), 'utf8');
  const m = html.match(/BSP_MODEL\s*=\s*(\{[^;]*\});/);
  assert.ok(m, 'BSP_MODEL assignment present in slot.html');
  const bspModel = JSON.parse(m[1]);
  assert.ok(bspModel.holdAndWin, 'holdAndWin field present');
  assert.equal(bspModel.holdAndWin.enabled, true, 'holdAndWin.enabled true for Cash Eruption');
  assert.ok(Array.isArray(bspModel.features), 'features array present');
  assert.ok(bspModel.features.some(f => f.kind === 'hold_and_win'),
    'features includes hold_and_win — required for backend GAP inference');
  assert.ok(bspModel.features.some(f => f.kind === 'free_spins'),
    'features includes free_spins');
});

test('UQ-DEEP-AD · live E2E — UI-shape pruned model converges via GAP inference', async () => {
  /* Reproduce browser POST body (pruned model only — confirms backend GAP
   * inference fires from holdAndWin + features kind signal alone). */
  const bspShapedModel = {
    name: 'Cash Eruption',
    payback: {
      rtp: 96,
      hitFrequency: 19.03,
      maxWinX: 50000,
      rtpBreakdown: { baseLine: 41.9, fsLine: 7 },
    },
    freeSpins: { enabled: true },
    holdAndWin: { enabled: true, triggerCount: 6 },
    features: [{ kind: 'free_spins' }, { kind: 'hold_and_win' }],
  };
  const r = await fetch('http://127.0.0.1:9001/converge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: bspShapedModel,
      maxSpins: 100_000_000,
      precisionPct: 0.005,
      halfwidthBound: 0.01,
    }),
  });
  const j = await r.json();
  assert.equal(j.inference.hasHoldAndWin, true,
    'pruned shape must still trigger hasHoldAndWin (regression guard for BSP_MODEL bug)');
  assert.equal(j.passed, true,
    `pruned shape MUST converge — passed=${j.passed}, rtp=${j.final?.rtp}`);
  /* Total RTP must hit 96% ± 0.5%. */
  const delta = Math.abs(j.final.rtp - 0.96);
  assert.ok(delta <= 0.005,
    `pruned model RTP must be within ±0.5% of 0.96 — got ${j.final.rtp} (δ=${delta})`);
});

test('UQ-DEEP-AD · regression — minimal model (no features/holdAndWin) still detected via features kind', async () => {
  /* If a future GDD has hold-and-win only via features kind (no holdAndWin
   * object), backend must still infer. */
  const model = {
    name: 'Kind-Only Test',
    payback: { rtp: 96, hitFrequency: 0.20, rtpBreakdown: { baseLine: 41.9, fsLine: 7 }, maxWinX: 5000 },
    features: [{ kind: 'hold_and_win' }, { kind: 'free_spins' }],
  };
  const r = await fetch('http://127.0.0.1:9001/converge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, maxSpins: 10_000_000, precisionPct: 0.01, halfwidthBound: 0.01 }),
  });
  const j = await r.json();
  assert.equal(j.inference.hasHoldAndWin, true,
    'features kind alone must trigger hasHoldAndWin');
  assert.equal(j.passed, true,
    `kind-only signal must converge — rtp=${j.final?.rtp}`);
});
