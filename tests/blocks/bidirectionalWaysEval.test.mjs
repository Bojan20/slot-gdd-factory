/**
 * tests/blocks/bidirectionalWaysEval.test.mjs
 *
 * Wave LEGO-BW1 — pure Node tests for bidirectionalWaysEval block.
 * Covers default config, resolveConfig clamps/validation, pure
 * evaluator semantics in both directions, emit triple shape,
 * HookBus wiring and vendor-neutral grep.
 */

import {
  defaultConfig,
  resolveConfig,
  emitBidirectionalWaysEvalCSS,
  emitBidirectionalWaysEvalMarkup,
  emitBidirectionalWaysEvalRuntime,
  evaluateLTR,
  evaluateRTL,
} from '../../src/blocks/bidirectionalWaysEval.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== bidirectionalWaysEval block ===');

/* ── 1. defaults ───────────────────────────────────────────────── */
const d = defaultConfig();
t('1. disabled by default + ltrEnabled=true + rtlEnabled=true',
  d.enabled === false && d.ltrEnabled === true && d.rtlEnabled === true);

/* ── 2. resolveConfig enables on explicit true ─────────────────── */
const r1 = resolveConfig({ bidirectionalWaysEval: { enabled: true } });
t('2. resolveConfig enables on enabled:true', r1.enabled === true);

/* ── 3. clamps minRunLength 2-5 ────────────────────────────────── */
const r2lo = resolveConfig({ bidirectionalWaysEval: { enabled: true, minRunLength: -10 } });
const r2hi = resolveConfig({ bidirectionalWaysEval: { enabled: true, minRunLength: 999 } });
const r2ok = resolveConfig({ bidirectionalWaysEval: { enabled: true, minRunLength: 4   } });
t('3. minRunLength clamps to 2..5',
  r2lo.minRunLength === 2 && r2hi.minRunLength === 5 && r2ok.minRunLength === 4);

/* ── 4. rejects invalid paytable shape (falls back to defaults) ─ */
const dPay = defaultConfig().paytable;
const r3a = resolveConfig({ bidirectionalWaysEval: { enabled: true, paytable: 'not-an-object' } });
const r3b = resolveConfig({ bidirectionalWaysEval: { enabled: true, paytable: [1, 2, 3]       } });
const r3c = resolveConfig({ bidirectionalWaysEval: { enabled: true, paytable: { H1: 'x' }     } });
t('4. invalid paytable shape rejected (defaults preserved)',
  JSON.stringify(r3a.paytable) === JSON.stringify(dPay) &&
  JSON.stringify(r3b.paytable) === JSON.stringify(dPay) &&
  JSON.stringify(r3c.paytable) === JSON.stringify(dPay));

/* ── 5. accepts valid hex highlights ──────────────────────────── */
const r4 = resolveConfig({
  bidirectionalWaysEval: { enabled: true, highlightLTR: '#ff0080', highlightRTL: '#00ff80' },
});
t('5. valid hex highlights applied', r4.highlightLTR === '#ff0080' && r4.highlightRTL === '#00ff80');

const r4bad = resolveConfig({
  bidirectionalWaysEval: { enabled: true, highlightLTR: 'notacolor', highlightRTL: 'rgb(1,2,3)' },
});
t('5b. invalid hex rejected, defaults preserved',
  r4bad.highlightLTR === '#ffaa00' && r4bad.highlightRTL === '#00aaff');

/* ── 6. ltrEnabled=false disables LTR but RTL works ───────────── */
const r5 = resolveConfig({
  bidirectionalWaysEval: { enabled: true, ltrEnabled: false, rtlEnabled: true },
});
t('6. ltrEnabled:false honoured, rtlEnabled stays true',
  r5.ltrEnabled === false && r5.rtlEnabled === true);

/* ── grid fixtures ────────────────────────────────────────────── */
const PT = { H1: [10, 25, 100], L1: [2, 5, 20] };
const MIN_RUN = 3;
const WILD = 'WW';

// 5-reel × 3-row, H1 on reels 0,1,2 starting from left
const gridLTR = [
  ['H1', 'H1', 'H1', 'L1', 'X1'],
  ['L1', 'L1', 'X1', 'X1', 'L1'],
  ['X1', 'X1', 'X1', 'L1', 'X1'],
];

// 5-reel × 3-row, H1 on reels 2,3,4 only (does NOT start at reel 0)
const gridLTRmiss = [
  ['X1', 'L1', 'H1', 'H1', 'H1'],
  ['L1', 'X1', 'X1', 'X1', 'L1'],
  ['X1', 'X1', 'X1', 'L1', 'X1'],
];

// 5-reel × 3-row, H1 on reels 4,3,2 — RTL hit
const gridRTL = [
  ['X1', 'X1', 'H1', 'H1', 'H1'],
  ['L1', 'L1', 'X1', 'X1', 'L1'],
  ['X1', 'X1', 'X1', 'L1', 'X1'],
];

// 5-reel × 3-row, H1 only on reel 0 — RTL miss
const gridRTLmiss = [
  ['H1', 'X1', 'X1', 'X1', 'X1'],
  ['H1', 'L1', 'X1', 'X1', 'L1'],
  ['H1', 'X1', 'X1', 'L1', 'X1'],
];

// Wild substitution: H1 on reel 0, WILD on reel 1, H1 on reel 2 → 3-reel LTR run
const gridWild = [
  ['H1', 'WW', 'H1', 'X1', 'X1'],
  ['L1', 'L1', 'X1', 'X1', 'L1'],
  ['X1', 'X1', 'X1', 'L1', 'X1'],
];

// < minRunLength: H1 only on reel 0 and 1 (run=2 < 3)
const gridShort = [
  ['H1', 'H1', 'X1', 'X1', 'X1'],
  ['X1', 'X1', 'X1', 'X1', 'X1'],
  ['X1', 'X1', 'X1', 'X1', 'X1'],
];

/* ── 7. evaluateLTR: 3-of-a-kind starting reel 1 → returns 1 win ─ */
const ltrA = evaluateLTR(gridLTR, PT, MIN_RUN, WILD);
t('7. LTR 3-of-a-kind starting reel 1 returns 1 win',
  ltrA.length === 1 && ltrA[0].symbol === 'H1' && ltrA[0].direction === 'LTR');

/* ── 8. evaluateLTR: 3-of-a-kind NOT starting reel 1 → no win ─── */
const ltrB = evaluateLTR(gridLTRmiss, PT, MIN_RUN, WILD);
const noH1WinB = !ltrB.some(w => w.symbol === 'H1');
t('8. LTR ignores 3-of-a-kind that does not start at reel 0', noH1WinB);

/* ── 9. evaluateRTL: 3-of-a-kind starting reel N → returns 1 win ─ */
const rtlA = evaluateRTL(gridRTL, PT, MIN_RUN, WILD);
t('9. RTL 3-of-a-kind starting reel N returns 1 win',
  rtlA.length === 1 && rtlA[0].symbol === 'H1' && rtlA[0].direction === 'RTL');

/* ── 10. evaluateRTL: 3-of-a-kind NOT starting reel N → no win ── */
const rtlB = evaluateRTL(gridRTLmiss, PT, MIN_RUN, WILD);
const noH1WinR = !rtlB.some(w => w.symbol === 'H1');
t('10. RTL ignores 3-of-a-kind that does not start at last reel', noH1WinR);

/* ── 11. evaluateLTR: wild substitutes correctly ──────────────── */
const ltrW = evaluateLTR(gridWild, PT, MIN_RUN, WILD);
const hasH1Wild = ltrW.some(w => w.symbol === 'H1' && w.reelsHit.length >= 3);
t('11. LTR wild substitutes for paying symbol', hasH1Wild);

/* ── 12. evaluateLTR: empty grid → [] ────────────────────────── */
t('12. LTR empty grid returns []',
  Array.isArray(evaluateLTR([], PT, MIN_RUN, WILD)) && evaluateLTR([], PT, MIN_RUN, WILD).length === 0 &&
  evaluateLTR(null, PT, MIN_RUN, WILD).length === 0);

/* ── 13. evaluateLTR: < minRunLength → no win ────────────────── */
const ltrShort = evaluateLTR(gridShort, PT, MIN_RUN, WILD);
t('13. LTR run shorter than minRunLength yields no win', ltrShort.length === 0);

/* ── 14. emit CSS: contains .bidir-pay-ltr + .bidir-pay-rtl ──── */
const cssOn = emitBidirectionalWaysEvalCSS({ enabled: true });
t('14. CSS contains .bidir-pay-ltr and .bidir-pay-rtl',
  cssOn.includes('.cell.bidir-pay-ltr') && cssOn.includes('.cell.bidir-pay-rtl'));

/* ── 15. emit CSS: empty when disabled ───────────────────────── */
const cssOff = emitBidirectionalWaysEvalCSS({ enabled: false });
t('15. CSS marks disabled when feature off',
  cssOff.includes('disabled') && !cssOff.includes('.cell.bidir-pay-ltr {'));

/* ── 16. emit Markup: empty when disabled ────────────────────── */
const mkOff = emitBidirectionalWaysEvalMarkup({ enabled: false });
const mkOn  = emitBidirectionalWaysEvalMarkup({ enabled: true  });
t('16. Markup disabled stub vs enabled host element',
  mkOff.includes('disabled') && mkOn.includes('id="bidirWaysHost"'));

/* ── 17. emit Runtime: registers HookBus listeners ───────────── */
const rtOn = emitBidirectionalWaysEvalRuntime({ enabled: true });
t('17. Runtime registers onSpinResult, preSpin, onFsEnd listeners',
  rtOn.includes("HookBus.on('onSpinResult'") &&
  rtOn.includes("HookBus.on('preSpin'") &&
  rtOn.includes("HookBus.on('onFsEnd'"));

/* ── 18. emit Runtime: empty when disabled ───────────────────── */
const rtOff = emitBidirectionalWaysEvalRuntime({ enabled: false });
t('18. Runtime stub when disabled',
  rtOff.includes('disabled') && !rtOff.includes('HookBus.on('));

/* ── 19. emit Runtime: HW guard + priority 80 ────────────────── */
t('19. Runtime includes wired-once HW guard + priority 80',
  rtOn.includes('window.__BIDIR_WAYS_EVAL_WIRED__') &&
  rtOn.includes('priority: 80'));

/* ── 19b. emit Runtime: emits expected payload event ─────────── */
t('19b. Runtime emits onBidirectionalWaysPay payload',
  rtOn.includes("HookBus.emit('onBidirectionalWaysPay'") &&
  rtOn.includes("HookBus.emit('onBidirectionalWaysCleared'"));

/* ── 20. vendor-neutral grep: 0 hits across all emit outputs ─── */
const allOutput =
  emitBidirectionalWaysEvalCSS({ enabled: true })     +
  emitBidirectionalWaysEvalMarkup({ enabled: true })  +
  emitBidirectionalWaysEvalRuntime({ enabled: true });
const VENDOR_RE = /(igt|pragmatic|netent|microgaming|cash[- ]eruption|wolf[- ]run|cleopatra|buffalo|megaways|scientific\s+games)/i;
t('20. vendor-neutral: 0 banned vendor mentions in emitted output',
  !VENDOR_RE.test(allOutput));

/* ── 21. payX math sanity: 3-reel run with 1×1×1 ways uses bucket[0] ─ */
const tinyPT = { H1: [10, 50, 100] };
const ltrTiny = evaluateLTR(
  [
    ['H1', 'H1', 'H1', 'X1', 'X1'],
    ['X1', 'X1', 'X1', 'X1', 'X1'],
    ['X1', 'X1', 'X1', 'X1', 'X1'],
  ],
  tinyPT,
  3,
  null,
);
t('21. LTR pay maths: 3-reel 1-way run uses bucket[0] × ways',
  ltrTiny.length === 1 && ltrTiny[0].payX === 10);

/* ── 22. ways multiplier: 2×1×1 = 2 ways ────────────────────── */
const ltrWays = evaluateLTR(
  [
    ['H1', 'H1', 'H1', 'X1', 'X1'],
    ['H1', 'X1', 'X1', 'X1', 'X1'],
    ['X1', 'X1', 'X1', 'X1', 'X1'],
  ],
  tinyPT,
  3,
  null,
);
t('22. LTR ways multiplier: 2×1×1 produces payX=20',
  ltrWays.length === 1 && ltrWays[0].payX === 20);

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
