/**
 * tests/blocks/winCap.test.mjs — Wave N3
 */
import {
  defaultConfig, resolveConfig,
  emitWinCapCSS, emitWinCapMarkup, emitWinCapRuntime,
} from '../../src/blocks/winCap.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== winCap block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default maxWinX=5000', d.maxWinX === 5000);
t('default mode=round', d.mode === 'round');
t('default forceRoundEnd=true', d.forceRoundEnd === true);

const r = resolveConfig({ features: [{ kind: 'win_cap' }] });
t('auto-enable from feature', r.enabled === true);

const rLim = resolveConfig({ limits: { max_win_x: 10000 } });
t('auto-enable from limits.max_win_x', rLim.enabled === true);
t('maxWinX from limits', rLim.maxWinX === 10000);

const r2 = resolveConfig({
  features: [{ kind: 'win_cap' }],
  winCap: { maxWinX: 25000, mode: 'spin', overlayLabel: 'MEGA WIN', overlayMs: 4000, forceRoundEnd: false },
});
t('override maxWinX', r2.maxWinX === 25000);
t('override mode=spin', r2.mode === 'spin');
t('override overlayLabel', r2.overlayLabel === 'MEGA WIN');
t('override overlayMs', r2.overlayMs === 4000);
t('override forceRoundEnd', r2.forceRoundEnd === false);

t('CSS empty when disabled', emitWinCapCSS(defaultConfig()) === '');
const css = emitWinCapCSS(r);
t('CSS has wincap-overlay', css.includes('.wincap-overlay'));

t('markup empty when disabled', emitWinCapMarkup(defaultConfig()) === '');
const mk = emitWinCapMarkup(r);
t('markup has #winCapOverlay', mk.includes('id="winCapOverlay"'));
t('markup escapes label', mk.includes('MAX WIN!'));

t('runtime stub when disabled', emitWinCapRuntime(defaultConfig()).includes('disabled'));
const rt = emitWinCapRuntime(r);
t('runtime exposes winCapAdd', rt.includes('window.winCapAdd'));
t('runtime exposes winCapTrigger', rt.includes('window.winCapTrigger'));
t('runtime exposes winCapReset', rt.includes('window.winCapReset'));
t('runtime bakes WIN_CAP_MAX_X', rt.includes('WIN_CAP_MAX_X        = 5000'));

/* ─────────────────────────────────────────────────────────────────────────
 * Bug #3 repro / regression — winCap clamp must keep window.__WIN_AWARD__
 * in sync with the in-place ev.payX clamp.
 *
 * Lifecycle order (winPresentation.mjs:752 → postSpinOrch → balanceHud:513):
 *   1. winPresentation snapshots totalAward = sum(ev.payX) into __WIN_AWARD__
 *   2. postSpin emits → winCap clamps ev.payX in place (priority +100)
 *   3. balanceHud reads window.__WIN_AWARD__ on postSpin (priority -25)
 *
 * If winCap doesn't re-publish __WIN_AWARD__ after clamp, balanceHud credits
 * the uncapped amount → player gets paid past the cap. THIS is the bug.
 * ───────────────────────────────────────────────────────────────────────── */
function runWinCapSandbox(cfg) {
  const listeners = {};
  const win = {
    __WIN_AWARD__: 0,
    addEventListener() {}, removeEventListener() {},
  };
  const doc = {
    getElementById() { return { dataset: {}, style: {}, setAttribute() {} }; },
  };
  const HookBus = {
    on(ev, cb /*, opts */) { (listeners[ev] = listeners[ev] || []).push(cb); },
    emit(ev, p) { (listeners[ev] || []).forEach(fn => fn(p)); },
  };
  win.HookBus = HookBus;
  const fn = new Function('window', 'document', 'HookBus', 'setTimeout', 'FSM_enterOutro',
    emitWinCapRuntime(cfg));
  fn(win, doc, HookBus, (cb) => 0, () => {});
  return { win, doc, HookBus, listeners };
}

const sb = runWinCapSandbox(resolveConfig({
  features: [{ kind: 'win_cap' }],
  winCap: { maxWinX: 5000, mode: 'round', forceRoundEnd: false },
}));

/* Simulate winPresentation: publish uncapped total before postSpin. */
const events1 = [{ payX: 3000 }, { payX: 4000 }];
sb.win.__WIN_AWARD__ = events1.reduce((s, e) => s + e.payX, 0);   /* 7000 — uncapped */
sb.HookBus.emit('postSpin', { events: events1 });

/* After clamp: events should be clamped (3000 + 2000 = 5000 max), AND
 * window.__WIN_AWARD__ should reflect that, so balanceHud credits 5000
 * not the original 7000. */
t('sandbox: events clamped in-place to ceiling',
  events1[0].payX === 3000 && events1[1].payX === 2000);
t('sandbox: __WIN_AWARD__ re-published after clamp',
  sb.win.__WIN_AWARD__ === 5000);

/* Below-ceiling spin: must NOT touch __WIN_AWARD__ if already correct. */
const sb2 = runWinCapSandbox(resolveConfig({
  features: [{ kind: 'win_cap' }],
  winCap: { maxWinX: 5000, mode: 'round', forceRoundEnd: false },
}));
const events2 = [{ payX: 100 }, { payX: 250 }];
sb2.win.__WIN_AWARD__ = 350;
sb2.HookBus.emit('postSpin', { events: events2 });
t('sandbox: under-cap spin leaves payX untouched',
  events2[0].payX === 100 && events2[1].payX === 250);
t('sandbox: under-cap spin leaves __WIN_AWARD__ correct',
  sb2.win.__WIN_AWARD__ === 350);

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
