/**
 * tests/blocks/respin.test.mjs — Wave N2
 */
import {
  defaultConfig, resolveConfig,
  emitRespinCSS, emitRespinMarkup, emitRespinRuntime,
} from '../../src/blocks/respin.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== respin block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default mode=base', d.mode === 'base');
t('default holdRule=last-reel', d.holdRule === 'last-reel');

const r = resolveConfig({ features: [{ kind: 'respin' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({
  features: [{ kind: 'respin' }],
  respin: { mode: 'paid', holdRule: 'wild-anchor', respinsPerTrigger: 3, triggerChance: 0.3 },
});
t('override mode=paid', r2.mode === 'paid');
t('override holdRule', r2.holdRule === 'wild-anchor');
t('override respinsPerTrigger', r2.respinsPerTrigger === 3);
t('override triggerChance', r2.triggerChance === 0.3);

t('CSS empty when disabled', emitRespinCSS(defaultConfig()) === '');
const css = emitRespinCSS(r);
t('CSS has is-respinning', css.includes('.reelCol.is-respinning'));
t('CSS has respin-banner', css.includes('.respin-banner'));

t('markup empty when disabled', emitRespinMarkup(defaultConfig()) === '');
const mk = emitRespinMarkup(r);
t('markup has #respinBanner', mk.includes('id="respinBanner"'));

t('runtime stub when disabled', emitRespinRuntime(defaultConfig()).includes('disabled'));
const rt = emitRespinRuntime(r);
t('runtime exposes respinMaybeTrigger', rt.includes('window.respinMaybeTrigger'));
t('runtime exposes respinStart', rt.includes('window.respinStart'));
t('runtime exposes respinAfterSpin', rt.includes('window.respinAfterSpin'));
t('runtime exposes respinEnd', rt.includes('window.respinEnd'));

/* ─────────────────────────────────────────────────────────────────────────
 * Bug #1 repro / regression — respin must actually DRIVE a spin.
 *
 * Original behaviour (bug): respinStart() only flipped a state flag and
 * painted DOM classes; the countdown decremented on each postSpin, but
 * no actual respin spin was ever dispatched. Player saw "RESPIN" banner
 * + held-reel highlights, then nothing — round just ended.
 *
 * Required behaviour: respinStart() schedules window.runOneBaseSpin() so
 * a real spin lifecycle runs (preSpin → engine → postSpin → respinAfterSpin).
 * If spinsLeft > 0 after decrement, the NEXT spin is also dispatched.
 *
 * Boki rule (slot-gdd-factory): every force/feature trigger MUST drive a
 * real spin via runOneBaseSpin() — no shortcut click → DOM-only flag.
 * ───────────────────────────────────────────────────────────────────────── */
function runRespinSandbox(cfg) {
  const listeners = {};
  const calls = { runOneBaseSpin: 0, timeouts: 0 };
  const host = {
    querySelectorAll() { return []; },
  };
  const win = {
    REELS: 5,
    runOneBaseSpin() { calls.runOneBaseSpin++; },
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  const doc = {
    getElementById(id) {
      if (id === 'gridHost') return host;
      if (id === 'respinBanner') return { dataset: {} };
      return null;
    },
  };
  /* setTimeout runs synchronously for deterministic count. */
  const st = (cb /*, ms */) => { calls.timeouts++; cb(); return 0; };
  /* Math.random forced to 0 so triggerChance check always passes. */
  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    const fn = new Function('window', 'document', 'HookBus', 'setTimeout', 'FSM',
      emitRespinRuntime(cfg));
    fn(win, doc, win.HookBus, st, { phase: 'BASE' });
  } finally {
    Math.random = origRandom;
  }
  return { win, doc, listeners, calls };
}

const sbR = runRespinSandbox(resolveConfig({
  features: [{ kind: 'respin' }],
  respin: { mode: 'base', holdRule: 'last-reel', respinsPerTrigger: 2, triggerChance: 1.0 },
}));

/* 1st postSpin → maybeTrigger fires → respinStart → must dispatch a spin. */
const baselineCalls = sbR.calls.runOneBaseSpin;
sbR.listeners.postSpin[0]();
t('sandbox: respin trigger dispatched a real spin',
  sbR.calls.runOneBaseSpin > baselineCalls);
t('sandbox: respin state active after trigger',
  sbR.win.RESPIN_STATE.active === true && sbR.win.RESPIN_STATE.spinsLeft === 2);

/* 2nd postSpin (the result of the dispatched respin spin) → decrement,
 * spinsLeft still > 0, must dispatch the NEXT respin spin. */
const afterFirst = sbR.calls.runOneBaseSpin;
sbR.listeners.postSpin[0]();
t('sandbox: countdown chains next respin spin',
  sbR.calls.runOneBaseSpin > afterFirst && sbR.win.RESPIN_STATE.spinsLeft === 1);

/* 3rd postSpin → final decrement → spinsLeft = 0 → respinEnd, NO new spin. */
const afterSecond = sbR.calls.runOneBaseSpin;
sbR.listeners.postSpin[0]();
t('sandbox: last respin ends without re-dispatch',
  sbR.calls.runOneBaseSpin === afterSecond && sbR.win.RESPIN_STATE.active === false);

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
