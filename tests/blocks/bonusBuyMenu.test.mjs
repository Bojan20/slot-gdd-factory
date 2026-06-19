/**
 * tests/blocks/bonusBuyMenu.test.mjs
 * Wave LEGO-BUY (4/8) — pure Node tests for bonusBuyMenu block.
 */
import {
  defaultConfig,
  resolveConfig,
  emitBonusBuyMenuCSS,
  emitBonusBuyMenuMarkup,
  emitBonusBuyMenuRuntime,
  BONUS_BUY_BANNED_JURISDICTIONS,
} from '../../src/blocks/bonusBuyMenu.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== bonusBuyMenu block (LEGO-BUY Wave 4) ===');

/* ── defaults ─────────────────────────────────────────────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label BUY BONUS', d.label === 'BUY BONUS');
t('default sample tier is single (sub-mutex with bonusBuy)', d.tiers.length === 1);
t('default tier costX=75', d.tiers[0].costX === 75);
t('default rearm 1200ms', d.rearmMs === 1200);
t('frozen tiers default', Object.isFrozen(d.tiers));

/* ── multi-tier feature auto-enable ──────────────────────────────── */
const r1 = resolveConfig({
  features: [{ kind: 'bonus_buy', tiers: [
    { id: 'standard', label: 'STANDARD', costX: 60, forceScatters: 4, fsMode: 'standard' },
    { id: 'super',    label: 'SUPER',    costX: 200, forceScatters: 5, fsMode: 'super' },
    { id: 'mega',     label: 'MEGA',     costX: 500, forceScatters: 6, fsMode: 'mega' },
  ]}],
});
t('auto-enable from feature.tiers (≥2)', r1.enabled === true);
t('hoists 3 tiers from feature', r1.tiers.length === 3);
t('tier 0 id=standard', r1.tiers[0].id === 'standard');
t('tier 2 fsMode=mega', r1.tiers[2].fsMode === 'mega');

/* ── kind === bonus_buy_menu auto-enable ─────────────────────────── */
const r2 = resolveConfig({
  features: [{ kind: 'bonus_buy_menu' }],
  bonusBuyMenu: {
    tiers: [
      { id: 'a', label: 'A', costX: 50, forceScatters: 4, fsMode: 'a' },
      { id: 'b', label: 'B', costX: 100, forceScatters: 5, fsMode: 'b' },
    ],
  },
});
t('auto-enable kind=bonus_buy_menu', r2.enabled === true);
t('explicit tiers override (count)', r2.tiers.length === 2);

/* ── single-tier degeneracy collapses to bonusBuy mutex ───────────── */
const r3 = resolveConfig({
  bonusBuyMenu: { enabled: true, tiers: [{ id: 'lone', label: 'LONE', costX: 75, forceScatters: 4, fsMode: 'standard' }] },
});
t('single-tier collapses (disabled)', r3.enabled === false);
t('collapsedToSingleTier flag', r3.collapsedToSingleTier === true);

/* ── jurisdiction hard-ban (UKGC/SE/DE/NL) ────────────────────────── */
for (const j of BONUS_BUY_BANNED_JURISDICTIONS) {
  const rj = resolveConfig({
    features: [{ kind: 'bonus_buy', tiers: [
      { id: 'a', label: 'A', costX: 75, forceScatters: 4, fsMode: 'a' },
      { id: 'b', label: 'B', costX: 200, forceScatters: 5, fsMode: 'b' },
    ]}],
    regulator: { profile: j },
  });
  t(`jurisdiction ${j} forces disabled`, rj.enabled === false && rj.bannedByJurisdiction === true);
}

/* ── MGA jurisdiction stays enabled ───────────────────────────────── */
const rMGA = resolveConfig({
  features: [{ kind: 'bonus_buy', tiers: [
    { id: 'a', label: 'A', costX: 75, forceScatters: 4, fsMode: 'a' },
    { id: 'b', label: 'B', costX: 200, forceScatters: 5, fsMode: 'b' },
  ]}],
  regulator: { profile: 'MGA' },
});
t('MGA jurisdiction stays enabled', rMGA.enabled === true && rMGA.bannedByJurisdiction === false);

/* ── max 5 tiers cap ─────────────────────────────────────────────── */
const r5 = resolveConfig({
  bonusBuyMenu: { enabled: true, tiers: [
    { id: 't1', label: 'T1', costX: 1, forceScatters: 4, fsMode: 'a' },
    { id: 't2', label: 'T2', costX: 2, forceScatters: 4, fsMode: 'a' },
    { id: 't3', label: 'T3', costX: 3, forceScatters: 4, fsMode: 'a' },
    { id: 't4', label: 'T4', costX: 4, forceScatters: 4, fsMode: 'a' },
    { id: 't5', label: 'T5', costX: 5, forceScatters: 4, fsMode: 'a' },
    { id: 't6', label: 'T6', costX: 6, forceScatters: 4, fsMode: 'a' },
  ]},
});
t('caps tiers to 5', r5.tiers.length === 5);

/* ── duplicate ids deduped ───────────────────────────────────────── */
const rDup = resolveConfig({
  bonusBuyMenu: { enabled: true, tiers: [
    { id: 'x', label: 'X1', costX: 50, forceScatters: 4, fsMode: 'a' },
    { id: 'x', label: 'X2', costX: 100, forceScatters: 5, fsMode: 'b' },
    { id: 'y', label: 'Y',  costX: 200, forceScatters: 6, fsMode: 'c' },
  ]},
});
t('dedupes duplicate tier ids (keeps first)', rDup.tiers.length === 2 && rDup.tiers[0].label === 'X1' && rDup.tiers[1].id === 'y');

/* ── clamp costX out-of-range ────────────────────────────────────── */
const rClamp = resolveConfig({
  bonusBuyMenu: { enabled: true, tiers: [
    { id: 'a', label: 'A', costX: 99999, forceScatters: 4, fsMode: 'a' },
    { id: 'b', label: 'B', costX: -50, forceScatters: 99, fsMode: 'b' },
    { id: 'c', label: 'C', costX: 'oops', forceScatters: 'nope', fsMode: 'c' },
  ]},
});
t('clamps costX upper bound', rClamp.tiers[0].costX === 10000);
t('clamps costX lower bound (negative → 1)', rClamp.tiers[1].costX === 1);
t('clamps costX to fallback on non-numeric', rClamp.tiers[2].costX === 75);
t('clamps forceScatters upper bound', rClamp.tiers[1].forceScatters === 12);

/* ── CSS emit ─────────────────────────────────────────────────────── */
const cssOff = emitBonusBuyMenuCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');

const css = emitBonusBuyMenuCSS(r1);
t('CSS has menu button class', css.includes('.bonus-buy-menu-btn'));
t('CSS has menu sheet class', css.includes('.bonus-buy-menu-sheet'));
t('CSS has backdrop class', css.includes('.bonus-buy-menu-backdrop'));
t('CSS has reduced-motion media', css.includes('prefers-reduced-motion'));
t('CSS has mobile breakpoint', css.includes('@media (max-width:'));
t('CSS has focus-visible ring', css.includes('focus-visible'));

/* ── Markup emit ──────────────────────────────────────────────────── */
const markupOff = emitBonusBuyMenuMarkup(defaultConfig());
t('markup empty when disabled', markupOff === '');

const markup = emitBonusBuyMenuMarkup(r1);
t('markup has trigger button', markup.includes('id="bonusBuyMenuBtn"'));
t('markup has sheet element', markup.includes('id="bonusBuyMenuSheet"'));
t('markup has backdrop element', markup.includes('id="bonusBuyMenuBackdrop"'));
t('markup has role=menu', markup.includes('role="menu"'));
t('markup has role=menuitem per tier', (markup.match(/role="menuitem"/g) || []).length === 3);
t('markup has aria-haspopup', markup.includes('aria-haspopup="menu"'));
t('markup has aria-expanded=false', markup.includes('aria-expanded="false"'));
t('markup includes first tier label', markup.includes('STANDARD'));
t('markup includes last tier cost', markup.includes('500× BET'));
t('markup HTML-escapes label', emitBonusBuyMenuMarkup(resolveConfig({
  bonusBuyMenu: { enabled: true, tiers: [
    { id: 'a', label: '<bad>', costX: 50, forceScatters: 4, fsMode: 'a' },
    { id: 'b', label: 'OK', costX: 100, forceScatters: 5, fsMode: 'b' },
  ]},
})).includes('&lt;bad&gt;'));

/* ── Runtime emit ─────────────────────────────────────────────────── */
const rtOff = emitBonusBuyMenuRuntime(defaultConfig());
t('runtime stub when disabled', rtOff.includes('disabled'));

const rt = emitBonusBuyMenuRuntime(r1);
t('runtime sets mutex flag', rt.includes('__BONUS_BUY_MENU_ACTIVE__ = true'));
t('runtime declares tier count', rt.includes('BBM_TIER_COUNT = 3'));
t('runtime opens menu', rt.includes('openMenu'));
t('runtime closes menu on Escape', rt.includes("e.key === 'Escape'"));
t('runtime emits onBonusBuyMenuTierSelected', rt.includes('onBonusBuyMenuTierSelected'));
t('runtime emits onBonusBuyMenuOpened', rt.includes('onBonusBuyMenuOpened'));
t('runtime emits onBonusBuyMenuClosed', rt.includes('onBonusBuyMenuClosed'));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime sets FORCE_TRIGGER plant with fsMode', rt.includes('fsMode: fsMode'));
t('runtime calls runOneBaseSpin', rt.includes('runOneBaseSpin()'));
t('runtime keyboard nav ArrowDown', rt.includes("ArrowDown"));
t('runtime keyboard nav Home/End', rt.includes("'Home'") && rt.includes("'End'"));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
