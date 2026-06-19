/**
 * tests/blocks/mysteryPrizeBox.test.mjs
 * Wave LEGO-RANDOM (B-3) — pure Node tests for mysteryPrizeBox block.
 */
import {
  defaultConfig,
  resolveConfig,
  emitMysteryPrizeBoxCSS,
  emitMysteryPrizeBoxMarkup,
  emitMysteryPrizeBoxRuntime,
} from '../../src/blocks/mysteryPrizeBox.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== mysteryPrizeBox block (LEGO-RANDOM B-3) ===');

/* ── defaults ─────────────────────────────────────────────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label MYSTERY PRIZE', d.label === 'MYSTERY PRIZE');
t('default dropChance 0.15', d.dropChance === 0.15);
t('default cooldownSpins 5', d.cooldownSpins === 5);
t('default autoDismissMs 4000', d.autoDismissMs === 4000);
t('default 4 tiers', d.tiers.length === 4);
t('default tier 0 small', d.tiers[0].id === 'small' && d.tiers[0].awardKind === 'credit');
t('default tier 3 bonus fs_trigger', d.tiers[3].id === 'bonus' && d.tiers[3].awardKind === 'fs_trigger');
t('frozen tiers', Object.isFrozen(d.tiers));

/* ── auto-enable from features ────────────────────────────────────── */
const r1 = resolveConfig({ features: [{ kind: 'mystery_prize_box' }] });
t('auto-enable from mystery_prize_box', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'random_prize_box' }] });
t('auto-enable from random_prize_box alias', r1b.enabled === true);

/* ── explicit enable + GDD overrides ──────────────────────────────── */
const r2 = resolveConfig({
  mysteryPrizeBox: { enabled: true, dropChance: 0.3, cooldownSpins: 10, autoDismissMs: 6000, label: 'PRIZE' },
});
t('explicit enabled honored', r2.enabled === true);
t('dropChance override', r2.dropChance === 0.3);
t('cooldownSpins override', r2.cooldownSpins === 10);
t('autoDismissMs override', r2.autoDismissMs === 6000);
t('label override', r2.label === 'PRIZE');

/* ── clamp out-of-range ───────────────────────────────────────────── */
const rClamp = resolveConfig({
  mysteryPrizeBox: { enabled: true, dropChance: 5, cooldownSpins: -10, autoDismissMs: 99999, revealHoldMs: 99999 },
});
t('clamp dropChance ≤ 1', rClamp.dropChance === 1);
t('clamp cooldownSpins ≥ 0', rClamp.cooldownSpins === 0);
t('clamp autoDismissMs ≤ 30000', rClamp.autoDismissMs === 30000);
t('clamp revealHoldMs ≤ 10000', rClamp.revealHoldMs === 10000);

/* ── tier validation ─────────────────────────────────────────────── */
const rTier = resolveConfig({
  mysteryPrizeBox: { enabled: true, tiers: [
    { id: 'a', label: 'A', weight: 50, awardKind: 'credit', awardValue: 10 },
    { id: 'a', label: 'A2', weight: 50, awardKind: 'credit', awardValue: 20 }, // duplicate id
    { id: 'b', label: 'B', weight: 50, awardKind: 'multiplier', awardValue: 3 },
  ]},
});
t('dedupes duplicate tier ids', rTier.tiers.length === 2);

const rTierBad = resolveConfig({
  mysteryPrizeBox: { enabled: true, tiers: [
    { id: 'x', awardKind: 'invalid_kind', awardValue: 'oops', weight: 999 },
    { id: 'y', awardKind: 'multiplier', awardValue: 2, weight: 50 },
  ]},
});
t('invalid awardKind falls back to default', rTierBad.tiers[0].awardKind === 'credit');
t('non-numeric awardValue falls back', rTierBad.tiers[0].awardValue === 5);

/* ── CSS emit ─────────────────────────────────────────────────────── */
const cssOff = emitMysteryPrizeBoxCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');

const css = emitMysteryPrizeBoxCSS(r1);
t('CSS has chest class', css.includes('.mystery-prize-chest'));
t('CSS has overlay class', css.includes('.mystery-prize-overlay'));
t('CSS has shake keyframes', css.includes('@keyframes mpb-shake'));
t('CSS has reduced-motion media', css.includes('prefers-reduced-motion'));
t('CSS has mobile media', css.includes('@media (max-width: 620px)'));
t('CSS has focus-visible ring', css.includes('focus-visible'));

/* ── Markup emit ──────────────────────────────────────────────────── */
const markupOff = emitMysteryPrizeBoxMarkup(defaultConfig());
t('markup empty when disabled', markupOff === '');

const markup = emitMysteryPrizeBoxMarkup(r1);
t('markup has chest button', markup.includes('id="mysteryPrizeChest"'));
t('markup has overlay element', markup.includes('id="mysteryPrizeOverlay"'));
t('markup has role=alertdialog', markup.includes('role="alertdialog"'));
t('markup has aria-live=assertive', markup.includes('aria-live="assertive"'));
t('markup has aria-label', markup.includes('aria-label="Mystery prize — tap to open"'));
t('markup HTML-escapes label', emitMysteryPrizeBoxMarkup(resolveConfig({
  mysteryPrizeBox: { enabled: true, label: '<x>' },
})).includes('&lt;x&gt;'));

/* ── Runtime emit ─────────────────────────────────────────────────── */
const rtOff = emitMysteryPrizeBoxRuntime(defaultConfig());
t('runtime stub when disabled', rtOff.includes('disabled'));

const rt = emitMysteryPrizeBoxRuntime(r1);
t('runtime declares MPB_DROP_CHANCE', rt.includes('MPB_DROP_CHANCE'));
t('runtime declares MPB_COOLDOWN', rt.includes('MPB_COOLDOWN'));
t('runtime declares MPB_TIERS array', rt.includes('MPB_TIERS'));
t('runtime has pickTier function', rt.includes('function pickTier'));
t('runtime emits onMysteryPrizeBoxAppeared', rt.includes('onMysteryPrizeBoxAppeared'));
t('runtime emits onMysteryPrizeBoxOpened', rt.includes('onMysteryPrizeBoxOpened'));
t('runtime emits onMysteryPrizeBoxDismissed', rt.includes('onMysteryPrizeBoxDismissed'));
t('runtime listens postSpin', rt.includes("HookBus.on('postSpin'"));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime keyboard handles Enter/Space/Escape',
  rt.includes("e.key === 'Enter'") && rt.includes("e.key === 'Escape'"));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
