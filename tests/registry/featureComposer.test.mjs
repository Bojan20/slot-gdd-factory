/**
 * tests/registry/featureComposer.test.mjs
 *
 * UQ-DEEP-AJ · P1A contract test for src/registry/featureComposer.mjs.
 *
 * Pass/fail counter pattern mirrors tests/blocks/cellOverflowCounter.test.mjs.
 * Run: node tests/registry/featureComposer.test.mjs
 * Exit 0 = PASS, 1 = FAIL.
 */
import {
  composeFeatureContributions,
  defaultConfig,
  toExecutorInputs,
  KNOWN_FEATURE_KINDS,
  DEFAULT_CONTRIBUTION,
} from '../../src/registry/featureComposer.mjs';

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('featureComposer contract');

/* ──────────────────────────────────────────────────────────────────────────
 * 1. defaultConfig frozen + schemaVersion='1'
 * ────────────────────────────────────────────────────────────────────────── */
const def = defaultConfig();
t('defaultConfig frozen',                 Object.isFrozen(def));
t('defaultConfig schemaVersion = "1"',    def.schemaVersion === '1');
t('defaultConfig exposes knownKinds',     Array.isArray(def.knownKinds) && def.knownKinds.length === 15);
t('defaultConfig baseRtpFloor = 0.30',    def.baseRtpFloor === 0.30);

/* ──────────────────────────────────────────────────────────────────────────
 * 2. model with only freeSpins → composer emits 1 feature, base correct
 * ────────────────────────────────────────────────────────────────────────── */
const m2 = { features: [{ kind: 'free_spins' }], freeSpins: { enabled: true } };
const r2 = composeFeatureContributions(m2, { fsLine: 15 }, { cfTargetRtp: 0.96 });
t('fs-only: emits 1 feature',             r2.features.length === 1);
t('fs-only: kind normalized to freeSpins', r2.features[0].kind === 'freeSpins');
t('fs-only: declared 15% → contribution 0.15', Math.abs(r2.features[0].contribution - 0.15) < 1e-9);
t('fs-only: source = declared',           r2.features[0].source === 'declared');
t('fs-only: schemaVersion stamped',       r2.schemaVersion === '1');
t('fs-only: baseRtp = target - fs (0.81)', Math.abs(r2.baseRtp - 0.81) < 1e-9);

/* ──────────────────────────────────────────────────────────────────────────
 * 3. fs + hnw + cluster → 3 features, base correctly residual
 * ────────────────────────────────────────────────────────────────────────── */
const m3 = {
  features: [{ kind: 'free_spins' }, { kind: 'hold_and_win' }, { kind: 'cluster_pays' }],
  freeSpins: { enabled: true },
  holdAndWin: { enabled: true, triggerCount: 6 },
};
const r3 = composeFeatureContributions(m3, {}, { cfTargetRtp: 0.96 });
t('fs+hnw+cluster: 3 features emitted',   r3.features.length === 3);
const _r3kinds = r3.features.map(f => f.kind).sort();
t('fs+hnw+cluster: kinds set correct',    JSON.stringify(_r3kinds) === JSON.stringify(['cluster', 'freeSpins', 'holdAndWin']));
const _sumR3 = r3.features.reduce((s, f) => s + f.contribution, 0);
t('fs+hnw+cluster: feature sum + base ≈ target', Math.abs((r3.baseRtp + _sumR3) - r3.totalRtp) < 1e-9);
t('fs+hnw+cluster: gapInferenceUsed=true (all defaults)', r3.gapInferenceUsed === true);

/* ──────────────────────────────────────────────────────────────────────────
 * 4. declared.clusterLine present → cluster sessionE derived from declared / triggerP
 * ────────────────────────────────────────────────────────────────────────── */
const m4 = { features: [{ kind: 'cluster_pays' }] };
const r4 = composeFeatureContributions(m4, { clusterLine: 0.18 }, { cfTargetRtp: 0.96 });
const cl4 = r4.features.find(f => f.kind === 'cluster');
t('cluster declared: contribution = 0.18',         Math.abs(cl4.contribution - 0.18) < 1e-9);
t('cluster declared: source = declared',           cl4.source === 'declared');
/* sessionE = contribution / triggerP = 0.18 / 0.21 (default trigP for cluster). */
t('cluster declared: sessionE = 0.18 / 0.21',      Math.abs(cl4.sessionExpectedValue - (0.18 / 0.21)) < 1e-9);

/* ──────────────────────────────────────────────────────────────────────────
 * 5. NO declared, NO config, just feature kind → industry default applied
 * ────────────────────────────────────────────────────────────────────────── */
const m5 = { features: [{ kind: 'multiplier' }, { kind: 'jackpot' }] };
const r5 = composeFeatureContributions(m5, {}, { cfTargetRtp: 0.96 });
const m5kinds = r5.features.map(f => f.kind);
const mult5 = r5.features.find(f => f.kind === 'multiplier');
const jp5 = r5.features.find(f => f.kind === 'jackpot');
t('industry default: multiplier present',          m5kinds.includes('multiplier'));
t('industry default: jackpot present',             m5kinds.includes('jackpot'));
t('industry default: multiplier contribution = 0.08', Math.abs(mult5.contribution - DEFAULT_CONTRIBUTION.multiplier) < 1e-9);
t('industry default: jackpot contribution = 0.01', Math.abs(jp5.contribution - DEFAULT_CONTRIBUTION.jackpot) < 1e-9);
t('industry default: source = default',            mult5.source === 'default' && jp5.source === 'default');
t('industry default: gapInferenceUsed = true',     r5.gapInferenceUsed === true);

/* ──────────────────────────────────────────────────────────────────────────
 * 6. Unknown feature kind → skipped, not crashed
 * ────────────────────────────────────────────────────────────────────────── */
const m6 = { features: [{ kind: 'unicorn_dance' }, { kind: 'free_spins' }, { kind: 'mystery_potion' }] };
let r6;
let r6err = null;
try { r6 = composeFeatureContributions(m6, {}, { cfTargetRtp: 0.96 }); }
catch (e) { r6err = e; }
t('unknown kind: no exception',           r6err === null);
t('unknown kind: only freeSpins emitted', r6 && r6.features.length === 1 && r6.features[0].kind === 'freeSpins');

/* ──────────────────────────────────────────────────────────────────────────
 * 7. Empty model.features → only base_rtp = cfTargetRtp
 * ────────────────────────────────────────────────────────────────────────── */
const r7 = composeFeatureContributions({ features: [] }, {}, { cfTargetRtp: 0.96 });
t('empty features: 0 features',           r7.features.length === 0);
t('empty features: baseRtp = cfTarget',   Math.abs(r7.baseRtp - 0.96) < 1e-9);
t('empty features: totalRtp = cfTarget',  Math.abs(r7.totalRtp - 0.96) < 1e-9);
t('empty features: gapInferenceUsed=false', r7.gapInferenceUsed === false);

/* ──────────────────────────────────────────────────────────────────────────
 * 8. cfTargetRtp clamp: features > target → baseRtp clamped to floor 0.30
 * ────────────────────────────────────────────────────────────────────────── */
const m8 = { features: [{ kind: 'hold_and_win' }, { kind: 'free_spins' }, { kind: 'megaways' }],
  freeSpins: { enabled: true }, holdAndWin: { enabled: true, triggerCount: 6 } };
/* Defaults: hnw=0.36 + fs=0.15 + megaways=0.10 = 0.61. cfTarget 0.50 → residual = -0.11 → clamp to 0.30. */
const r8 = composeFeatureContributions(m8, {}, { cfTargetRtp: 0.50 });
t('over-allocated: baseRtp clamped to 0.30 floor', Math.abs(r8.baseRtp - 0.30) < 1e-9);
t('over-allocated: 3 features still emitted',      r8.features.length === 3);

/* ──────────────────────────────────────────────────────────────────────────
 * 9. Numeric stability: sum(contributions) + baseRtp ≈ cfTargetRtp within 1e-9
 *    (when no clamping). Pick a clean scenario.
 * ────────────────────────────────────────────────────────────────────────── */
const m9 = { features: [{ kind: 'free_spins' }, { kind: 'cluster_pays' }, { kind: 'cascade' }],
  freeSpins: { enabled: true } };
const r9 = composeFeatureContributions(m9, {}, { cfTargetRtp: 0.96 });
const sum9 = r9.features.reduce((s, f) => s + f.contribution, 0);
t('numeric stability: sum + base ≈ target',
  Math.abs((sum9 + r9.baseRtp) - 0.96) < 1e-9);

/* ──────────────────────────────────────────────────────────────────────────
 * 10. Schema version stamp present in output
 * ────────────────────────────────────────────────────────────────────────── */
t('output: schemaVersion = "1"',          r9.schemaVersion === '1');

/* ──────────────────────────────────────────────────────────────────────────
 * Bonus: legacy executor inputs adapter
 * ────────────────────────────────────────────────────────────────────────── */
const execIn = toExecutorInputs(r3, { cfTargetRtp: 0.96 });
t('toExecutorInputs: fs+hnw fields set',
  typeof execIn.fsTriggerProbability === 'number' && typeof execIn.hnwTriggerProbability === 'number');
t('toExecutorInputs: base = target - fs - hnw - other',
  Math.abs(execIn.baseRtp - (0.96 - (r3.features.find(f => f.kind === 'freeSpins').contribution)
                                  - (r3.features.find(f => f.kind === 'holdAndWin').contribution)
                                  - (r3.features.find(f => f.kind === 'cluster').contribution))) < 1e-9);

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
