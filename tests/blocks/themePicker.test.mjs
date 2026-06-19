/**
 * tests/blocks/themePicker.test.mjs · LEGO-THEME (B-8 · 1/3)
 */
import {
  defaultConfig, resolveConfig,
  emitThemePickerCSS, emitThemePickerMarkup, emitThemePickerRuntime,
} from '../../src/blocks/themePicker.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== themePicker (LEGO-THEME B-8 · 1/3) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label THEME', d.label === 'THEME');
t('default 3 themes', d.themes.length === 3);
t('default theme 0 dark', d.themes[0].id === 'dark');
t('default theme 2 contrast', d.themes[2].id === 'contrast');
t('default index 0', d.defaultThemeIndex === 0);
t('default storageKey slot.theme', d.storageKey === 'slot.theme');

const r1 = resolveConfig({ features: [{ kind: 'theme_picker' }] });
t('auto-enable theme_picker', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'skin_picker' }] });
t('auto-enable skin_picker alias', r1b.enabled === true);

const r2 = resolveConfig({
  themePicker: { enabled: true, label: 'SKIN', storageKey: 'my.theme', defaultThemeIndex: 1 },
});
t('explicit enable honored', r2.enabled === true);
t('override label', r2.label === 'SKIN');
t('override storageKey', r2.storageKey === 'my.theme');
t('override defaultThemeIndex', r2.defaultThemeIndex === 1);

const rDeg = resolveConfig({ themePicker: { enabled: true, themes: [{ id: 'only' }] } });
t('single-theme collapses', rDeg.enabled === false);
t('collapsedToSingleTheme flag', rDeg.collapsedToSingleTheme === true);

const rThemes = resolveConfig({
  themePicker: { enabled: true, themes: [
    { id: 'a', label: 'A', swatch: '#abc' },
    { id: 'a', label: 'A2', swatch: '#def' },
    { id: 'b', label: 'B', swatch: '#fff' },
  ]},
});
t('dedupes duplicate theme ids', rThemes.themes.length === 2);

const css = emitThemePickerCSS(r1);
t('CSS empty when disabled', emitThemePickerCSS(defaultConfig()) === '');
t('CSS has button class', css.includes('.theme-picker-btn'));
t('CSS has menu class', css.includes('.theme-picker-menu'));
t('CSS has tp-item class', css.includes('.tp-item'));
t('CSS has tp-swatch class', css.includes('.tp-swatch'));
t('CSS has focus-visible', css.includes('focus-visible'));
t('CSS has mobile media', css.includes('@media (max-width: 620px)'));
t('CSS has reduced-motion media', css.includes('prefers-reduced-motion'));

const markup = emitThemePickerMarkup(r1);
t('markup empty when disabled', emitThemePickerMarkup(defaultConfig()) === '');
t('markup has trigger button', markup.includes('id="themePickerBtn"'));
t('markup has menu', markup.includes('id="themePickerMenu"'));
t('markup has aria-haspopup=menu', markup.includes('aria-haspopup="menu"'));
t('markup has role=menu', markup.includes('role="menu"'));
t('markup has role=menuitemradio per item', (markup.match(/role="menuitemradio"/g) || []).length === 3);
t('markup has aria-checked=true on default', (markup.match(/aria-checked="true"/g) || []).length === 1);

const rt = emitThemePickerRuntime(r1);
t('runtime stub disabled', emitThemePickerRuntime(defaultConfig()).includes('disabled'));
t('runtime declares TP_STORAGE_KEY', rt.includes('TP_STORAGE_KEY'));
t('runtime sets data-theme attribute', rt.includes("setAttribute('data-theme'"));
t('runtime uses localStorage', rt.includes('localStorage.setItem') && rt.includes('localStorage.getItem'));
t('runtime emits onThemeChanged', rt.includes('onThemeChanged'));
t('runtime emits onThemePickerOpened', rt.includes('onThemePickerOpened'));
t('runtime emits onThemePickerClosed', rt.includes('onThemePickerClosed'));
t('runtime keyboard ArrowUp/Down', rt.includes('ArrowDown') && rt.includes('ArrowUp'));
t('runtime keyboard Home/End', rt.includes("'Home'") && rt.includes("'End'"));
t('runtime keyboard Escape', rt.includes("e.key === 'Escape'"));
t('runtime defensive on storage failure', rt.includes('try {') && rt.includes('catch (_)'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
