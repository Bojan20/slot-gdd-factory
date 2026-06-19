#!/usr/bin/env node
/**
 * tests/blocks/allWaysEval.test.mjs
 *
 * Senior-grade pure-Node test suite for allWaysEval block.
 * Industry-reference "all-ways" universal evaluator (LTR ∪ RTL).
 */

import {
  defaultConfig,
  resolveConfig,
  emitAllWaysEvalCSS,
  emitAllWaysEvalMarkup,
  emitAllWaysEvalRuntime,
  evaluateAllWays,
  findConsecutiveRuns,
} from '../../src/blocks/allWaysEval.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== allWaysEval block ===');

/* ── 1. defaults ────────────────────────────────────────────────── */
const d = defaultConfig();
t('1. default disabled', d.enabled === false);
t('1. default minRunLength=3', d.minRunLength === 3);
t('1. default countWildAsAny=true', d.countWildAsAny === true);
t('1. default evaluateBothDirections=true', d.evaluateBothDirections === true);
t('1. default showPayPath=true', d.showPayPath === true);

/* ── 2. resolveConfig: enables on explicit true ──────────────────── */
const r2 = resolveConfig({ allWaysEval: { enabled: true } });
t('2. resolveConfig honors enabled=true', r2.enabled === true);

/* ── 3. resolveConfig: clamps minRunLength 2-6 ───────────────────── */
const r3lo = resolveConfig({ allWaysEval: { enabled: true, minRunLength: 1 } });
t('3. clamp minRunLength low → 2', r3lo.minRunLength === 2);
const r3hi = resolveConfig({ allWaysEval: { enabled: true, minRunLength: 99 } });
t('3. clamp minRunLength high → 6', r3hi.minRunLength === 6);
const r3ok = resolveConfig({ allWaysEval: { enabled: true, minRunLength: 4 } });
t('3. valid minRunLength=4 retained', r3ok.minRunLength === 4);

/* ── 4. resolveConfig: rejects malformed paytable ────────────────── */
const dflt4 = defaultConfig();
const r4 = resolveConfig({ allWaysEval: { enabled: true, paytable: null } });
t('4. rejects null paytable (keeps default)', JSON.stringify(r4.paytable) === JSON.stringify(dflt4.paytable));
const r4b = resolveConfig({ allWaysEval: { enabled: true, paytable: { H: 'not-array' } } });
t('4. rejects non-array paytable rows', JSON.stringify(r4b.paytable) === JSON.stringify(dflt4.paytable));
const r4c = resolveConfig({ allWaysEval: { enabled: true, paytable: { H: [10, -5, 100] } } });
t('4. rejects negative pay values', JSON.stringify(r4c.paytable) === JSON.stringify(dflt4.paytable));
const r4ok = resolveConfig({ allWaysEval: { enabled: true, paytable: { H: [10, 25, 100] } } });
t('4. accepts well-formed paytable', JSON.stringify(r4ok.paytable.H) === '[10,25,100]');

/* ── 5. resolveConfig: countWildAsAny knob accepted ──────────────── */
const r5off = resolveConfig({ allWaysEval: { enabled: true, countWildAsAny: false } });
t('5. countWildAsAny=false honored', r5off.countWildAsAny === false);
const r5on  = resolveConfig({ allWaysEval: { enabled: true, countWildAsAny: true } });
t('5. countWildAsAny=true honored', r5on.countWildAsAny === true);

/* ── helpers for evaluator tests ─────────────────────────────────── */
const PT = { H: [5, 10, 25], M: [2, 5, 15], L: [1, 2, 5] };
const WILD = 'W';

/* ── 6. evaluateAllWays: simple 3-of-a-kind LTR → returns 1 win ─── */
{
  // 5 reels, H on reels 0,1,2 only
  const grid = [
    ['H', 'L'],
    ['H', 'M'],
    ['H', 'L'],
    ['M', 'L'],
    ['L', 'M'],
  ];
  const wins = evaluateAllWays(grid, PT, 3, null, { evaluateBothDirections: false });
  t('6. simple LTR 3-of-a-kind → exactly 1 win', wins.length === 1, 'got ' + wins.length);
  t('6. LTR win has direction=ltr', wins.length === 1 && wins[0].direction === 'ltr');
  t('6. LTR win reelsHit=[0,1,2]', wins.length === 1 && JSON.stringify(wins[0].reelsHit) === '[0,1,2]');
  t('6. LTR win symbol=H', wins.length === 1 && wins[0].symbol === 'H');
  t('6. LTR win payX=5 (run=3 → row[0])', wins.length === 1 && wins[0].payX === 5);
}

/* ── 7. evaluateAllWays: 3-of-a-kind RTL (reels 2,3,4) → 1 win ──── */
{
  // 5 reels, H on reels 2,3,4 (right-anchored). Other reels filled with
  // unique symbols (X, Y) that have no paytable entry → only H pays.
  const grid = [
    ['X', 'X'],
    ['Y', 'Y'],
    ['H', 'X'],
    ['H', 'Y'],
    ['H', 'X'],
  ];
  const wins = evaluateAllWays(grid, PT, 3, null, { evaluateBothDirections: true });
  const rtl = wins.filter(w => w.direction === 'rtl');
  const ltr = wins.filter(w => w.direction === 'ltr');
  t('7. RTL-only 3-of-a-kind → exactly 1 win', wins.length === 1, 'got ' + wins.length);
  t('7. win direction=rtl', rtl.length === 1 && ltr.length === 0);
  t('7. RTL reelsHit=[2,3,4]', rtl.length === 1 && JSON.stringify(rtl[0].reelsHit) === '[2,3,4]');
}

/* ── 8. evaluateAllWays: both directions same symbol → 2 distinct wins ── */
{
  // 5 reels, H on reels 0,1,2 AND 2,3,4 (overlapping at reel 2,
  // but anchored at both ends — should pay LTR and RTL separately)
  const grid = [
    ['H', 'L'],
    ['H', 'M'],
    ['H', 'L'],
    ['H', 'L'],
    ['H', 'M'],
  ];
  const wins = evaluateAllWays(grid, PT, 3, null, { evaluateBothDirections: true });
  // H spans all 5 reels — both LTR (0..4) and RTL (0..4) would be identical
  // → block dedupes when LTR run spans entire reel set. Expect 1 win.
  t('8a. spans-all-reels symbol → 1 win (dedupe)', wins.length === 1);

  // Now construct a case where the symbol is on 0,1,2,_,3,4 (gap at reel 3)
  // — wait that doesn't make sense. Use 5 reels: H on 0,1,2 and 3,4 (no gap).
  // For 2 distinct wins we need a GAP: H on reels 0,1,2 only AND on reels 4 only,
  // which fails minRun=3 on RTL.
  // True both-direction case: 6 reels, H on 0,1,2 and 3,4,5 — that's a single
  // continuous LTR run of 6 → 1 win.
  // Realistic distinct-wins case: M on 0,1,2 (LTR) AND H on 2,3,4 (RTL) on 5 reels:
  const grid2 = [
    ['M', 'L'],
    ['M', 'M'],
    ['M', 'H'],
    ['L', 'H'],
    ['L', 'H'],
  ];
  const wins2 = evaluateAllWays(grid2, PT, 3, null, { evaluateBothDirections: true });
  t('8b. distinct symbols LTR+RTL → 2 wins', wins2.length === 2,
    'got ' + wins2.length + ' wins: ' + JSON.stringify(wins2.map(w => w.symbol + '-' + w.direction)));
  const sym2 = wins2.map(w => w.symbol + ':' + w.direction).sort();
  t('8b. wins include M:ltr and H:rtl',
    sym2.length === 2 && sym2.indexOf('H:rtl') !== -1 && sym2.indexOf('M:ltr') !== -1,
    'got: ' + JSON.stringify(sym2));
}

/* ── 9. evaluateAllWays: wild substitutes correctly ──────────────── */
{
  // 5 reels: H on 0,1, WILD on 2 → wild bridges → 3-run LTR win
  const grid = [
    ['H', 'L'],
    ['H', 'M'],
    ['W', 'L'],
    ['M', 'M'],
    ['L', 'L'],
  ];
  const wins = evaluateAllWays(grid, PT, 3, WILD, { evaluateBothDirections: false });
  const hWin = wins.find(w => w.symbol === 'H');
  t('9. wild substitution → H wins LTR with run=3',
    hWin && JSON.stringify(hWin.reelsHit) === '[0,1,2]' && hWin.payX === 5);
}

/* ── 10. evaluateAllWays: < minRunLength → no win ─────────────────── */
{
  // Only 2-of-a-kind, minRun=3 → no wins
  const grid = [
    ['H', 'L'],
    ['H', 'M'],
    ['L', 'L'],
    ['M', 'M'],
    ['L', 'L'],
  ];
  const wins = evaluateAllWays(grid, PT, 3, null, { evaluateBothDirections: true });
  t('10. below minRunLength → 0 wins', wins.length === 0);
}

/* ── 11. findConsecutiveRuns: simple sequence ────────────────────── */
{
  const runs = findConsecutiveRuns([0, 1, 2, 3, 4], 5);
  t('11. consecutive 0..4 → single run of 5', runs.length === 1 && runs[0].length === 5);
}

/* ── 12. findConsecutiveRuns: gaps split run ──────────────────────── */
{
  const runs = findConsecutiveRuns([0, 1, 2, 4, 5], 6);
  t('12. gap at 3 splits → 2 runs', runs.length === 2);
  t('12. first run = [0,1,2]', JSON.stringify(runs[0]) === '[0,1,2]');
  t('12. second run = [4,5]',   JSON.stringify(runs[1]) === '[4,5]');
}

/* ── 13. findConsecutiveRuns: empty input → [] ────────────────────── */
{
  t('13. empty input → []', JSON.stringify(findConsecutiveRuns([], 5)) === '[]');
  t('13. null input → []',  JSON.stringify(findConsecutiveRuns(null, 5)) === '[]');
}

/* ── 14. emit CSS: contains .all-ways-pay-path class ─────────────── */
{
  const css = emitAllWaysEvalCSS(resolveConfig({ allWaysEval: { enabled: true } }));
  t('14. CSS contains .all-ways-pay-path class', css.indexOf('.all-ways-pay-path') !== -1);
  t('14. CSS contains @keyframes', css.indexOf('@keyframes all-ways-pay-pulse') !== -1);
  t('14. CSS contains reduced-motion guard',
    css.indexOf('@media (prefers-reduced-motion: reduce)') !== -1);
}

/* ── 15. emit CSS: empty when disabled ───────────────────────────── */
{
  const css = emitAllWaysEvalCSS(defaultConfig());
  t('15. CSS disabled → contains "(disabled)" sentinel',
    css.indexOf('disabled') !== -1 && css.indexOf('.all-ways-pay-path') === -1);
}

/* ── 16. emit Markup: empty when disabled ────────────────────────── */
{
  const mk = emitAllWaysEvalMarkup(defaultConfig());
  t('16. Markup disabled → no #allWaysPayPath element',
    mk.indexOf('id="allWaysPayPath"') === -1);
  const mkOn = emitAllWaysEvalMarkup(resolveConfig({ allWaysEval: { enabled: true } }));
  t('16. Markup enabled → contains #allWaysPayPath',
    mkOn.indexOf('id="allWaysPayPath"') !== -1);
}

/* ── 17. emit Runtime: registers HookBus listeners ───────────────── */
{
  const rt = emitAllWaysEvalRuntime(resolveConfig({ allWaysEval: { enabled: true } }));
  t('17. Runtime subscribes onSpinResult', rt.indexOf("HookBus.on('onSpinResult'") !== -1);
  t('17. Runtime subscribes preSpin',      rt.indexOf("HookBus.on('preSpin'") !== -1);
  t('17. Runtime subscribes onFsEnd',      rt.indexOf("HookBus.on('onFsEnd'") !== -1);
  t('17. Runtime emits onAllWaysPay',      rt.indexOf("HookBus.emit('onAllWaysPay'") !== -1);
  t('17. Runtime emits onAllWaysCleared',  rt.indexOf("HookBus.emit('onAllWaysCleared'") !== -1);
}

/* ── 18. emit Runtime: empty when disabled ───────────────────────── */
{
  const rt = emitAllWaysEvalRuntime(defaultConfig());
  t('18. Runtime disabled → contains "(disabled)" sentinel',
    rt.indexOf('disabled') !== -1 && rt.indexOf('HookBus.on') === -1);
}

/* ── 19. emit Runtime: includes HW guard + priority 80 ───────────── */
{
  const rt = emitAllWaysEvalRuntime(resolveConfig({ allWaysEval: { enabled: true } }));
  t('19. Runtime references HW_STATE.active',  rt.indexOf('HW_STATE') !== -1);
  t('19. Runtime onSpinResult uses priority 80',
    /HookBus\.on\(\s*'onSpinResult'[\s\S]*?priority:\s*80/.test(rt));
  t('19. Runtime wired-once sentinel present',
    rt.indexOf('__ALL_WAYS_EVAL_WIRED__') !== -1);
  t('19. Runtime exposes window.evaluateAllWays',
    rt.indexOf('window.evaluateAllWays') !== -1);
  t('19. Runtime exposes window.ALL_WAYS_EVAL_STATE',
    rt.indexOf('window.ALL_WAYS_EVAL_STATE') !== -1);
}

/* ── 20. vendor-neutral grep: 0 hits ─────────────────────────────── */
{
  const fs = await import('node:fs');
  const blockSrc = fs.readFileSync(
    new URL('../../src/blocks/allWaysEval.mjs', import.meta.url), 'utf8');
  // Build the vendor pattern dynamically so the regex literal itself
  // does NOT match this test source file (would create a false positive).
  const VENDOR_TERMS = [
    'i' + 'gt', 'pragmat' + 'ic', 'cash[- ]erupt' + 'ion', 'wolf[- ]r' + 'un',
    'cleop' + 'atra', 'buff' + 'alo', 'megaw' + 'ays', 'l&' + 'w',
    'nete' + 'nt', 'microgam' + 'ing', 'scientific\\s*g' + 'ames',
    'aristoc' + 'rat', 'lightning\\s*l' + 'ink',
  ];
  const VENDOR_RE = new RegExp('(' + VENDOR_TERMS.join('|') + ')', 'i');
  t('20. block source vendor-neutral', !VENDOR_RE.test(blockSrc));
  // We don't grep the test source — the test file deliberately
  // CONSTRUCTS the vendor name fragments to assert the block is clean.
  // Asserting the test source itself is vendor-neutral is meaningless
  // since the literal pattern strings would always trip the regex.
  t('20. test source has no plain vendor literals',
    !/\bigt\b|\bnetent\b|\bmicrogaming\b|\baristocrat\b/i.test(
      // load WITHOUT the VENDOR_TERMS array literal region
      fs.readFileSync(new URL('./allWaysEval.test.mjs', import.meta.url), 'utf8')
        .replace(/VENDOR_TERMS[\s\S]+?\];/, '')
    ));
}

/* ── 21. emit Runtime: HookBus.emit uses single quotes (lego gate) ── */
{
  const rt = emitAllWaysEvalRuntime(resolveConfig({ allWaysEval: { enabled: true } }));
  t('21. HookBus.emit uses single-quoted event name',
    /HookBus\.emit\('onAllWaysPay'/.test(rt));
  t('21. no double-quoted HookBus.emit',
    !/HookBus\.emit\("/.test(rt));
}

/* ── 22. JSDoc 8-section header ──────────────────────────────────── */
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(
    new URL('../../src/blocks/allWaysEval.mjs', import.meta.url), 'utf8');
  const expected = [
    'Purpose',
    'Industry reference',
    'Public API',
    'Lifecycle',
    'Runtime contract',
    'GDD config keys',
    'Performance budget',
    'a11y',
  ];
  for (const sec of expected) {
    t('22. JSDoc has section: ' + sec, src.indexOf(sec) !== -1);
  }
}

console.log('');
console.log('Result: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
