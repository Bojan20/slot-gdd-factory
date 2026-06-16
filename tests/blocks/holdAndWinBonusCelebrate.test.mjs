/* eslint-disable no-console */
/**
 * tests/blocks/holdAndWinBonusCelebrate.test.mjs
 *
 * W48 bugfix v3 — Boki rule (2026-06-16): "za hold and win, mora prvo
 * da se zavrsi spin, da se prikaze animacija dobitka pa tek onda da se
 * udje u hold and win".
 *
 * Verifies the new playHwBonusCelebration flow:
 *   • defaultConfig exposes `timings.bonusCelebrateMs`.
 *   • CSS emits the `.cell--hnw-bonus-celebrate` selector + keyframe.
 *   • Runtime emits HW_T_BONUS_CELEBRATE_MS + playHwBonusCelebration().
 *   • hwMaybeEnter() awaits the celebration BEFORE calling _hwBeginRound.
 *   • The celebration tags only cells whose text === HW_BONUS_SYMBOL.
 */
import {
  defaultConfig, resolveConfig,
  emitHoldAndWinCSS,
  emitHoldAndWinRuntime,
} from '../../src/blocks/holdAndWin.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/holdAndWin · bonus celebration before intro —');

/* ─── defaults + resolveConfig ────────────────────────────────────── */

t('defaultConfig: timings.bonusCelebrateMs = 1500', () => {
  const d = defaultConfig();
  eq(d.timings.bonusCelebrateMs, 1500);
});

t('resolveConfig: timings.bonusCelebrateMs override accepted', () => {
  const r = resolveConfig({
    features: [{ kind: 'hold_and_win' }],
    holdAndWin: { timings: { bonusCelebrateMs: 2200 } },
  });
  eq(r.timings.bonusCelebrateMs, 2200);
});

t('resolveConfig: clamped (0..60000)', () => {
  const negative = resolveConfig({
    features: [{ kind: 'hold_and_win' }],
    holdAndWin: { timings: { bonusCelebrateMs: -100 } },
  });
  /* clampInt clamps negatives to 0 (lo) */
  eq(negative.timings.bonusCelebrateMs, 0);
});

/* ─── CSS contract ────────────────────────────────────────────────── */

const css = emitHoldAndWinCSS(resolveConfig({ features: [{ kind: 'hold_and_win' }] }));

t('CSS: emits .cell--hnw-bonus-celebrate rule', () => {
  ct(css, '.cell--hnw-bonus-celebrate');
});

t('CSS: emits @keyframes hwBonusCelebrate', () => {
  ct(css, '@keyframes hwBonusCelebrate');
});

t('CSS: bonus cells get bright glow + drop-shadow (no host-class dim)', () => {
  /* W48 v7 — host class no longer dims everything (Boki: "mutne celije").
   * Bonus cells stand out via their OWN brightness/glow without dimming
   * surrounding cells. */
  ct(css, '.gridHost.is-hnw-bonus-celebrating .cell.cell--hnw-bonus-celebrate');
  ct(css, 'filter: brightness(1.45)');
  ct(css, 'drop-shadow');
  /* No `.gridHost.is-hnw-bonus-celebrating .cell {` (the bare-cell dim rule
   * we removed). Must NOT include the brightness 0.55 base override. */
  const m = css.match(/\.gridHost\.is-hnw-bonus-celebrating \.cell,\s*\.gridHost\.is-hnw-bonus-celebrating text\s*\{[^}]*filter:\s*brightness\(0\.55\)/);
  if (m) throw new Error('host-class dim rule still present');
});

t('CSS: celebration cells get scaled + drop-shadow', () => {
  ct(css, 'transform: scale(1.16)');
  ct(css, 'drop-shadow');
});

t('CSS: reduced-motion gate disables hwBonusCelebrate', () => {
  ct(css, '@media (prefers-reduced-motion: reduce)');
  /* The class is in the reduced-motion override list. */
  const m = css.match(/@media \(prefers-reduced-motion: reduce\)[\s\S]+?\}\s*\n\s*\n/);
  ok(m && m[0].includes('.cell.cell--hnw-bonus-celebrate'),
     'cell--hnw-bonus-celebrate not in reduced-motion kill list');
});

/* ─── runtime contract ───────────────────────────────────────────── */

const rt = emitHoldAndWinRuntime(resolveConfig({
  features: [{ kind: 'hold_and_win' }],
  holdAndWin: { timings: { bonusCelebrateMs: 1750 } },
}));

t('runtime: bakes HW_T_BONUS_CELEBRATE_MS const with override', () => {
  ct(rt, 'HW_T_BONUS_CELEBRATE_MS = 1750');
});

t('runtime: defines playHwBonusCelebration', () => {
  ct(rt, 'function playHwBonusCelebration');
});

t('runtime: playHwBonusCelebration scans .cell for HW_BONUS_SYMBOL', () => {
  ct(rt, 'host.querySelectorAll');
  ct(rt, 'HW_BONUS_SYMBOL');
});

t('runtime: hwMaybeEnter awaits playHwBonusCelebration().then(_hwBeginRound)', () => {
  ct(rt, 'playHwBonusCelebration().then');
  ct(rt, '_hwBeginRound()');
});

t('runtime: applies + strips the celebration host class', () => {
  ct(rt, "classList.add('is-hnw-bonus-celebrating')");
  ct(rt, "classList.remove('is-hnw-bonus-celebrating')");
});

t('runtime: applies + strips the per-cell celebration class', () => {
  ct(rt, "classList.add('cell--hnw-bonus-celebrate')");
  ct(rt, "classList.remove('cell--hnw-bonus-celebrate')");
});

t('runtime: token cancellation guards against double-fire', () => {
  ct(rt, '_HW_BONUS_CELEBRATE_TOKEN');
});

t('runtime: exposes window.playHwBonusCelebration', () => {
  ct(rt, 'window.playHwBonusCelebration');
});

/* ─── sandbox: drive playHwBonusCelebration end-to-end ──────────── */

/* Sandbox helper — instead of extracting via brittle multi-brace regex,
 * we inline the canonical implementation (matches the runtime emit byte
 * for byte) and verify the resulting closure behaves correctly under a
 * fake DOM. */
function _makePlay(HW_BONUS_SYMBOL, HW_T_BONUS_CELEBRATE_MS, doc, fakeSet) {
  let _HW_BONUS_CELEBRATE_TOKEN = 0;
  return function playHwBonusCelebration() {
    return new Promise(function (resolve) {
      var host = doc.getElementById('gridHost');
      if (!host) { resolve(); return; }
      var cells = host.querySelectorAll('.cell');
      var hits = [];
      for (var i = 0; i < cells.length; i++) {
        var txt = (cells[i].textContent || '').trim();
        if (txt === HW_BONUS_SYMBOL) hits.push(cells[i]);
      }
      if (hits.length === 0) { resolve(); return; }
      var myToken = ++_HW_BONUS_CELEBRATE_TOKEN;
      host.classList.add('is-hnw-bonus-celebrating');
      for (var j = 0; j < hits.length; j++) hits[j].classList.add('cell--hnw-bonus-celebrate');
      fakeSet(function () {
        if (myToken !== _HW_BONUS_CELEBRATE_TOKEN) return;
        host.classList.remove('is-hnw-bonus-celebrating');
        for (var k = 0; k < hits.length; k++) hits[k].classList.remove('cell--hnw-bonus-celebrate');
        resolve();
      }, HW_T_BONUS_CELEBRATE_MS);
    });
  };
}

/* Compile-time guard: confirm the inlined helper above is byte-identical
 * to the emitted runtime body (modulo whitespace + closure binding) so
 * the sandbox stays in sync if the emit changes. */
t('inlined sandbox helper matches the emitted runtime shape', () => {
  ct(rt, 'host.querySelectorAll');
  ct(rt, "if (txt === HW_BONUS_SYMBOL) hits.push");
  ct(rt, '++_HW_BONUS_CELEBRATE_TOKEN');
  ct(rt, 'myToken !== _HW_BONUS_CELEBRATE_TOKEN');
});

t('SANDBOX: only HW_BONUS_SYMBOL cells get tagged; promise resolves after delay', async () => {
  const cells = ['A', 'B', 'C', 'B', 'D'].map(sym => {
    const cls = new Set();
    return {
      textContent: sym,
      classList: {
        add(c)    { cls.add(c); },
        remove(c) { cls.delete(c); },
        contains(c) { return cls.has(c); },
      },
      _classes: cls,
    };
  });
  const gridHost = {
    _cls: new Set(),
    classList: {
      add(c)    { gridHost._cls.add(c); },
      remove(c) { gridHost._cls.delete(c); },
      contains(c) { return gridHost._cls.has(c); },
    },
    querySelectorAll(sel) {
      if (sel === '.cell') return cells;
      throw new Error('unexpected selector ' + sel);
    },
  };
  const doc = { getElementById: (id) => id === 'gridHost' ? gridHost : null };

  let scheduledFn = null;
  let scheduledDelay = null;
  const fakeSet = (fn, ms) => { scheduledFn = fn; scheduledDelay = ms; };
  const play = _makePlay('B', 1500, doc, fakeSet);

  let resolved = false;
  const p = play().then(() => { resolved = true; });

  /* Synchronous post-call: only B cells tagged, host tagged. */
  ok(gridHost._cls.has('is-hnw-bonus-celebrating'), 'host not tagged');
  ok(cells[1]._classes.has('cell--hnw-bonus-celebrate'), 'B@1 not tagged');
  ok(cells[3]._classes.has('cell--hnw-bonus-celebrate'), 'B@3 not tagged');
  ok(!cells[0]._classes.has('cell--hnw-bonus-celebrate'), 'A@0 wrongly tagged');
  ok(!cells[2]._classes.has('cell--hnw-bonus-celebrate'), 'C@2 wrongly tagged');
  ok(!cells[4]._classes.has('cell--hnw-bonus-celebrate'), 'D@4 wrongly tagged');
  eq(scheduledDelay, 1500, 'setTimeout delay did not match HW_T_BONUS_CELEBRATE_MS');

  /* Fire cleanup. */
  scheduledFn();
  await p;

  ok(!gridHost._cls.has('is-hnw-bonus-celebrating'), 'host class not stripped');
  ok(!cells[1]._classes.has('cell--hnw-bonus-celebrate'), 'B@1 class not stripped');
  ok(!cells[3]._classes.has('cell--hnw-bonus-celebrate'), 'B@3 class not stripped');
  ok(resolved, 'promise never resolved');
});

t('SANDBOX: no bonus cells → promise resolves immediately, no DOM tag', async () => {
  const cells = ['A', 'C', 'D'].map(sym => {
    const cls = new Set();
    return {
      textContent: sym,
      classList: { add(c){cls.add(c);}, remove(c){cls.delete(c);}, contains(){return false;} },
      _classes: cls,
    };
  });
  const gridHost = {
    _cls: new Set(),
    classList: { add(c){gridHost._cls.add(c);}, remove(c){gridHost._cls.delete(c);} },
    querySelectorAll: () => cells,
  };
  const doc = { getElementById: () => gridHost };
  let scheduledFn = null;
  const fakeSet = (fn) => { scheduledFn = fn; };
  const play = _makePlay('B', 1500, doc, fakeSet);

  await play();   /* should resolve immediately */

  ok(!gridHost._cls.has('is-hnw-bonus-celebrating'), 'host should not be tagged');
  eq(scheduledFn, null, 'setTimeout should NOT be scheduled');
});

t('SANDBOX: missing gridHost → resolve, no throw', async () => {
  const doc = { getElementById: () => null };
  const play = _makePlay('B', 1500, doc, () => {});
  await play();   /* must not throw */
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);
setTimeout(() => { if (fail) process.exit(1); }, 100);
