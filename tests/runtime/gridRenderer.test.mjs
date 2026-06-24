/* eslint-disable no-console */
/**
 * Wave T-slim Phase 2 — gridRenderer runtime tests.
 *
 * Coverage:
 *   • resolveGridRendererConfig — defaults, defensive on missing palette,
 *     defensive on hostile palette[2] (XSS / injection), accept hex / rgb
 *   • emitGridHelpersRuntime — emits symAt / makeCell / cellSize /
 *     UNIFORM_REEL_KINDS unconditionally + all 11 uniform kinds present
 *   • emitGridDispatchRuntime — emits all 9 render fns + dispatcher +
 *     resize listener + accent injected into renderWheel + renderCrash
 *     SVG stroke / fill, dispatcher covers every supported kind, accent
 *     fallback honored on malformed palette
 *   • Vendor neutrality — 0 vendor mentions in emitted source
 */

import {
  resolveGridRendererConfig,
  emitGridHelpersRuntime,
  emitGridDispatchRuntime,
} from '../../src/runtime/gridRenderer.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— runtime/gridRenderer.mjs —');

/* ── resolveGridRendererConfig ── */

t('resolveGridRendererConfig: default accent fallback', () => {
  const c = resolveGridRendererConfig({});
  eq(c.accent, '#c9a227');
});

t('resolveGridRendererConfig: null model → default', () => {
  eq(resolveGridRendererConfig(null).accent, '#c9a227');
  eq(resolveGridRendererConfig(undefined).accent, '#c9a227');
});

t('resolveGridRendererConfig: theme without palette → default', () => {
  eq(resolveGridRendererConfig({ theme: {} }).accent, '#c9a227');
  eq(resolveGridRendererConfig({ theme: { palette: null } }).accent, '#c9a227');
});

t('resolveGridRendererConfig: short palette → default', () => {
  eq(resolveGridRendererConfig({ theme: { palette: ['#a', '#b'] } }).accent, '#c9a227');
});

t('resolveGridRendererConfig: accepts hex accent at palette[2]', () => {
  const c = resolveGridRendererConfig({ theme: { palette: ['#000', '#111', '#fa5'] } });
  eq(c.accent, '#fa5');
});

t('resolveGridRendererConfig: accepts rgb() accent', () => {
  const c = resolveGridRendererConfig({ theme: { palette: ['#0', '#0', 'rgb(255, 200, 50)'] } });
  eq(c.accent, 'rgb(255, 200, 50)');
});

t('resolveGridRendererConfig: rejects hostile XSS attempt → default', () => {
  const evil = '"><script>alert(1)</script>';
  const c = resolveGridRendererConfig({ theme: { palette: ['#0', '#0', evil] } });
  eq(c.accent, '#c9a227', 'must reject < and " to keep SVG attr safe');
});

t('resolveGridRendererConfig: trims whitespace, rejects empty after trim', () => {
  eq(resolveGridRendererConfig({ theme: { palette: ['', '', '   '] } }).accent, '#c9a227');
  eq(resolveGridRendererConfig({ theme: { palette: ['', '', '  #abc  '] } }).accent, '#abc');
});

t('resolveGridRendererConfig: non-string palette[2] → default', () => {
  eq(resolveGridRendererConfig({ theme: { palette: ['', '', 123] } }).accent, '#c9a227');
  eq(resolveGridRendererConfig({ theme: { palette: ['', '', null] } }).accent, '#c9a227');
});

/* ── emitGridHelpersRuntime ── */

t('emitGridHelpersRuntime: emits symAt / makeCell / cellSize', () => {
  const s = emitGridHelpersRuntime({});
  ct(s, 'function symAt(');
  ct(s, 'function makeCell(');
  ct(s, 'function cellSize(');
});

t('emitGridHelpersRuntime: emits UNIFORM_REEL_KINDS with all 11 kinds', () => {
  const s = emitGridHelpersRuntime({});
  ct(s, 'const UNIFORM_REEL_KINDS = new Set([');
  const kinds = [
    'rectangular', 'cluster', 'megaclusters', 'lock_respin', 'expanding',
    'infinity', 'variable_reel', 'diamond', 'pyramid', 'cross', 'l_shape',
  ];
  for (const k of kinds) ct(s, `'${k}'`, `missing kind ${k}`);
});

t('emitGridHelpersRuntime: model arg is optional', () => {
  const a = emitGridHelpersRuntime();
  const b = emitGridHelpersRuntime({});
  eq(a, b, 'omitting model must equal passing {}');
});

t('emitGridHelpersRuntime: cellSize uses defensive gap default', () => {
  const s = emitGridHelpersRuntime({});
  ct(s, 'if (gap === undefined) gap = 6;');
});

/* ── emitGridDispatchRuntime ── */

t('emitGridDispatchRuntime: emits every render function', () => {
  const s = emitGridDispatchRuntime({});
  ct(s, 'function renderRect(');
  ct(s, 'function renderVariableReel(');
  ct(s, 'function renderMaskedRect(');
  ct(s, 'function renderHex(');
  ct(s, 'function renderWheel(');
  ct(s, 'function renderPlinko(');
  ct(s, 'function renderCrash(');
  ct(s, 'function renderSlingo(');
  ct(s, 'function renderDual(');
  ct(s, 'function renderGrid(');
  ct(s, 'function fit(');
});

t('emitGridDispatchRuntime: dispatcher handles every kind', () => {
  const s = emitGridDispatchRuntime({});
  for (const k of ['rectangular','cluster','lock_respin','megaclusters',
                   'infinity','expanding','variable_reel','diamond',
                   'pyramid','cross','l_shape','hexagonal','radial',
                   'wheel','plinko','crash','slingo','dual']) {
    ct(s, `case "${k}":`, `dispatcher missing case "${k}"`);
  }
  ct(s, 'default:');
});

t('emitGridDispatchRuntime: emits resize listener + raf bootstrap', () => {
  const s = emitGridDispatchRuntime({});
  ct(s, 'window.addEventListener("resize", fit)');
  ct(s, 'requestAnimationFrame(fit)');
});

t('emitGridDispatchRuntime: injects accent into renderWheel SVG', () => {
  const s = emitGridDispatchRuntime({ theme: { palette: ['#0', '#0', '#fa5'] } });
  /* accent appears in renderWheel stroke + fill SVG attribute calls */
  ct(s, '"stroke", "#fa5"');
  ct(s, '"fill", "#fa5"');
});

t('emitGridDispatchRuntime: injects accent into renderCrash SVG', () => {
  const s = emitGridDispatchRuntime({ theme: { palette: ['#0', '#0', '#bada55'] } });
  ct(s, '"stroke", "#bada55"');
});

t('emitGridDispatchRuntime: fallback accent on malformed palette', () => {
  const s = emitGridDispatchRuntime({ theme: { palette: ['', '', '"><script>'] } });
  ct(s, '"stroke", "#c9a227"');
  nct(s, '<script>');
});

t('emitGridDispatchRuntime: cross/l_shape masked-cell pass present', () => {
  const s = emitGridDispatchRuntime({});
  ct(s, "SHAPE.kind === 'cross' || SHAPE.kind === 'l_shape'");
  ct(s, "cell.classList.add('cell--masked')");
});

t('emitGridDispatchRuntime: expanding/infinity grow-tag emit', () => {
  const s = emitGridDispatchRuntime({});
  ct(s, 'SHAPE.kind === "infinity" ? "∞ horizontal" : "expand vertical"');
});

/* ── Vendor neutrality (HARD RULE) ── */

t('vendor neutrality: no game / vendor names in either emit', () => {
  const blob = emitGridHelpersRuntime({}) + emitGridDispatchRuntime({});
  for (const v of ['industry standard','Pragmatic','Cleopatra','Buffalo','Megaways','NetEnt',
                   'Microgaming','Zeus','Olympus','Reactoonz','Bonanza',
                   'WoO','GoO','Cash Eruption','Wolf Run','playa-slot']) {
    nct(blob, v, `vendor mention "${v}" leaked into runtime emit`);
  }
});

/* ── Summary ── */

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail) process.exit(1);
