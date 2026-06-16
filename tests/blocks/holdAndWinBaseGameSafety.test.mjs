/* eslint-disable no-console */
/**
 * tests/blocks/holdAndWinBaseGameSafety.test.mjs
 *
 * W48 bugfix v7 — Boki rule (2026-06-16):
 *   "sjebo si u base game reel spin reel land i mutne su celije. vrati
 *    to kako je bilo."
 *
 * Root cause: v3 added a host-class dim rule
 *   .gridHost.is-hnw-bonus-celebrating .cell { filter: brightness(0.55) }
 * which paints EVERY cell dim while the class is present. Token
 * cancellation paths inside playHwBonusCelebration could leave the
 * class on the host (if a second celebration superseded the first),
 * so subsequent base-game cells appeared muddy until page reload.
 *
 * Fixes verified:
 *   1. The dim rule is REMOVED — bonus cells stand out via their own
 *      bright glow only, surrounding cells are untouched.
 *   2. preSpin listener installs a defensive cleanup: any leftover
 *      `is-hnw-bonus-celebrating` host class + `cell--hnw-bonus-celebrate`
 *      cell classes are stripped at the start of every spin.
 */
import {
  defaultConfig,
  emitHoldAndWinCSS,
  emitHoldAndWinRuntime,
} from '../../src/blocks/holdAndWin.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };
const nc = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`should NOT include ${JSON.stringify(n)} — ${m}`); };

console.log('— W48 bugfix v7 · base-game safety (no dim leak, defensive cleanup) —');

const css = emitHoldAndWinCSS({ ...defaultConfig(), enabled: true });
const rt  = emitHoldAndWinRuntime({ ...defaultConfig(), enabled: true });

/* ─── CSS — host-class dim rule REMOVED ──────────────────────────── */

t('CSS no longer dims ALL cells when celebration host class is present', () => {
  /* The exact rule we removed was:
   *   .gridHost.is-hnw-bonus-celebrating .cell,
   *   .gridHost.is-hnw-bonus-celebrating text {
   *     filter: brightness(0.55) saturate(0.7);
   *   }
   * That blanket dim must not be back. */
  nc(css, 'brightness(0.55)');
  nc(css, 'saturate(0.7)');
});

t('CSS still highlights ONLY the bonus cells (cell--hnw-bonus-celebrate)', () => {
  /* The bright glow rule remains — bonus cells stand out via brightness
   * 1.45 + drop-shadow + scale animation. */
  ct(css, '.cell.cell--hnw-bonus-celebrate');
  ct(css, 'brightness(1.45)');
  ct(css, 'drop-shadow');
  ct(css, '@keyframes hwBonusCelebrate');
});

/* ─── Runtime — defensive preSpin cleanup ───────────────────────── */

t('runtime installs a preSpin listener that strips celebration host class', () => {
  ct(rt, "HookBus.on('preSpin'");
  const preSpinBlock = rt.match(/HookBus\.on\('preSpin'[\s\S]*?\}, \{ priority: 10 \}\);/);
  ok(preSpinBlock, 'preSpin listener with priority:10 not found');
  ct(preSpinBlock[0], "remove('is-hnw-bonus-celebrating')");
});

t('runtime preSpin listener also strips per-cell celebration class', () => {
  const preSpinBlock = rt.match(/HookBus\.on\('preSpin'[\s\S]*?\}, \{ priority: 10 \}\);/);
  ct(preSpinBlock[0], "remove('cell--hnw-bonus-celebrate')");
});

t('runtime preSpin listener wrapped in try/catch (won\'t throw across stages)', () => {
  const preSpinBlock = rt.match(/HookBus\.on\('preSpin'[\s\S]*?\}, \{ priority: 10 \}\);/);
  ct(preSpinBlock[0], 'try {');
  ct(preSpinBlock[0], '} catch (_) {}');
});

/* ─── Sandbox — preSpin cleanup actually clears state ──────────── */

t('SANDBOX: preSpin handler clears lingering celebration classes', () => {
  /* Simulate the preSpin handler. */
  function preSpinHandler(doc) {
    try {
      const host = doc.getElementById('gridHost');
      if (host && host.classList) {
        host.classList.remove('is-hnw-bonus-celebrating');
        if (host.querySelectorAll) {
          host.querySelectorAll('.cell--hnw-bonus-celebrate').forEach(function (c) {
            c.classList.remove('cell--hnw-bonus-celebrate');
          });
        }
      }
    } catch (_) {}
  }
  /* Set up: a host with the dim class + 2 cells with the celebrate class. */
  const cellA = { _cls: new Set(['cell--hnw-bonus-celebrate']),
                  classList: { remove(c){ cellA._cls.delete(c); }, contains(c){ return cellA._cls.has(c); } } };
  const cellB = { _cls: new Set(['cell--hnw-bonus-celebrate']),
                  classList: { remove(c){ cellB._cls.delete(c); }, contains(c){ return cellB._cls.has(c); } } };
  const host = {
    _cls: new Set(['is-hnw-bonus-celebrating']),
    classList: { remove(c){ host._cls.delete(c); }, contains(c){ return host._cls.has(c); } },
    querySelectorAll(sel) {
      if (sel === '.cell--hnw-bonus-celebrate') return [cellA, cellB];
      return [];
    },
  };
  const doc = { getElementById: (id) => id === 'gridHost' ? host : null };

  preSpinHandler(doc);

  ok(!host._cls.has('is-hnw-bonus-celebrating'), 'host class not stripped');
  ok(!cellA._cls.has('cell--hnw-bonus-celebrate'), 'cellA class not stripped');
  ok(!cellB._cls.has('cell--hnw-bonus-celebrate'), 'cellB class not stripped');
});

t('SANDBOX: preSpin handler is no-op when no leftover state (cheap fast path)', () => {
  function preSpinHandler(doc) {
    try {
      const host = doc.getElementById('gridHost');
      if (host && host.classList) {
        host.classList.remove('is-hnw-bonus-celebrating');
        if (host.querySelectorAll) {
          host.querySelectorAll('.cell--hnw-bonus-celebrate').forEach(function (c) {
            c.classList.remove('cell--hnw-bonus-celebrate');
          });
        }
      }
    } catch (_) {}
  }
  const host = {
    _cls: new Set(),                                    // already clean
    classList: { remove() {}, contains() { return false; } },
    querySelectorAll() { return []; },                   // no cells need stripping
  };
  const doc = { getElementById: () => host };
  /* Should not throw. */
  preSpinHandler(doc);
  eq(host._cls.size, 0);
});

t('SANDBOX: preSpin handler graceful when gridHost missing', () => {
  function preSpinHandler(doc) {
    try {
      const host = doc.getElementById('gridHost');
      if (host && host.classList) {
        host.classList.remove('is-hnw-bonus-celebrating');
      }
    } catch (_) {}
  }
  const doc = { getElementById: () => null };
  /* No throw expected. */
  preSpinHandler(doc);
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);
if (fail) process.exit(1);
