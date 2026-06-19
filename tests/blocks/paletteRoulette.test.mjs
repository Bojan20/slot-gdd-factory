/**
 * tests/blocks/paletteRoulette.test.mjs · LEGO-THEME (B-8 · 2/3)
 */
import {
  defaultConfig, resolveConfig,
  emitPaletteRouletteCSS, emitPaletteRouletteMarkup, emitPaletteRouletteRuntime,
} from '../../src/blocks/paletteRoulette.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== paletteRoulette (LEGO-THEME B-8 · 2/3) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default 5 palettes', d.palettes.length === 5);
t('default first palette gold', d.palettes[0].id === 'gold');
t('default persist true', d.persist === true);

const r1 = resolveConfig({ features: [{ kind: 'palette_roulette' }] });
t('auto-enable palette_roulette', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'session_palette' }] });
t('auto-enable session_palette alias', r1b.enabled === true);

const r2 = resolveConfig({ paletteRoulette: { enabled: true, persist: false } });
t('explicit enable honored', r2.enabled === true);
t('override persist', r2.persist === false);

const rDeg = resolveConfig({
  paletteRoulette: { enabled: true, palettes: [{ id: 'only' }] },
});
t('single-palette collapses', rDeg.enabled === false);
t('collapsedToSinglePalette flag', rDeg.collapsedToSinglePalette === true);

const rPal = resolveConfig({
  paletteRoulette: { enabled: true, palettes: [
    { id: 'a', accent: '#abc', accentDark: '#000', accentRGB: '170,187,204', weight: 50 },
    { id: 'a', accent: '#def', accentDark: '#000', accentRGB: '221,238,255', weight: 50 },
    { id: 'b', accent: '#fff', accentDark: '#000', accentRGB: '255,255,255', weight: 25 },
  ]},
});
t('dedupes duplicate palette ids', rPal.palettes.length === 2);

const css = emitPaletteRouletteCSS(r1);
t('CSS empty when disabled', emitPaletteRouletteCSS(defaultConfig()) === '');
t('CSS has button class', css.includes('.palette-roulette-btn'));
t('CSS has data-rolling state', css.includes('data-rolling'));
t('CSS has focus-visible', css.includes('focus-visible'));
t('CSS has reduced-motion', css.includes('prefers-reduced-motion'));

const markup = emitPaletteRouletteMarkup(r1);
t('markup empty when disabled', emitPaletteRouletteMarkup(defaultConfig()) === '');
t('markup has button id', markup.includes('id="paletteRouletteBtn"'));
t('markup has aria-label', markup.includes('aria-label='));

const rt = emitPaletteRouletteRuntime(r1);
t('runtime stub disabled', emitPaletteRouletteRuntime(defaultConfig()).includes('disabled'));
t('runtime declares PR_PALETTES', rt.includes('PR_PALETTES'));
t('runtime declares PR_PERSIST', rt.includes('PR_PERSIST'));
t('runtime has applyPalette function', rt.includes('function applyPalette'));
t('runtime has rollWeighted function', rt.includes('function rollWeighted'));
t('runtime sets CSS custom prop --pal-accent', rt.includes("'--pal-accent'"));
t('runtime sets CSS custom prop --pal-accent-rgb', rt.includes("'--pal-accent-rgb'"));
t('runtime sets data-palette on root', rt.includes("setAttribute('data-palette'"));
t('runtime emits onPaletteRolled', rt.includes('onPaletteRolled'));
t('runtime listens onThemeChanged', rt.includes("HookBus.on('onThemeChanged'"));
t('runtime defensive localStorage try/catch', rt.includes('try {') && rt.includes('catch (_)'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
