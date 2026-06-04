/* eslint-disable no-console */
/**
 * Wave T-slim — themeCSS block tests.
 *
 * Coverage:
 *   • defaultConfig palette + spacing tokens
 *   • resolveConfig accepts model.themeCSS.palette + falls back to legacy
 *     model.theme.palette array
 *   • emitThemeCSS bakes interpolated palette into :root tokens
 *   • emitThemeCSS bakes all responsive breakpoints
 *   • emitGridShapesCSS bakes every grid kind selector
 *   • emitDevToolsCSS bakes .dev-fs-btn + .grow-tag selectors
 *   • Vendor-neutral (no game/vendor strings)
 */

import {
  defaultConfig, resolveConfig,
  emitThemeCSS, emitGridShapesCSS, emitDevToolsCSS,
} from '../../src/blocks/themeCSS.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/themeCSS.mjs —');

t('defaultConfig: industry-baseline palette + spacing tokens', () => {
  const d = defaultConfig();
  eq(d.palette.bg0,    '#05070c');
  eq(d.palette.bg1,    '#0b0f16');
  eq(d.palette.accent, '#c9a227');
  eq(d.palette.text,   '#f2f2f2');
  eq(d.cellGap, 6);
  eq(d.cellRadius, 10);
  eq(d.frameRadius, 16);
  eq(d.frameInset, 18);
});

t('resolveConfig: model.themeCSS.palette overrides default', () => {
  const c = resolveConfig({ themeCSS: { palette: { bg0: '#111111', accent: '#ff8800' } } });
  eq(c.palette.bg0,    '#111111');
  eq(c.palette.accent, '#ff8800');
  /* Untouched keys fall back to defaults. */
  eq(c.palette.bg1,    '#0b0f16');
  eq(c.palette.text,   '#f2f2f2');
});

t('resolveConfig: legacy model.theme.palette array still wins', () => {
  const c = resolveConfig({ theme: { palette: ['#222222', '#333333', '#dddddd'] } });
  eq(c.palette.bg0,    '#222222');
  eq(c.palette.bg1,    '#333333');
  eq(c.palette.accent, '#dddddd');
});

t('resolveConfig: malformed palette entries are rejected', () => {
  const c = resolveConfig({ themeCSS: { palette: { bg0: 'red', accent: 12345 } } });
  /* Defaults preserved. */
  eq(c.palette.bg0,    '#05070c');
  eq(c.palette.accent, '#c9a227');
});

t('resolveConfig: spacing tokens clamped [0, 64]', () => {
  eq(resolveConfig({ themeCSS: { cellGap: -10 } }).cellGap, 0);
  eq(resolveConfig({ themeCSS: { cellGap: 999 } }).cellGap, 64);
  eq(resolveConfig({ themeCSS: { cellGap: 4 } }).cellGap, 4);
});

t('emitThemeCSS: bakes resolved palette into :root tokens', () => {
  const css = emitThemeCSS({ ...defaultConfig(),
    palette: { bg0: '#abcdef', bg1: '#fedcba', accent: '#123456', text: '#000000' } });
  ct(css, '--bg0: #abcdef');
  ct(css, '--bg1: #fedcba');
  ct(css, '--accent: #123456');
  ct(css, '--text: #000000');
});

t('emitThemeCSS: full responsive breakpoint set', () => {
  const css = emitThemeCSS(defaultConfig());
  ct(css, '@media (max-width: 1100px)');
  ct(css, '@media (max-width: 920px)');
  ct(css, '@media (max-width: 820px)');
  ct(css, '@media (max-width: 620px)');
});

t('emitThemeCSS: contains all chrome selectors', () => {
  const css = emitThemeCSS(defaultConfig());
  for (const sel of ['.stage', '.header', '.title', '.sub', '.play', '.frame', '.sideHud',
                     '.spinBtn', '.autoBtn', '.hub', '.iconBtn', '.statBox', '.betGroup',
                     '.betStep', '.gridHost', '.spinBtn.is-spinning']) {
    ct(css, sel, `missing selector ${sel}`);
  }
});

t('emitGridShapesCSS: bakes every grid kind selector', () => {
  const css = emitGridShapesCSS();
  for (const sel of ['.grid-rect','.grid-vrl','.col','.grid-hex','.grid-wheel',
                     '.grid-plinko','.plinko-row','.peg','.grid-crash','.crash-curve',
                     '.grid-slingo','.cell','.cell.lockable','.cell.hex','.wheel-svg']) {
    ct(css, sel, `missing selector ${sel}`);
  }
});

t('emitDevToolsCSS: bakes dev FS button + grow tag', () => {
  const css = emitDevToolsCSS();
  ct(css, '.dev-fs-btn');
  ct(css, '.dev-fs-btn:hover');
  ct(css, '.dev-fs-btn:active');
  ct(css, '.dev-fs-btn:disabled');
  ct(css, '.grow-tag');
});

t('determinism: identical config → byte-identical CSS', () => {
  eq(emitThemeCSS(defaultConfig()), emitThemeCSS(defaultConfig()));
  eq(emitGridShapesCSS(), emitGridShapesCSS());
  eq(emitDevToolsCSS(), emitDevToolsCSS());
});

t('vendor-neutral: no vendor/game strings in any emit', () => {
  const all = emitThemeCSS(defaultConfig()) + emitGridShapesCSS() + emitDevToolsCSS();
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath','sweet bonanza',
                        'pragmatic','microgaming','btg','wazdan']) {
    nct(all.toLowerCase(), banned, 'banned: ' + banned);
  }
});

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
