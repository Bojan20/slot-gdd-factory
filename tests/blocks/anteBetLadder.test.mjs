/**
 * tests/blocks/anteBetLadder.test.mjs
 * Wave LEGO-BUY (4/8) — pure Node tests for anteBetLadder block.
 */
import {
  defaultConfig,
  resolveConfig,
  emitAnteBetLadderCSS,
  emitAnteBetLadderMarkup,
  emitAnteBetLadderRuntime,
} from '../../src/blocks/anteBetLadder.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== anteBetLadder block (LEGO-BUY Wave 4) ===');

/* ── defaults ─────────────────────────────────────────────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label ANTE', d.label === 'ANTE');
t('default 4 rungs', d.rungs.length === 4);
t('default rung 0 is OFF', d.rungs[0].id === 'off' && d.rungs[0].costMultiplier === 1.0);
t('default rung 1 +25%', d.rungs[1].costMultiplier === 1.25);
t('default rung 3 +100%', d.rungs[3].costMultiplier === 2.0);
t('default index = 0', d.defaultRungIndex === 0);
t('frozen rungs', Object.isFrozen(d.rungs));

/* ── auto-enable from features ────────────────────────────────────── */
const r1 = resolveConfig({
  features: [{ kind: 'ante_bet', rungs: [
    { id: 'off', label: 'OFF', costMultiplier: 1.0, triggerMultiplier: 1.0 },
    { id: 'mid', label: '+50%', costMultiplier: 1.5, triggerMultiplier: 2.0 },
    { id: 'max', label: '+100%', costMultiplier: 2.0, triggerMultiplier: 3.0 },
  ]}],
});
t('auto-enable from feature.rungs (≥2)', r1.enabled === true);
t('hoists 3 rungs from feature', r1.rungs.length === 3);
t('rung 1 cost 1.5', r1.rungs[1].costMultiplier === 1.5);

/* ── kind === ante_bet_ladder ────────────────────────────────────── */
const r2 = resolveConfig({
  features: [{ kind: 'ante_bet_ladder' }],
  anteBetLadder: { rungs: [
    { id: 'a', label: 'A', costMultiplier: 1.0, triggerMultiplier: 1.0 },
    { id: 'b', label: 'B', costMultiplier: 1.5, triggerMultiplier: 2.0 },
  ]},
});
t('auto-enable kind=ante_bet_ladder', r2.enabled === true);
t('explicit rungs override count', r2.rungs.length === 2);

/* ── single-rung degeneracy ───────────────────────────────────────── */
const r3 = resolveConfig({
  anteBetLadder: { enabled: true, rungs: [{ id: 'only', label: 'ONLY', costMultiplier: 1.5, triggerMultiplier: 2.0 }] },
});
t('single-rung collapses (disabled)', r3.enabled === false);
t('collapsedToSingleRung flag', r3.collapsedToSingleRung === true);

/* ── max 5 cap + de-dupe ─────────────────────────────────────────── */
const r5 = resolveConfig({
  anteBetLadder: { enabled: true, rungs: [
    { id: 'a', label: 'A', costMultiplier: 1.0, triggerMultiplier: 1.0 },
    { id: 'b', label: 'B', costMultiplier: 1.25, triggerMultiplier: 1.5 },
    { id: 'c', label: 'C', costMultiplier: 1.5, triggerMultiplier: 2.0 },
    { id: 'd', label: 'D', costMultiplier: 1.75, triggerMultiplier: 2.5 },
    { id: 'e', label: 'E', costMultiplier: 2.0, triggerMultiplier: 3.0 },
    { id: 'f', label: 'F', costMultiplier: 3.0, triggerMultiplier: 5.0 },
  ]},
});
t('caps rungs to 5', r5.rungs.length === 5);

const rDup = resolveConfig({
  anteBetLadder: { enabled: true, rungs: [
    { id: 'x', label: 'X1', costMultiplier: 1.0, triggerMultiplier: 1.0 },
    { id: 'x', label: 'X2', costMultiplier: 1.5, triggerMultiplier: 2.0 },
    { id: 'y', label: 'Y',  costMultiplier: 2.0, triggerMultiplier: 3.0 },
  ]},
});
t('dedupes duplicate rung ids (keeps first)', rDup.rungs.length === 2 && rDup.rungs[0].label === 'X1' && rDup.rungs[1].id === 'y');

/* ── clamp out-of-range cost/trigger mults ───────────────────────── */
const rClamp = resolveConfig({
  anteBetLadder: { enabled: true, rungs: [
    { id: 'a', label: 'A', costMultiplier: 99, triggerMultiplier: 50 },
    { id: 'b', label: 'B', costMultiplier: 0.5, triggerMultiplier: 0.1 },
  ]},
});
t('clamps cost upper to 5.0', rClamp.rungs[0].costMultiplier === 5.0);
t('clamps trigger upper to 10.0', rClamp.rungs[0].triggerMultiplier === 10.0);
t('clamps cost lower to 1.0', rClamp.rungs[1].costMultiplier === 1.0);
t('clamps trigger lower to 1.0', rClamp.rungs[1].triggerMultiplier === 1.0);

/* ── default index in-range ──────────────────────────────────────── */
const rIdx = resolveConfig({
  anteBetLadder: { enabled: true, defaultRungIndex: 99, rungs: [
    { id: 'a', label: 'A', costMultiplier: 1.0, triggerMultiplier: 1.0 },
    { id: 'b', label: 'B', costMultiplier: 1.5, triggerMultiplier: 2.0 },
  ]},
});
t('clamps defaultRungIndex to last valid', rIdx.defaultRungIndex === 1);

/* ── CSS emit ─────────────────────────────────────────────────────── */
const cssOff = emitAnteBetLadderCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');

const css = emitAnteBetLadderCSS(r1);
t('CSS has ladder class', css.includes('.ante-bet-ladder'));
t('CSS has rung class', css.includes('.ladder-rung'));
t('CSS has rail class', css.includes('.ladder-rail'));
t('CSS has reduced-motion media', css.includes('prefers-reduced-motion'));
t('CSS has mobile breakpoint', css.includes('@media (max-width:'));
t('CSS has focus-visible ring', css.includes('focus-visible'));
t('CSS has locked state styling', css.includes('data-locked'));

/* ── Markup emit ──────────────────────────────────────────────────── */
const markupOff = emitAnteBetLadderMarkup(defaultConfig());
t('markup empty when disabled', markupOff === '');

const markup = emitAnteBetLadderMarkup(r1);
t('markup has host id', markup.includes('id="anteBetLadder"'));
t('markup has role=radiogroup', markup.includes('role="radiogroup"'));
t('markup has role=radio per rung', (markup.match(/role="radio"/g) || []).length === 3);
t('markup has aria-checked true on default', markup.match(/aria-checked="true"/g).length === 1);
t('markup has 3 rung labels', markup.includes('OFF') && markup.includes('+50%') && markup.includes('+100%'));
t('markup has data-cost-mult attrs', markup.includes('data-cost-mult="1.5"'));
t('markup HTML-escapes label', emitAnteBetLadderMarkup(resolveConfig({
  anteBetLadder: { enabled: true, rungs: [
    { id: 'a', label: '<x>', costMultiplier: 1.0, triggerMultiplier: 1.0 },
    { id: 'b', label: 'OK', costMultiplier: 1.5, triggerMultiplier: 2.0 },
  ]},
})).includes('&lt;x&gt;'));

/* ── Runtime emit ─────────────────────────────────────────────────── */
const rtOff = emitAnteBetLadderRuntime(defaultConfig());
t('runtime stub when disabled', rtOff.includes('disabled'));

const rt = emitAnteBetLadderRuntime(r1);
t('runtime sets mutex flag', rt.includes('__ANTE_BET_LADDER_ACTIVE__ = true'));
t('runtime declares default index', rt.includes('ABL_DEFAULT_INDEX = 0'));
t('runtime applyRung function', rt.includes('function applyRung'));
t('runtime sets ANTE_BET_RUNG_ID', rt.includes('window.ANTE_BET_RUNG_ID'));
t('runtime sets ANTE_BET_COST_MULT', rt.includes('window.ANTE_BET_COST_MULT'));
t('runtime sets ANTE_BET_TRIGGER_MULT', rt.includes('window.ANTE_BET_TRIGGER_MULT'));
t('runtime mirrors legacy ANTE_BET_ON boolean', rt.includes('window.ANTE_BET_ON'));
t('runtime emits onAnteBetLadderChanged', rt.includes('onAnteBetLadderChanged'));
t('runtime keyboard nav ArrowRight', rt.includes('ArrowRight'));
t('runtime keyboard nav ArrowLeft', rt.includes('ArrowLeft'));
t('runtime keyboard Home/End', rt.includes("'Home'") && rt.includes("'End'"));
t('runtime locks on onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime unlocks on onFsEnd', rt.includes("HookBus.on('onFsEnd'"));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
