/**
 * tests/blocks/randomWildBurst.test.mjs
 * Wave LEGO-RANDOM (B-3) — pure Node tests for randomWildBurst block.
 */
import {
  defaultConfig,
  resolveConfig,
  emitRandomWildBurstCSS,
  emitRandomWildBurstMarkup,
  emitRandomWildBurstRuntime,
} from '../../src/blocks/randomWildBurst.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== randomWildBurst block (LEGO-RANDOM B-3) ===');

/* ── defaults ─────────────────────────────────────────────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default burstChance 0.07', d.burstChance === 0.07);
t('default minCells 2', d.minCells === 2);
t('default maxCells 6', d.maxCells === 6);
t('default cooldownSpins 4', d.cooldownSpins === 4);
t('default maxCellFraction 0.4', d.maxCellFraction === 0.4);

/* ── auto-enable from features ────────────────────────────────────── */
const r1 = resolveConfig({ features: [{ kind: 'random_wild_burst' }] });
t('auto-enable from random_wild_burst', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'random_wilds' }] });
t('auto-enable from random_wilds alias', r1b.enabled === true);

/* ── explicit enable + overrides ──────────────────────────────────── */
const r2 = resolveConfig({
  randomWildBurst: { enabled: true, burstChance: 0.2, minCells: 4, maxCells: 8, cooldownSpins: 10 },
});
t('explicit enable honored', r2.enabled === true);
t('burstChance override', r2.burstChance === 0.2);
t('minCells override', r2.minCells === 4);
t('maxCells override', r2.maxCells === 8);
t('cooldownSpins override', r2.cooldownSpins === 10);

/* ── inverted range correction ────────────────────────────────────── */
const rRange = resolveConfig({
  randomWildBurst: { enabled: true, minCells: 10, maxCells: 5 },
});
t('maxCells clamped up to minCells when inverted', rRange.maxCells >= rRange.minCells);

/* ── clamp out-of-range ───────────────────────────────────────────── */
const rClamp = resolveConfig({
  randomWildBurst: { enabled: true, burstChance: 5, minCells: -3, maxCells: 999, cooldownSpins: -10, maxCellFraction: 2 },
});
t('clamp burstChance ≤ 1', rClamp.burstChance === 1);
t('clamp minCells ≥ 1', rClamp.minCells === 1);
t('clamp maxCells ≤ 30', rClamp.maxCells === 30);
t('clamp cooldownSpins ≥ 0', rClamp.cooldownSpins === 0);
t('clamp maxCellFraction ≤ 1', rClamp.maxCellFraction === 1.0);

/* ── CSS emit ─────────────────────────────────────────────────────── */
const cssOff = emitRandomWildBurstCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');

const css = emitRandomWildBurstCSS(r1);
t('CSS has rwb-flash class', css.includes('.rwb-flash'));
t('CSS has rwb-cell-halo class', css.includes('.rwb-cell-halo'));
t('CSS has rwb-live sr-only', css.includes('.rwb-live'));
t('CSS has reduced-motion media', css.includes('prefers-reduced-motion'));

/* ── Markup emit ──────────────────────────────────────────────────── */
const markupOff = emitRandomWildBurstMarkup(defaultConfig());
t('markup empty when disabled', markupOff === '');

const markup = emitRandomWildBurstMarkup(r1);
t('markup has flash overlay element', markup.includes('id="rwbFlash"'));
t('markup has live region', markup.includes('id="rwbLive"'));
t('markup has role=status', markup.includes('role="status"'));
t('markup has aria-live=polite', markup.includes('aria-live="polite"'));
t('markup has aria-hidden on flash', markup.includes('aria-hidden="true"'));

/* ── Runtime emit ─────────────────────────────────────────────────── */
const rtOff = emitRandomWildBurstRuntime(defaultConfig());
t('runtime stub when disabled', rtOff.includes('disabled'));

const rt = emitRandomWildBurstRuntime(r1);
t('runtime declares RWB_CHANCE', rt.includes('RWB_CHANCE'));
t('runtime declares RWB_MIN/MAX', rt.includes('RWB_MIN') && rt.includes('RWB_MAX'));
t('runtime declares RWB_COOLDOWN', rt.includes('RWB_COOLDOWN'));
t('runtime has fireBurst function', rt.includes('function fireBurst'));
t('runtime has pickCellCount function', rt.includes('function pickCellCount'));
t('runtime uses Fisher-Yates sampling', rt.includes('Fisher-Yates') || rt.includes('pool.length - i'));
t('runtime exposes __RANDOM_WILD_BURST__ math hook', rt.includes('__RANDOM_WILD_BURST__'));
t('runtime emits onRandomWildBurstFired', rt.includes('onRandomWildBurstFired'));
t('runtime listens onSpinResult', rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime sets is-wild class on planted cells', rt.includes("'is-wild'"));
t('runtime writes a11y live region', rt.includes('live.textContent'));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
