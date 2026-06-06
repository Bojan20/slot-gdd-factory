/* eslint-disable no-console */
/**
 * Wave T-slim Phase 2 — globalsContract runtime tests.
 *
 * Coverage:
 *   • emitGlobalsContractRuntime — emits every documented window.* assignment
 *   • Guarded against SSR (typeof window check)
 *   • RECT_REELS uses Object.defineProperty getter (live read, not snapshot)
 *   • Vendor neutrality
 */

import { emitGlobalsContractRuntime } from '../../src/runtime/globalsContract.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— runtime/globalsContract.mjs —');

t('SSR guard: typeof window !== "undefined" wrap', () => {
  const s = emitGlobalsContractRuntime();
  ct(s, 'if (typeof window !== "undefined")');
});

t('exposes FREESPINS', () => {
  ct(emitGlobalsContractRuntime(), 'window.FREESPINS = FREESPINS');
});

t('exposes SHAPE + derived REELS / ROWS', () => {
  const s = emitGlobalsContractRuntime();
  ct(s, 'window.SHAPE = SHAPE');
  ct(s, 'window.REELS = SHAPE.reels');
  ct(s, 'window.ROWS  = SHAPE.rows');
});

t('exposes RECT_REELS as live getter (defineProperty)', () => {
  const s = emitGlobalsContractRuntime();
  ct(s, "Object.defineProperty(window, 'RECT_REELS'");
  ct(s, 'get: function () { return RECT_REELS; }');
  /* sanity: NOT a static assignment */
  nct(s, 'window.RECT_REELS = RECT_REELS;');
});

t('exposes PAYLINE_POOL + SYMBOL_REGISTRY', () => {
  const s = emitGlobalsContractRuntime();
  ct(s, 'window.PAYLINE_POOL = PAYLINE_POOL');
  ct(s, 'window.SYMBOL_REGISTRY = SYMBOL_REGISTRY');
});

t('exposes QA probes (applyWinHighlight / detectLineWins / drawPaylineOverlay)', () => {
  const s = emitGlobalsContractRuntime();
  ct(s, 'window.applyWinHighlight = applyWinHighlight');
  ct(s, 'window.detectLineWins = detectLineWins');
  ct(s, 'window.drawPaylineOverlay = drawPaylineOverlay');
});

t('no arguments accepted (pure emit, model-independent)', () => {
  /* idempotent across calls — no side effects */
  const a = emitGlobalsContractRuntime();
  const b = emitGlobalsContractRuntime();
  if (a !== b) throw new Error('emit must be deterministic / arg-free');
});

t('vendor neutrality: no game / vendor names', () => {
  const blob = emitGlobalsContractRuntime();
  for (const v of ['IGT','Pragmatic','Cleopatra','Buffalo','Megaways','NetEnt',
                   'Zeus','Olympus','Reactoonz','Bonanza','WoO','GoO',
                   'playa-slot']) {
    nct(blob, v, `vendor mention "${v}" leaked into runtime emit`);
  }
});

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail) process.exit(1);
