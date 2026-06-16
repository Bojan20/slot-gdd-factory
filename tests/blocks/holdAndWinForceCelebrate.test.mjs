/* eslint-disable no-console */
/**
 * tests/blocks/holdAndWinForceCelebrate.test.mjs
 *
 * W48 bugfix v4 — verifies:
 *
 *   1. hwMaybeEnter() guards re-entry via HW_STATE.entering during the
 *      bonus-celebration window (a parallel postSpin or UFP fallback
 *      timer cannot mount the placard mid-celebration).
 *   2. hwForceSeed() now goes through the SAME celebration path that
 *      hwMaybeEnter does — it stamps the bonus glyph onto the picked
 *      cells, plays playHwBonusCelebration, and only then mounts the
 *      intro via _hwForceSeedMount.
 *   3. winPresentation's preSpin listener calls clearWinHighlight to
 *      strip the .is-win class so stale wins don't render on top of
 *      the new spin's rotating strip.
 */
import {
  defaultConfig,
  emitHoldAndWinRuntime,
} from '../../src/blocks/holdAndWin.mjs';
import { emitWinPresentationRuntime } from '../../src/blocks/winPresentation.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };

console.log('— W48 bugfix v4 · celebrate path coverage + win highlight strip —');

/* ─── H&W: entering flag + hwForceSeed celebration ──────────────────── */

const hw = emitHoldAndWinRuntime({ ...defaultConfig(), enabled: true });

t('HW_STATE exposes new `entering` flag', () => {
  ct(hw, 'entering: false');
});

t('hwMaybeEnter sets HW_STATE.entering before celebration', () => {
  ct(hw, 'HW_STATE.entering = true');
  ct(hw, 'playHwBonusCelebration().then');
  ct(hw, 'HW_STATE.entering = false');
});

t('hwMaybeEnter guards re-entry via entering flag', () => {
  ct(hw, 'if (HW_STATE.entering) return false');
});

t('hwForceSeed routes through celebration before mount (NEW path)', () => {
  ct(hw, 'function hwForceSeed');
  ct(hw, '_hwForceSeedMount');
  /* The pre-celebration stamp: bonus glyph applied to picked cells. */
  ct(hw, 'cell.textContent = HW_BONUS_SYMBOL');
});

t('_hwForceSeedMount is split out as the deferred mount helper', () => {
  ct(hw, 'function _hwForceSeedMount');
});

t('hwForceSeed sets the same entering guard as the natural path', () => {
  /* Both code blocks must set HW_STATE.entering = true before async work. */
  const occurrences = hw.match(/HW_STATE\.entering = true/g) || [];
  ok(occurrences.length >= 2, `expected ≥ 2 entering-guard sets, got ${occurrences.length}`);
});

t('hwForceSeed celebration path resolves to _hwForceSeedMount', () => {
  /* The .then chain in hwForceSeed should call _hwForceSeedMount. */
  const m = hw.match(/function hwForceSeed[\s\S]*?return true;\s*\n\s*\}/);
  ok(m, 'hwForceSeed body not extractable');
  ct(m[0], 'playHwBonusCelebration().then');
  /* W48 v6 — signature changed from (picked, allCells) to (pickedKeys). */
  ct(m[0], '_hwForceSeedMount(pickedKeys)');
});

t('hwForceSeed early-returns if entering already in flight', () => {
  const m = hw.match(/function hwForceSeed[\s\S]*?return true;\s*\n\s*\}/);
  ct(m[0], 'if (HW_STATE.entering) return false');
});

/* ─── winPresentation: clearWinHighlight on preSpin ─────────────────── */

const wp = emitWinPresentationRuntime({
  mode: 'per-line', perEventMs: 'auto', maxEvents: 8, noWinChance: 0.30, winCycle: true,
});

t('winPresentation preSpin listener calls clearWinHighlight', () => {
  /* The clearWinHighlight call must be inside the preSpin listener body. */
  const preSpinSection = wp.match(/HookBus\.on\('preSpin'[\s\S]*?\}, \{ priority: -10 \}\)/);
  ok(preSpinSection, 'preSpin listener with priority:-10 not found');
  ct(preSpinSection[0], 'clearWinHighlight()');
});

t('winPresentation preSpin still strips .is-winsym-cycling + .cell--winsym', () => {
  /* Defense in depth — the original strips must remain in place. */
  const preSpinSection = wp.match(/HookBus\.on\('preSpin'[\s\S]*?\}, \{ priority: -10 \}\)/);
  ct(preSpinSection[0], "remove('is-winsym-cycling')");
  ct(preSpinSection[0], "remove('cell--winsym')");
});

t('winPresentation preSpin guarded against undefined clearWinHighlight', () => {
  const preSpinSection = wp.match(/HookBus\.on\('preSpin'[\s\S]*?\}, \{ priority: -10 \}\)/);
  ct(preSpinSection[0], "typeof clearWinHighlight === 'function'");
});

/* ─── sandbox: re-entry guard via entering flag ─────────────────────── */

t('SANDBOX: entering flag blocks a re-entrant hwMaybeEnter call', async () => {
  /* Build a minimal reproduction of the entering-guard race. */
  const HW_STATE = { active: false, entering: false };
  let beginRoundCount = 0;
  let celebrationResolve = null;
  function playCeleb() {
    return new Promise(resolve => { celebrationResolve = resolve; });
  }
  function hwMaybeEnter() {
    if (HW_STATE.active) return false;
    if (HW_STATE.entering) return false;
    HW_STATE.entering = true;
    playCeleb().then(function () {
      HW_STATE.entering = false;
      beginRoundCount++;
      HW_STATE.active = true;
    });
    return true;
  }
  /* First call: starts celebration. */
  const first = hwMaybeEnter();
  ok(first === true, 'first call should accept');
  /* Mid-celebration second call: must be blocked. */
  const second = hwMaybeEnter();
  ok(second === false, 'second call should be blocked while entering');
  /* Finish the celebration. */
  celebrationResolve();
  await Promise.resolve();   /* allow .then to flush */
  await Promise.resolve();
  /* beginRound counted exactly ONCE. */
  if (beginRoundCount !== 1) throw new Error(`expected 1 mount, got ${beginRoundCount}`);
  /* HW_STATE.active flipped + HW_STATE.entering cleared. */
  if (HW_STATE.entering !== false) throw new Error('entering not cleared after fire');
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);
setTimeout(() => { if (fail) process.exit(1); }, 50);
