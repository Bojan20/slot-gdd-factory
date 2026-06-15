/* eslint-disable no-console */
/**
 * anticipationUniversal block unit tests.
 *
 * Coverage:
 *   • defaultConfig stability + isolation
 *   • resolveConfig: pulseMs / tickMs bounds, enabled toggle, RGB
 *     validation, badge + skipDuringFs flags
 *   • CSS emit: disabled = empty, enabled = host pulse + cell glow rules
 *   • Runtime emit: disabled stub, enabled IIFE with HookBus listener
 *   • LEGO discipline: registers at least one HookBus.on listener
 *   • Vendor-neutral: no game / vendor names in emitted artefacts
 *   • Accessibility: prefers-reduced-motion rule present
 */
import {
  defaultConfig,
  resolveConfig,
  emitAnticipationUniversalCSS,
  emitAnticipationUniversalRuntime,
} from '../../src/blocks/anticipationUniversal.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok  = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/anticipationUniversal.mjs —');

t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  eq(c.enabled, true);
  eq(c.pulseMs, 700);
  eq(c.gold, '255,214,110');
  eq(c.tickMs, 140);
  eq(c.showBadge, true);
  eq(c.skipDuringFs, false);
});

t('defaultConfig: returns isolated copy', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  ok(a !== b);
  a.enabled = false;
  eq(b.enabled, true);
});

t('resolveConfig: empty model → defaults', () => {
  const c = resolveConfig({});
  eq(c.enabled, true);
  eq(c.pulseMs, 700);
});

t('resolveConfig: enabled=false honored', () => {
  eq(resolveConfig({ anticipationUniversal: { enabled: false } }).enabled, false);
});

t('resolveConfig: pulseMs bounded [200,5000]', () => {
  eq(resolveConfig({ anticipationUniversal: { pulseMs: 1200 } }).pulseMs, 1200);
  eq(resolveConfig({ anticipationUniversal: { pulseMs: 100 } }).pulseMs, 700);
  eq(resolveConfig({ anticipationUniversal: { pulseMs: 9999 } }).pulseMs, 700);
});

t('resolveConfig: tickMs bounded [60,1000]', () => {
  eq(resolveConfig({ anticipationUniversal: { tickMs: 200 } }).tickMs, 200);
  eq(resolveConfig({ anticipationUniversal: { tickMs: 30 } }).tickMs, 140);
  eq(resolveConfig({ anticipationUniversal: { tickMs: 5000 } }).tickMs, 140);
});

t('resolveConfig: gold RGB validation', () => {
  eq(resolveConfig({ anticipationUniversal: { gold: '20,30,40' } }).gold, '20,30,40');
  eq(resolveConfig({ anticipationUniversal: { gold: 'gold' } }).gold, '255,214,110');
  eq(resolveConfig({ anticipationUniversal: { gold: '999,1,2' } }).gold, '255,214,110');
});

t('resolveConfig: model.anticipation as fallback source', () => {
  eq(resolveConfig({ anticipation: { enabled: false } }).enabled, false);
});

t('resolveConfig: showBadge / skipDuringFs flags', () => {
  eq(resolveConfig({ anticipationUniversal: { showBadge: false } }).showBadge, false);
  eq(resolveConfig({ anticipationUniversal: { skipDuringFs: true } }).skipDuringFs, true);
});

t('emitAnticipationUniversalCSS: disabled → empty', () => {
  eq(emitAnticipationUniversalCSS({ enabled: false }), '');
});

t('emitAnticipationUniversalCSS: enabled → keyframes + host + cell', () => {
  const out = emitAnticipationUniversalCSS({ enabled: true });
  ct(out, '@keyframes ant-uni-cell-pulse');
  ct(out, '@keyframes ant-uni-host-pulse');
  ct(out, '.cell--anticipating-cell');
  ct(out, '.gridHost--ant-pulse');
  ct(out, 'prefers-reduced-motion');
});

t('emitAnticipationUniversalCSS: showBadge=false skips badge rules', () => {
  const off = emitAnticipationUniversalCSS({ enabled: true, showBadge: false });
  nct(off, '.ant-badge {');
  const on  = emitAnticipationUniversalCSS({ enabled: true, showBadge: true });
  ct(on, '.ant-badge');
});

t('emitAnticipationUniversalRuntime: disabled → stub', () => {
  const out = emitAnticipationUniversalRuntime({ enabled: false });
  ct(out, 'disabled');
  nct(out, 'HookBus.on');
});

t('emitAnticipationUniversalRuntime: enabled wires HookBus listener', () => {
  const out = emitAnticipationUniversalRuntime({ enabled: true });
  ct(out, 'HookBus.on');
});

t('vendor-neutral: no studio / game names in emitted artefacts', () => {
  const out = emitAnticipationUniversalCSS({ enabled: true })
            + emitAnticipationUniversalRuntime({ enabled: true });
  const lower = out.toLowerCase();
  for (const bad of [
    'gates of olympus', 'wrath of olympus', 'reactoonz', 'sweet bonanza',
    'sugar rush', 'megaways', 'netent', 'microgaming', 'pragmatic',
    'lightning link', 'cleopatra', 'buffalo', 'cash eruption',
  ]) {
    nct(lower, bad, `vendor mention: ${bad}`);
  }
});

/* ── W47.S9 (B76) — mathematically-alive gate ──────────────────────────
 * The fix lives inside the emitted runtime template literal — we cannot
 * directly invoke the inner _tick() from the host suite, so the test
 * asserts that the runtime SOURCE carries the gate's structural anchors
 * (queries, maxAchievable expression, dead-branch removal of
 * cell--anticipating-cell, warm short-circuit). */

t('B76: runtime carries .reelCol querySelectorAll for the math-alive gate', () => {
  const rt = emitAnticipationUniversalRuntime(resolveConfig({ anticipationUniversal: { enabled: true } }));
  ct(rt, '.reelCol', 'must read reel columns to compute remaining-reel count');
  ct(rt, "querySelectorAll('.reelCol')", 'must enumerate columns');
});

t('B76: runtime computes maxAchievable + mathAlive', () => {
  const rt = emitAnticipationUniversalRuntime(resolveConfig({ anticipationUniversal: { enabled: true } }));
  ct(rt, 'maxAchievable', 'gate identifier present');
  ct(rt, 'mathAlive', 'mathAlive identifier present');
  ct(rt, 'scattersSoFar + Math.max(0, reelColCount - reelsWithTrigger)',
     'maxAchievable formula intact (one trigger per remaining reel cap)');
});

t('B76: dead branch strips every cell--anticipating-cell halo', () => {
  const rt = emitAnticipationUniversalRuntime(resolveConfig({ anticipationUniversal: { enabled: true } }));
  ct(rt, "querySelectorAll('.cell.cell--anticipating-cell')",
     'dead branch enumerates halos');
  ct(rt, "classList.remove('cell--anticipating-cell')",
     'dead branch removes class');
});

t('B76: warm short-circuit gated by mathAlive', () => {
  const rt = emitAnticipationUniversalRuntime(resolveConfig({ anticipationUniversal: { enabled: true } }));
  ct(rt, 'var warm = mathAlive', 'warm starts from mathAlive boolean');
});

t('B76: non-rect grids keep legacy behaviour (gate never fires)', () => {
  const rt = emitAnticipationUniversalRuntime(resolveConfig({ anticipationUniversal: { enabled: true } }));
  /* When reelColCount is 0 the gate falls back to scattersSoFar +
   * threshold so mathAlive stays true and the legacy code path runs
   * for wheel / plinko / radial shapes that own their suspense
   * through engine pulses. */
  ct(rt, '(reelColCount > 0)', 'fallback branch present');
  ct(rt, '(scattersSoFar + ladder.threshold)', 'legacy fallback formula');
});

console.log(`\n  ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
