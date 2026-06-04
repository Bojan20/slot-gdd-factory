/* eslint-disable no-console */
/**
 * Wave U6 — gambleSecondary block tests.
 *
 * Coverage matrix:
 *   • defaultConfig industry baseline (modes, card mode/mult, ladder rungs,
 *     thresholds, currency)
 *   • resolveConfig: modes dedupe + filter; cardMode auto-sets multiplier;
 *     ladder clamps; minWin / maxBank guards; currency allow-list;
 *     auto-enable from feature kind regex
 *   • emitCSS: empty when disabled; bakes overlay + card + ladder selectors;
 *     prefers-reduced-motion + mobile
 *   • emitMarkup: empty when disabled; hidden splash + card + ladder;
 *     aria-modal + radiogroup
 *   • emitRuntime: stub when disabled; baked constants when enabled
 *   • Sandbox:
 *       - open() respects minWinForPromptX gate
 *       - open() respects autoplay + fs suppression (with override flags)
 *       - chooseCard / chooseLadder emit onGambleStart with branch
 *       - guess() with deterministic Math.random → win / lose paths emit
 *         onGambleRound
 *       - lose → onGambleEnd outcome:'busted', bank=0, phase resets
 *       - collect mid-game → onGambleEnd outcome:'collect', bank preserved
 *       - ladder stepUp win/lose, stepDown decreases rung
 *       - maxBank cap honored (bank ≤ maxBankX × bet)
 *       - onSkipRequested forces collect when open
 *       - postSpin auto-open on eligible win, deferred 150ms (we tick timers)
 *   • determinism: same config → byte-identical emit triplet
 *   • vendor-neutral: 0 banned strings
 */

import {
  defaultConfig, resolveConfig,
  emitGambleSecondaryCSS, emitGambleSecondaryMarkup, emitGambleSecondaryRuntime,
} from '../../src/blocks/gambleSecondary.mjs';
import { emitHookBusRuntime } from '../../src/blocks/hookBus.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const ok  = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/gambleSecondary.mjs —');

/* ── defaults + resolveConfig ── */

t('defaultConfig: industry baseline (Card + Ladder available, color/2x default)', () => {
  const d = defaultConfig();
  eq(d.enabled, false);
  eq(d.modes.join(','), 'card,ladder');
  eq(d.cardMode, 'color');
  eq(d.cardMultiplier, 2);
  eq(d.cardMaxRounds, 5);
  eq(d.ladderRungs, 8);
  eq(d.ladderRungMultiplier, 2);
  eq(d.minWinForPromptX, 1);
  eq(d.maxBankX, 1000);
  eq(d.showInFs, false);
  eq(d.showInAutoplay, false);
});

t('resolveConfig: modes dedupe + filter + drop unknown', () => {
  const r = resolveConfig({ gambleSecondary: { modes: ['ladder', 'invalid', 'card', 'ladder'] } });
  eq(r.modes.join(','), 'ladder,card');
});

t('resolveConfig: cardMode=suit auto-sets multiplier to 4 (when not overridden)', () => {
  const r = resolveConfig({ gambleSecondary: { cardMode: 'suit' } });
  eq(r.cardMode, 'suit');
  eq(r.cardMultiplier, 4);
});

t('resolveConfig: explicit cardMultiplier wins over auto-set', () => {
  const r = resolveConfig({ gambleSecondary: { cardMode: 'suit', cardMultiplier: 3 } });
  eq(r.cardMultiplier, 3);
});

t('resolveConfig: ladder clamps (rungs 3..16, mult >1 .. 8)', () => {
  const r = resolveConfig({ gambleSecondary: { ladderRungs: 99, ladderRungMultiplier: 100 } });
  eq(r.ladderRungs, 16);
  eq(r.ladderRungMultiplier, 8);
});

t('resolveConfig: minWinForPromptX accepts 0 + caps at 1000', () => {
  eq(resolveConfig({ gambleSecondary: { minWinForPromptX: 0 } }).minWinForPromptX, 0);
  eq(resolveConfig({ gambleSecondary: { minWinForPromptX: 9999 } }).minWinForPromptX, 1000);
});

t('resolveConfig: currency allow-list rejects HTML payload', () => {
  eq(resolveConfig({ gambleSecondary: { currency: '<x>' } }).currency, '€');
  eq(resolveConfig({ gambleSecondary: { currency: 'USD' } }).currency, 'USD');
});

t('resolveConfig: auto-enable from features[].kind regex', () => {
  for (const kind of ['gamble-secondary', 'gamble_secondary', 'risk-ladder', 'card and ladder']) {
    const r = resolveConfig({ features: [{ kind }] });
    eq(r.enabled, true, `kind=${kind}`);
  }
});

/* ── CSS emission ── */

t('emitCSS: empty when disabled', () => {
  eq(emitGambleSecondaryCSS({ enabled: false }), '');
});

t('emitCSS: enabled bakes overlay + branches + reduced-motion + mobile', () => {
  const css = emitGambleSecondaryCSS({ ...defaultConfig(), enabled: true });
  for (const sel of ['.gs-overlay', '.gs-prompt', '.gs-card-wrap', '.gs-card-face',
                     '.gs-card-guess', '.gs-ladder-wrap', '.gs-ladder', '.gs-ladder-rung',
                     '.gs-ladder-controls', '.gs-toast.is-win', '.gs-toast.is-lose']) ct(css, sel);
  ct(css, '@media (prefers-reduced-motion: reduce)');
  ct(css, '@media (max-width: 480px)');
});

/* ── markup emission ── */

t('emitMarkup: empty when disabled', () => {
  eq(emitGambleSecondaryMarkup({ enabled: false }), '');
});

t('emitMarkup: bakes overlay + 3 sub-panels + aria-modal', () => {
  const html = emitGambleSecondaryMarkup({ ...defaultConfig(), enabled: true });
  for (const id of ['gsOverlay','gsPrompt','gsPromptBank','gsBtnCard','gsBtnLadder','gsBtnCollect',
                    'gsCardWrap','gsCardBank','gsCardRound','gsCardFace','gsCardGuesses',
                    'gsCardCollectBtn','gsCardToast',
                    'gsLadderWrap','gsLadderBank','gsLadder','gsLadderUpBtn','gsLadderDownBtn',
                    'gsLadderCollectBtn','gsLadderToast']) ct(html, `id="${id}"`);
  ct(html, 'aria-modal="true"');
  ct(html, 'role="radiogroup"');
});

/* ── runtime emission ── */

t('emitRuntime: stub when disabled', () => {
  const js = emitGambleSecondaryRuntime({ enabled: false });
  ct(js, 'window.gambleSecondaryOpen         = function () {};');
  ct(js, 'GAMBLE_SECONDARY_STATE      = { enabled: false');
});

t('emitRuntime: enabled bakes modes + currency + thresholds', () => {
  const js = emitGambleSecondaryRuntime({ ...defaultConfig(), enabled: true });
  ct(js, '["card","ladder"]');
  ct(js, '"color"');
  ct(js, '"€"');
});

/* ── sandbox ── */

function buildSandbox(cfg, randomSequence) {
  const hbSrc = emitHookBusRuntime({ debugLog: false });
  const gsSrc = emitGambleSecondaryRuntime(cfg);

  const elements = new Map();
  function makeElement(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id, hidden: true, disabled: false,
      className: '', textContent: '', innerHTML: '',
      _classes: new Set(), _attrs: {}, _listeners: new Map(), _children: [],
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, on) { if (on) el._classes.add(c); else el._classes.delete(c); },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = v; },
      getAttribute(k) { return el._attrs[k]; },
      addEventListener(name, fn) {
        if (!el._listeners.has(name)) el._listeners.set(name, []);
        el._listeners.get(name).push(fn);
      },
      removeEventListener() {},
      appendChild(c) { el._children.push(c); },
      contains(o) { return el._children.includes(o); },
      click() { for (const fn of (el._listeners.get('click') || [])) fn({}); },
    };
    elements.set(id, el);
    return el;
  }
  for (const id of ['gsOverlay','gsPrompt','gsPromptBank','gsBtnCard','gsBtnLadder','gsBtnCollect',
                    'gsCardWrap','gsCardBank','gsCardRound','gsCardFace','gsCardGuesses',
                    'gsCardCollectBtn','gsCardToast','gsLadderWrap','gsLadderBank',
                    'gsLadder','gsLadderUpBtn','gsLadderDownBtn','gsLadderCollectBtn','gsLadderToast']) {
    makeElement(id);
  }
  const fakeDocument = {
    readyState: 'complete',
    getElementById(id) { return elements.get(id) || null; },
    addEventListener() {},
    createElement() {
      const el = {
        tag: '', textContent: '', className: '', type: '', disabled: false,
        _classes: new Set(), _attrs: {}, _listeners: new Map(), _children: [],
        setAttribute(k, v) { el._attrs[k] = v; },
        getAttribute(k) { return el._attrs[k]; },
        addEventListener(n, fn) {
          if (!el._listeners.has(n)) el._listeners.set(n, []);
          el._listeners.get(n).push(fn);
        },
        classList: {
          add(c) { el._classes.add(c); },
          remove(c) { el._classes.delete(c); },
          toggle(c, on) { if (on) el._classes.add(c); else el._classes.delete(c); },
          contains(c) { return el._classes.has(c); },
        },
        appendChild(c) { el._children.push(c); },
      };
      return el;
    },
  };
  const fakeWindow = { __SLOT_BET__: 1.0, __WIN_AWARD__: 5.0 };
  const fakeConsole = { warn() {}, error() {}, log() {} };

  /* Deterministic Math.random sequence for win/lose path tests. We can't
   * pass a fake Math object into `new Function` because non-enumerable
   * statics (max, min, pow, etc.) won't survive Object.assign — instead
   * we monkey-patch the real Math.random for the duration of the test,
   * remember the original, and restore after factory invocation. */
  let rngIdx = 0;
  const seq = Array.isArray(randomSequence) ? randomSequence : [];
  const origRandom = Math.random;
  Math.random = function () {
    if (rngIdx < seq.length) return seq[rngIdx++];
    return 0.5;
  };

  const factory = new Function(
    'window', 'document', 'console', 'performance', 'setTimeout', 'clearTimeout',
    hbSrc + '\n' + gsSrc + '\nreturn { HookBus: window.HookBus };'
  );
  const perf = { now: () => 0 };
  /* In tests we want setTimeout callbacks to fire synchronously so we can
   * assert end-state without sleeps. */
  const queuedTimers = [];
  const fakeSet = (cb, ms) => { queuedTimers.push({ cb, ms }); return queuedTimers.length; };
  const fakeClear = (id) => { if (queuedTimers[id - 1]) queuedTimers[id - 1].cb = null; };
  factory(fakeWindow, fakeDocument, fakeConsole, perf, fakeSet, fakeClear);

  return {
    window: fakeWindow,
    document: fakeDocument,
    elements,
    HookBus: fakeWindow.HookBus,
    drainTimers() {
      while (queuedTimers.length > 0) {
        const t = queuedTimers.shift();
        if (typeof t.cb === 'function') t.cb();
      }
    },
    restoreMath() { Math.random = origRandom; },
  };
}

t('sandbox: open() bails when win below threshold', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, minWinForPromptX: 10 });
  sb.window.__WIN_AWARD__ = 5; sb.window.__SLOT_BET__ = 1; /* 5 < 10×1 */
  sb.window.gambleSecondaryOpen();
  eq(sb.window.GAMBLE_SECONDARY_STATE.phase, 'idle');
});

t('sandbox: open() shows prompt when win above threshold', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, minWinForPromptX: 1 });
  sb.window.__WIN_AWARD__ = 5; sb.window.__SLOT_BET__ = 1;
  sb.window.gambleSecondaryOpen();
  eq(sb.window.GAMBLE_SECONDARY_STATE.phase, 'prompt');
  eq(sb.window.GAMBLE_SECONDARY_STATE.bank, 5);
});

t('sandbox: chooseCard emits onGambleStart + transitions phase', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const events = []; sb.HookBus.on('onGambleStart', p => events.push(p));
  sb.window.gambleSecondaryOpen();
  sb.window.gambleSecondaryChooseCard();
  eq(events.length, 1);
  eq(events[0].branch, 'card');
  eq(sb.window.GAMBLE_SECONDARY_STATE.phase, 'card');
});

t('sandbox: card guess WIN doubles bank + emits onGambleRound', () => {
  /* Force win: Math.random < 0.5 → guess 0.1 always wins. */
  const sb = buildSandbox({ ...defaultConfig(), enabled: true }, [0.1]);
  const events = []; sb.HookBus.on('onGambleRound', p => events.push(p));
  sb.window.gambleSecondaryOpen();
  sb.window.gambleSecondaryChooseCard();
  sb.window.gambleSecondaryGuess('R');
  eq(events.length, 1);
  eq(events[0].result, 'win');
  eq(events[0].bank, 10); /* 5 × 2 */
});

t('sandbox: card guess LOSE → bank=0 + onGambleEnd outcome=busted', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true }, [0.9]);
  const ends = []; sb.HookBus.on('onGambleEnd', p => ends.push(p));
  sb.window.gambleSecondaryOpen();
  sb.window.gambleSecondaryChooseCard();
  sb.window.gambleSecondaryGuess('R');
  eq(ends.length, 1);
  eq(ends[0].outcome, 'busted');
  eq(ends[0].bank, 0);
  sb.drainTimers(); /* grace pause */
  eq(sb.window.GAMBLE_SECONDARY_STATE.phase, 'idle');
});

t('sandbox: collect mid-card → onGambleEnd outcome=collect, bank preserved', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true }, [0.1, 0.1]);
  const ends = []; sb.HookBus.on('onGambleEnd', p => ends.push(p));
  sb.window.gambleSecondaryOpen();
  sb.window.gambleSecondaryChooseCard();
  sb.window.gambleSecondaryGuess('R'); /* win 5 → 10 */
  sb.window.gambleSecondaryGuess('B'); /* win 10 → 20 */
  sb.window.gambleSecondaryCollect();
  eq(ends.length, 1);
  eq(ends[0].outcome, 'collect');
  eq(ends[0].bank, 20);
});

t('sandbox: ladder stepUp win advances rung + bank', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, ladderRungMultiplier: 2 }, [0.1]);
  sb.window.gambleSecondaryOpen();
  sb.window.gambleSecondaryChooseLadder();
  const baseBank = sb.window.GAMBLE_SECONDARY_STATE.bank;
  sb.window.gambleSecondaryStepUp();
  eq(sb.window.GAMBLE_SECONDARY_STATE.ladderRung, 1);
  eq(sb.window.GAMBLE_SECONDARY_STATE.bank, baseBank * 2);
});

t('sandbox: ladder stepUp lose drops to baseline + onGambleEnd busted', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true }, [0.9]);
  const ends = []; sb.HookBus.on('onGambleEnd', p => ends.push(p));
  sb.window.gambleSecondaryOpen();
  sb.window.gambleSecondaryChooseLadder();
  sb.window.gambleSecondaryStepUp();
  eq(ends.length, 1);
  eq(ends[0].outcome, 'busted');
  eq(sb.window.GAMBLE_SECONDARY_STATE.bank, 0);
});

t('sandbox: ladder stepDown decreases rung but does not bust', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true }, [0.1, 0.1]);
  sb.window.gambleSecondaryOpen();
  sb.window.gambleSecondaryChooseLadder();
  sb.window.gambleSecondaryStepUp(); /* rung 1, bank 10 */
  sb.window.gambleSecondaryStepDown(); /* rung 0, bank 5 */
  eq(sb.window.GAMBLE_SECONDARY_STATE.ladderRung, 0);
  eq(sb.window.GAMBLE_SECONDARY_STATE.bank, 5);
});

t('sandbox: maxBankX caps bank growth', () => {
  /* bet 1, maxBankX 8 → bank cap at 8. Start with win 5. 2 wins → 5 → 10 capped → 10? wait 10 > 8 cap. */
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, maxBankX: 8 }, [0.1, 0.1]);
  sb.window.gambleSecondaryOpen();
  sb.window.gambleSecondaryChooseCard();
  sb.window.gambleSecondaryGuess('R'); /* 5 × 2 = 10 → cap 8 */
  eq(sb.window.GAMBLE_SECONDARY_STATE.bank, 8);
});

t('sandbox: open() respects FS suppression (default showInFs=false)', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.HookBus.emit('onFsTrigger', {});
  sb.window.gambleSecondaryOpen();
  eq(sb.window.GAMBLE_SECONDARY_STATE.phase, 'idle');
});

t('sandbox: open() respects autoplay suppression (default showInAutoplay=false)', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.HookBus.emit('onAutoplayStart', {});
  sb.window.gambleSecondaryOpen();
  eq(sb.window.GAMBLE_SECONDARY_STATE.phase, 'idle');
});

t('sandbox: onSkipRequested closes open gamble with collect', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true }, [0.1]);
  const ends = []; sb.HookBus.on('onGambleEnd', p => ends.push(p));
  sb.window.gambleSecondaryOpen();
  sb.window.gambleSecondaryChooseCard();
  sb.window.gambleSecondaryGuess('R'); /* bank 10 */
  sb.HookBus.emit('onSkipRequested', {});
  eq(ends.length, 1);
  eq(ends[0].outcome, 'collect');
  eq(ends[0].bank, 10);
});

t('sandbox: postSpin (base, win > threshold) auto-opens prompt after grace', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.window.__WIN_AWARD__ = 5;
  sb.HookBus.emit('postSpin', { duringFs: false });
  sb.drainTimers();
  eq(sb.window.GAMBLE_SECONDARY_STATE.phase, 'prompt');
});

t('sandbox: postSpin during FS suppressed when showInFs=false', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  sb.HookBus.emit('postSpin', { duringFs: true });
  sb.drainTimers();
  eq(sb.window.GAMBLE_SECONDARY_STATE.phase, 'idle');
});

/* ── determinism + vendor neutrality ── */

t('determinism: identical config → byte-identical emit triplet', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  eq(emitGambleSecondaryCSS(cfg),     emitGambleSecondaryCSS(cfg));
  eq(emitGambleSecondaryMarkup(cfg),  emitGambleSecondaryMarkup(cfg));
  eq(emitGambleSecondaryRuntime(cfg), emitGambleSecondaryRuntime(cfg));
});

t('vendor-neutral: no banned strings in any emit', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  const all = emitGambleSecondaryCSS(cfg) + emitGambleSecondaryMarkup(cfg) + emitGambleSecondaryRuntime(cfg);
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath','sweet bonanza',
                        'pragmatic','microgaming','playa-slot','playaslot','novomatic','aristocrat']) {
    if (all.toLowerCase().includes(banned)) throw new Error(`vendor leak: ${banned}`);
  }
});

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
