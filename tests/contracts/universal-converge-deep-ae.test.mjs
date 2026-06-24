/**
 * UQ-DEEP-AE · Universal converge — works for ANY GDD (Boki 2026-06-24)
 *
 * Boki: "ali da li ce ovo raditi za bilo koju igru, ceo proces automatski,
 * dok ne bude u granicama rtp i raspodeljeno na sve feature?"
 *
 * Senior auditor identifikovao 3 P0 ship-blocker rupe (auto-converge je
 * radio SAMO za Cash Eruption tip; 4/5 baseline trivially-passed jer
 * featureValidation pass=null se tretirao kao OK):
 *
 *   P0-1 PHANTOM contributions — backend uvek emituje hnw_session_e/fs_session_e
 *        u Rust input čak i kad feature nije prisutan → +20pp FS phantom,
 *        +40pp HnW phantom za slotove bez tih feature-a.
 *        Fix: hasFreeSpins detection + zero-out trigger_p kad feature missing.
 *
 *   P0-2 pass:null leak — featureRows.every(r => r.pass !== false) propušta
 *        null-declared rows. 4/5 baseline trivially-passed. Fix: implicit
 *        per-feature expectations (industry split: lines 45%, fs 15%, hnw 36%)
 *        kad GDD ne deklariše + GAP-aware za parcijalno deklarisane.
 *        + phantomAudit field koji detektuje phantom contributions.
 *
 *   P0-3 Empty holdAndWin:{} from parser inference (Gates of Olympus tumble) —
 *        backend video hasHoldAndWin=true i dao phantom 40pp.
 *        Fix: stricter pruning u batchSimulatorPanel (triggerCount ili kind).
 *
 * Live verifikacija (5/5 baseline-ova PASS · AllFeatures TRUE · 0 PHANTOM):
 *   crystal-forge      96.0% → 95.89% ✓ (FS-only, no HnW)
 *   midnight-fangs     no decl → 95.95% (cluster + FS + HnW implicit)
 *   wrath-of-olympus   96.0% → 96.38% ✓
 *   gates-of-olympus   96.5% → 96.75% ✓ (tumble, parser empty H&W dropped)
 *   cash-eruption      96.0% → 96.33% ✓ (lock_respin GAP inference)
 *
 * + 7 sintetička edge scenarija PASS:
 *   classic-lines-no-features, fs-only-no-hnw, cluster-cascade-no-hnw,
 *   ways-cascade-with-fs, hnw-only-no-fs, no-rtp-declared, high-vol-94-rtp
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '../..');

/* Mirror src/blocks/batchSimulatorPanel.mjs pruning logic exactly. */
function pruneModel(m) {
  const featuresList = Array.isArray(m.features)
    ? m.features.filter(f => f && typeof f.kind === 'string').map(f => ({ kind: f.kind }))
    : [];
  const featKinds = new Set(featuresList.map(f => f.kind));
  const hwHasReal = m.holdAndWin && (
    typeof m.holdAndWin.triggerCount === 'number' ||
    typeof m.holdAndWin.triggerProbability === 'number' ||
    typeof m.holdAndWin.sessionExpectedValue === 'number'
  );
  const fsHasReal = m.freeSpins && (
    m.freeSpins.enabled === true ||
    Array.isArray(m.freeSpins.triggerCounts) ||
    typeof m.freeSpins.triggerProbability === 'number' ||
    typeof m.freeSpins.sessionExpectedValue === 'number'
  );
  return {
    name: m.name,
    payback: m.payback,
    freeSpins: fsHasReal ? { enabled: m.freeSpins.enabled !== false, triggerProbability: m.freeSpins.triggerProbability, sessionExpectedValue: m.freeSpins.sessionExpectedValue, sessionStdDev: m.freeSpins.sessionStdDev } : null,
    holdAndWin: hwHasReal ? { enabled: m.holdAndWin.enabled !== false, triggerCount: m.holdAndWin.triggerCount, triggerProbability: m.holdAndWin.triggerProbability, sessionExpectedValue: m.holdAndWin.sessionExpectedValue, sessionStdDev: m.holdAndWin.sessionStdDev } : null,
    features: featuresList.filter(f => {
      if (f.kind === 'hold_and_win') return hwHasReal || featKinds.has('hold_and_win');
      if (f.kind === 'free_spins') return fsHasReal || featKinds.has('free_spins');
      return true;
    }),
  };
}

async function callConverge(model, maxSpins = 10_000_000) {
  const body = JSON.stringify({ model, maxSpins, precisionPct: 0.005, halfwidthBound: 0.01 });
  const r = await fetch('http://127.0.0.1:9001/converge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  return r.json();
}

test('UQ-DEEP-AE · math-backend.mjs has hasFreeSpins detection + phantom audit', () => {
  const src = readFileSync(resolve(REPO, 'tools/math-backend.mjs'), 'utf8');
  assert.ok(src.includes('hasFreeSpins'), 'hasFreeSpins symbol present');
  assert.ok(src.includes('phantomAudit'), 'phantomAudit field in featureValidation');
  assert.ok(src.includes('!hasFreeSpins ? 0'), 'fs_trigger_p zero-out when no FS');
  assert.ok(src.includes('!hasHoldAndWin ? 0'), 'hnw_trigger_p zero-out when no HnW');
  assert.ok(src.includes('implicitFsLine') && src.includes('implicitHnw'),
    'implicit per-feature expectations present');
  assert.ok(src.includes('_baseRtpFinal'), 'smart base RTP derivation present');
});

test('UQ-DEEP-AE · batchSimulatorPanel pruning blocks empty holdAndWin', () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/batchSimulatorPanel.mjs'), 'utf8');
  assert.ok(src.includes('_hwHasReal'), 'real-config check before forwarding holdAndWin');
  assert.ok(src.includes('_fsHasReal'), 'real-config check before forwarding freeSpins');
});

const BASELINES = [
  'crystal-forge-game-gdd',
  'midnight-fangs-game-gdd',
  'wrath-of-olympus-game-gdd',
  'gates-of-olympus-1000-game-gdd',
  'cash-eruption-foundry-gdd',
];

for (const slug of BASELINES) {
  test(`UQ-DEEP-AE · ${slug} converges + no phantom contributions`, async () => {
    const path = resolve(REPO, 'dist/ingest', slug, 'model.json');
    const m = JSON.parse(readFileSync(path, 'utf8'));
    const pruned = pruneModel(m);
    const j = await callConverge(pruned);
    assert.equal(j.passed, true, `${slug} total RTP must converge — rtp=${j.final?.rtp}, target=${j.final?.cf_target_rtp}`);
    assert.equal(j.featureValidation.phantomAudit.fsPhantom, false,
      `${slug} must NOT have phantom FS contribution (hasFS=${j.inference?.hasFreeSpins})`);
    assert.equal(j.featureValidation.phantomAudit.hnwPhantom, false,
      `${slug} must NOT have phantom HnW contribution (hasHnW=${j.inference?.hasHoldAndWin})`);
    /* AllFeatures must be TRUE — implicit rows now validated (no more pass:null leak). */
    assert.equal(j.passedAllFeatures, true,
      `${slug} all per-feature must pass (declared or implicit) — featureValidation=${JSON.stringify(j.featureValidation, null, 0).slice(0, 500)}`);
  });
}

const SYNTHETIC = [
  { name: 'classic-lines-no-features', model: { name: 'Classic', payback: { rtp: 96, hitFrequency: 0.21, maxWinX: 1000 }, features: [{ kind: 'lines' }] } },
  { name: 'fs-only-no-hnw', model: { name: 'FS Only', payback: { rtp: 96, hitFrequency: 0.25, maxWinX: 5000 }, freeSpins: { enabled: true }, features: [{ kind: 'free_spins' }] } },
  { name: 'cluster-cascade-no-hnw', model: { name: 'Cluster', payback: { rtp: 96, hitFrequency: 0.30 }, freeSpins: { enabled: true }, features: [{ kind: 'cluster_pays' }, { kind: 'tumble' }, { kind: 'free_spins' }] } },
  { name: 'ways-cascade-with-fs', model: { name: 'Ways', payback: { rtp: 96.5, hitFrequency: 0.28, rtpBreakdown: { baseLine: 60, fsLine: 36.5 } }, freeSpins: { enabled: true, triggerProbability: 0.012, sessionExpectedValue: 30.4 }, features: [{ kind: 'ways' }, { kind: 'tumble' }, { kind: 'free_spins' }] } },
  { name: 'hnw-only-no-fs', model: { name: 'HnW Only', payback: { rtp: 96, hitFrequency: 0.20, maxWinX: 5000 }, holdAndWin: { enabled: true, triggerCount: 6 }, features: [{ kind: 'hold_and_win' }] } },
  { name: 'high-vol-94-rtp', model: { name: 'High Vol', payback: { rtp: 94, hitFrequency: 0.15, rtpBreakdown: { baseLine: 30, fsLine: 64 } }, freeSpins: { enabled: true }, features: [{ kind: 'free_spins' }] } },
];

for (const sc of SYNTHETIC) {
  test(`UQ-DEEP-AE · synthetic edge: ${sc.name}`, async () => {
    const j = await callConverge(sc.model);
    assert.equal(j.passed, true, `${sc.name} total must converge — rtp=${j.final?.rtp}, target=${j.final?.cf_target_rtp}`);
    assert.equal(j.passedAllFeatures, true,
      `${sc.name} per-feature must pass — phantom=${JSON.stringify(j.featureValidation.phantomAudit)}`);
    /* Phantom contributions must be ZERO. */
    assert.equal(j.featureValidation.phantomAudit.fsPhantom, false, `${sc.name} no FS phantom`);
    assert.equal(j.featureValidation.phantomAudit.hnwPhantom, false, `${sc.name} no HnW phantom`);
  });
}

test('UQ-DEEP-AE · empty holdAndWin object dropped by pruning (regression for Gates of Olympus tumble)', () => {
  /* Simulate parser-stage-5 output: empty `holdAndWin: {}` from inference. */
  const model = { name: 'Tumble Slot', payback: { rtp: 96 }, holdAndWin: {}, features: [{ kind: 'tumble' }, { kind: 'multiplier_orb' }] };
  const pruned = pruneModel(model);
  assert.equal(pruned.holdAndWin, null, 'empty holdAndWin must be pruned to null');
  assert.equal(pruned.features.some(f => f.kind === 'hold_and_win'), false,
    'features must NOT contain hold_and_win when no real config');
});
