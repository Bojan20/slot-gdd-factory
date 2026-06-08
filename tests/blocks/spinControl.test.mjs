/* eslint-disable no-console */
/**
 * Wave V3 — spinControl block tests.
 *
 * Coverage:
 *   • defaultConfig + resolveConfig validation
 *   • emitSpinControlCSS  (disabled = empty, enabled = state selectors,
 *     STOP_PRE pulse keyframe, reduced-motion gate)
 *   • emitSpinControlMarkup (3 stacked SVG icons, data-state=SPIN default,
 *     XSS escape on aria)
 *   • emitSpinControlRuntime (disabled stub, enabled wires listeners)
 *   • Block exports the V3 supersede contract:
 *       - emit* return empty/stub when enabled=false
 *       - default enabled=true so orchestrator gating works
 */

import {
  defaultConfig, resolveConfig,
  emitSpinControlCSS, emitSpinControlMarkup, emitSpinControlRuntime,
} from '../../src/blocks/spinControl.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const ok  = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/spinControl.mjs —');

t('defaultConfig: enabled=true (supersedes V1/V2 by default)', () => {
  const d = defaultConfig();
  eq(d.enabled, true);
  eq(d.requireMinSpinMs, 250);
  eq(d.minRollupMsForShow, 600);
  eq(d.hideOnTurbo, true);
  eq(d.hideOnAutoSpin, true);
  eq(d.reelsClickAreaEnabled, true);
  eq(d.stopColor, '255,80,80');
  eq(d.skipColor, '90,180,255');
});

t('resolveConfig: requireMinSpinMs clamped [0, 2000]', () => {
  eq(resolveConfig({ spinControl: { requireMinSpinMs: -100 } }).requireMinSpinMs, 0);
  eq(resolveConfig({ spinControl: { requireMinSpinMs: 99999 } }).requireMinSpinMs, 2000);
  eq(resolveConfig({ spinControl: { requireMinSpinMs: 350 } }).requireMinSpinMs, 350);
});

t('resolveConfig: minRollupMsForShow clamped [0, 5000]', () => {
  eq(resolveConfig({ spinControl: { minRollupMsForShow: -1 } }).minRollupMsForShow, 0);
  eq(resolveConfig({ spinControl: { minRollupMsForShow: 7000 } }).minRollupMsForShow, 5000);
});

t('resolveConfig: 6 boolean flags coerce', () => {
  const c = resolveConfig({ spinControl: {
    enabled: 0, hideOnTurbo: 1, hideOnAutoSpin: 'yes',
    reelsClickAreaEnabled: false,
    showDuringRollup: 0, showDuringCelebration: 1,
  }});
  eq(c.enabled, false);
  eq(c.hideOnTurbo, true);
  eq(c.hideOnAutoSpin, true);
  eq(c.reelsClickAreaEnabled, false);
  eq(c.showDuringRollup, false);
  eq(c.showDuringCelebration, true);
});

t('resolveConfig: aria label length cap (≤64)', () => {
  eq(resolveConfig({ spinControl: { spinAriaLabel: 'Custom' } }).spinAriaLabel, 'Custom');
  eq(resolveConfig({ spinControl: { spinAriaLabel: 'X'.repeat(65) } }).spinAriaLabel, 'Spin');
});

t('resolveConfig: RGB regex enforces shape on color fields', () => {
  const c = resolveConfig({ spinControl: { stopColor: '10, 20, 30', skipColor: '#abc' } });
  eq(c.stopColor, '10,20,30', 'spaces stripped');
  eq(c.skipColor, '90,180,255', 'hex rejected → default');
});

/* ── CSS ── */

t('emitSpinControlCSS: empty when disabled', () => {
  eq(emitSpinControlCSS({ ...defaultConfig(), enabled: false }), '');
});

t('emitSpinControlCSS: enabled bakes state-machine selectors', () => {
  const css = emitSpinControlCSS(defaultConfig());
  ct(css, '.spinBtn[data-state="SPIN"]');
  ct(css, '.spinBtn[data-state="STOP_PRE"]');
  ct(css, '.spinBtn[data-state="STOP_POST"]');
  ct(css, '.spinBtn[data-state^="SKIP_"]');
  ct(css, '@keyframes spinCtlStopPulse');
  ct(css, '@media (prefers-reduced-motion: reduce)');
});

t('emitSpinControlCSS: reels click area class baked when enabled', () => {
  const css = emitSpinControlCSS(defaultConfig());
  ct(css, '.reelsHost.spinctl-stop-armed');
  const noArea = emitSpinControlCSS({ ...defaultConfig(), reelsClickAreaEnabled: false });
  nct(noArea, 'spinctl-stop-armed');
});

t('emitSpinControlCSS: stopColor + skipColor interpolated', () => {
  const css = emitSpinControlCSS({ ...defaultConfig(), stopColor: '11,22,33', skipColor: '44,55,66' });
  ct(css, 'rgb(11,22,33)');
  ct(css, 'rgb(44,55,66)');
});

/* ── Markup ── */

t('emitSpinControlMarkup: empty when disabled', () => {
  eq(emitSpinControlMarkup({ ...defaultConfig(), enabled: false }), '');
});

t('emitSpinControlMarkup: data-state=SPIN default + 3 stacked icons', () => {
  const html = emitSpinControlMarkup(defaultConfig());
  ct(html, 'class="spinBtn"');
  ct(html, 'id="spinBtn"');
  ct(html, 'data-state="SPIN"');
  ct(html, 'spinIcon--spin');
  ct(html, 'spinIcon--stop');
  ct(html, 'spinIcon--skip');
  ct(html, 'aria-label="Spin"');
});

t('Wave V4: spinIcon--spin uses two-arrow refresh glyph (Boki requirement)', () => {
  /* Boki specified "dve strelice" for the spin icon. The implementation
     stacks 2 SVG <path> arcs (two opposing half-circles) + 2 <polyline>
     arrowheads inside `<svg class="spinIcon--spin">`. This test pins
     the count + ensures the icon stays a double-arrow glyph across
     refactors. */
  const html = emitSpinControlMarkup(defaultConfig());
  const m = html.match(/<svg class="spinIcon spinIcon--spin"[^>]*>([\s\S]*?)<\/svg>/);
  ok(m, 'spinIcon--spin SVG not found');
  const inner = m[1];
  const pathCount = (inner.match(/<path\b/g) || []).length;
  const polylineCount = (inner.match(/<polyline\b/g) || []).length;
  eq(pathCount, 2, 'spinIcon--spin must have 2 <path> arcs (two arrows)');
  eq(polylineCount, 2, 'spinIcon--spin must have 2 <polyline> arrowheads');
});

t('Wave V4: spinIcon--stop is solid square (single rect)', () => {
  const html = emitSpinControlMarkup(defaultConfig());
  const m = html.match(/<svg class="spinIcon spinIcon--stop"[^>]*>([\s\S]*?)<\/svg>/);
  ok(m, 'spinIcon--stop SVG not found');
  const rectCount = (m[1].match(/<rect\b/g) || []).length;
  eq(rectCount, 1, 'spinIcon--stop must be a single rect');
});

t('Wave V4: spinIcon--skip is forward double-triangle (two polygons)', () => {
  const html = emitSpinControlMarkup(defaultConfig());
  const m = html.match(/<svg class="spinIcon spinIcon--skip"[^>]*>([\s\S]*?)<\/svg>/);
  ok(m, 'spinIcon--skip SVG not found');
  const polyCount = (m[1].match(/<polygon\b/g) || []).length;
  eq(polyCount, 2, 'spinIcon--skip must be a double-triangle (2 polygons)');
});

t('emitSpinControlMarkup: XSS in aria escaped', () => {
  const html = emitSpinControlMarkup({ ...defaultConfig(), spinAriaLabel: 'a"><script>x' });
  ct(html, '&quot;');
  ct(html, '&lt;script&gt;');
  nct(html, '"><script>');
});

/* ── Runtime ── */

t('emitSpinControlRuntime: disabled emits minimal stub', () => {
  const src = emitSpinControlRuntime({ ...defaultConfig(), enabled: false });
  ct(src, 'window.SpinControl');
  ct(src, 'setState: function () {}');
  nct(src, "HookBus.on(");
});

t('emitSpinControlRuntime: enabled wires lifecycle listeners + spinBtn click', () => {
  const src = emitSpinControlRuntime(defaultConfig());
  ct(src, "HookBus.on('preSpin'");
  ct(src, "HookBus.on('onSpinResult'");
  ct(src, "HookBus.on('postSpin'");
  ct(src, "HookBus.on('onFsTrigger'");
  ct(src, "HookBus.on('onFsEnd'");
});

/* ── Hygiene ── */

t('determinism: same config → byte-identical CSS', () => {
  eq(emitSpinControlCSS(defaultConfig()), emitSpinControlCSS(defaultConfig()));
});

t('vendor-neutral: no vendor strings anywhere', () => {
  const all = emitSpinControlCSS(defaultConfig()) +
              emitSpinControlMarkup(defaultConfig()) +
              emitSpinControlRuntime(defaultConfig());
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath',
                        'sweet bonanza','pragmatic','microgaming','playa-slot']) {
    nct(all.toLowerCase(), banned, 'banned: ' + banned);
  }
});

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
