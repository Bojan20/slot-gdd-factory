/* eslint-disable no-console */
/**
 * Wave U13 — settingsPanel block tests.
 *
 * Coverage:
 *   • defaultConfig + SETTINGS_KEYS export
 *   • resolveConfig validation (chipLabel cap, RGB regex, 10 booleans,
 *     availableLocales BCP-47 filter + length cap, auto-disable)
 *   • emitSettingsPanelCSS (disabled = empty, enabled = backdrop +
 *     toggle styles + actions + mobile media + reduced-motion gate)
 *   • emitSettingsPanelMarkup (XSS escape, role=dialog, hidden,
 *     per-row toggles gated by config flags, locale select gated)
 *   • emitSettingsPanelRuntime (stub when disabled, listeners + window API)
 *   • Sandbox:
 *       - init reads persisted prefs from localStorage
 *       - settingsSet writes globals + LS + paints UI
 *       - settingsReset restores defaults
 *       - settingsGet returns current pref
 *       - turbo toggle delegates to window.turboModeOn/Off
 *       - sound toggle delegates to window.audioSetMuted
 *       - external onTurboToggle mirrors UI row
 *       - panel show/hide/toggle + auto-hide on preSpin/FsTrigger/Autoplay
 *       - Escape closes
 */

import {
  defaultConfig, resolveConfig, SETTINGS_KEYS,
  emitSettingsPanelCSS, emitSettingsPanelMarkup, emitSettingsPanelRuntime,
} from '../../src/blocks/settingsPanel.mjs';
import { emitHookBusRuntime } from '../../src/blocks/hookBus.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const ok  = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/settingsPanel.mjs —');

/* ── defaults + resolveConfig ── */

t('defaultConfig: industry-baseline + 5 toggle rows visible by default', () => {
  const d = defaultConfig();
  eq(d.enabled, true);
  eq(d.chipLabel, '⚙');
  eq(d.showTurboToggle, true);
  eq(d.showSoundToggle, true);
  eq(d.showReducedMotionToggle, true);
  eq(d.showQuickSpinToggle, true);
  eq(d.showAutoHideWinToggle, true);
  eq(d.showLanguageSelector, false, 'locale hidden by default');
  eq(d.persistInLocalStorage, true);
});

t('SETTINGS_KEYS enum is frozen + canonical', () => {
  eq(Object.isFrozen(SETTINGS_KEYS), true);
  /* Wave K7 — three extension keys appended after the original six. */
  eq(SETTINGS_KEYS.join(','),
    'turbo,soundMuted,reducedMotion,quickSpin,autoHideWin,locale,volatility,betStepPreset,maxWinCapEnabled');
});

t('resolveConfig: 10 boolean flags coerce', () => {
  const c = resolveConfig({ settingsPanel: {
    showTurboToggle: 0, showSoundToggle: 1,
    showReducedMotionToggle: 'no', showQuickSpinToggle: null,
    showAutoHideWinToggle: false, showLanguageSelector: true,
    persistInLocalStorage: false, closeOnBackdrop: 'yes',
    closeOnEscape: 1, autoHideOnSpin: undefined,
  }});
  eq(c.showTurboToggle, false);
  eq(c.showSoundToggle, true);
  eq(c.showReducedMotionToggle, true, 'truthy string → true');
  eq(c.showQuickSpinToggle, true, 'null → no-op → default');
  eq(c.showAutoHideWinToggle, false);
  eq(c.showLanguageSelector, true);
  eq(c.persistInLocalStorage, false);
  eq(c.closeOnBackdrop, true);
  eq(c.closeOnEscape, true);
  eq(c.autoHideOnSpin, true, 'undefined → default');
});

t('resolveConfig: availableLocales BCP-47 filter + cap 20', () => {
  const c = resolveConfig({ settingsPanel: {
    availableLocales: ['en-US', 'sr-Latn', 'BAD', 'de-DE', 'invalid_format', 'fr-FR'],
  }});
  eq(c.availableLocales.length, 4, 'BAD and invalid_format dropped');
  ok(c.availableLocales.includes('en-US'));
  ok(c.availableLocales.includes('sr-Latn'));
});

t('resolveConfig: chipLabel length cap (≤4)', () => {
  eq(resolveConfig({ settingsPanel: { chipLabel: '⚙' } }).chipLabel, '⚙');
  eq(resolveConfig({ settingsPanel: { chipLabel: 'OPTS' } }).chipLabel, 'OPTS');
  eq(resolveConfig({ settingsPanel: { chipLabel: 'TOOLONG' } }).chipLabel, '⚙');
});

t('resolveConfig: RGB regex on 4 color fields', () => {
  const c = resolveConfig({ settingsPanel: {
    chipColor: '10,20,30', modalBgColor: 'red',
    modalAccentColor: '40, 50, 60', chipTextColor: '#abc',
  }});
  eq(c.chipColor, '10,20,30');
  eq(c.modalAccentColor, '40,50,60');
  eq(c.modalBgColor, '10,12,18', 'named rejected');
  eq(c.chipTextColor, '255,230,168', 'hex rejected');
});

t('resolveConfig: auto-disable from feature kind', () => {
  for (const k of ['no_settings', 'no-settings', 'settings_disabled', 'SETTINGS-DISABLED']) {
    eq(resolveConfig({ features: [{ kind: k }] }).enabled, false, k);
  }
});

/* ── CSS ── */

t('emitSettingsPanelCSS: empty when disabled', () => {
  eq(emitSettingsPanelCSS({ ...defaultConfig(), enabled: false }), '');
});

t('emitSettingsPanelCSS: enabled bakes button + backdrop + toggle + actions', () => {
  const css = emitSettingsPanelCSS(defaultConfig());
  for (const sel of ['.settings-btn', '.settings-backdrop', '.settings-modal',
                     '.settings-row', '.settings-toggle', '.settings-toggle.is-on',
                     '.settings-action', '.settings-action--reset',
                     '@keyframes settings-fade-in',
                     '@media (prefers-reduced-motion: reduce)',
                     '@media (max-width: 480px)']) {
    ct(css, sel);
  }
});

/* ── Markup ── */

t('emitSettingsPanelMarkup: empty when disabled', () => {
  eq(emitSettingsPanelMarkup({ ...defaultConfig(), enabled: false }), '');
});

t('emitSettingsPanelMarkup: dialog + 5 default rows (no duplicate button — reuses hub hamburger)', () => {
  const html = emitSettingsPanelMarkup(defaultConfig());
  /* Boki rule (04.06.2026): settings reuses the existing hub hamburger
   * #settingsMenuBtn. The block emits ONLY the modal. */
  nct(html, 'id="settingsBtn"');
  nct(html, 'class="settings-btn"');
  ct(html, 'id="settingsBackdrop"');
  ct(html, 'role="dialog"');
  ct(html, 'aria-modal="true"');
  ct(html, 'id="settingsTurboToggle"');
  ct(html, 'id="settingsSoundToggle"');
  ct(html, 'id="settingsReducedMotionToggle"');
  ct(html, 'id="settingsQuickSpinToggle"');
  ct(html, 'id="settingsAutoHideWinToggle"');
  nct(html, 'id="settingsLocaleSelect"', 'locale hidden by default');
});

t('emitSettingsPanelMarkup: per-row gating via show* flags', () => {
  const html = emitSettingsPanelMarkup({
    ...defaultConfig(),
    showTurboToggle: false, showSoundToggle: false,
    showReducedMotionToggle: false, showQuickSpinToggle: false,
    showAutoHideWinToggle: false, showLanguageSelector: true,
  });
  nct(html, 'settingsTurboToggle');
  nct(html, 'settingsSoundToggle');
  ct(html, 'id="settingsLocaleSelect"');
});

t('emitSettingsPanelMarkup: locale select options from availableLocales', () => {
  const html = emitSettingsPanelMarkup({
    ...defaultConfig(),
    showLanguageSelector: true,
    availableLocales: ['en-US', 'sr-Latn'],
  });
  ct(html, '<option value="en-US">en-US</option>');
  ct(html, '<option value="sr-Latn">sr-Latn</option>');
});

t('emitSettingsPanelMarkup: no user-supplied unsafe text in panel HTML', () => {
  /* chipLabel + ariaLabel are no longer rendered into markup — the
   * existing hub hamburger carries its own aria attribute. Sanity
   * check the panel body is XSS-safe even when those inputs are
   * malicious. */
  const html = emitSettingsPanelMarkup({
    ...defaultConfig(),
    chipLabel: '<x>',
    ariaLabel: 'a"><script>x',
  });
  nct(html, '<script>');
  nct(html, 'onerror=');
});

/* ── Runtime stub vs enabled ── */

t('emitSettingsPanelRuntime: disabled emits stub', () => {
  const src = emitSettingsPanelRuntime({ ...defaultConfig(), enabled: false });
  ct(src, 'window.settingsPanelShow   = function () {}');
  ct(src, 'window.settingsGet         = function () { return undefined; }');
  ct(src, 'window.settingsReset       = function () {}');
  nct(src, "HookBus.on(");
});

t('emitSettingsPanelRuntime: enabled wires 4 listeners + window API', () => {
  const src = emitSettingsPanelRuntime(defaultConfig());
  ct(src, "HookBus.on('onTurboToggle'");
  ct(src, "HookBus.on('preSpin'");
  ct(src, "HookBus.on('onFsTrigger'");
  ct(src, "HookBus.on('onAutoplayStart'");
  ct(src, 'window.settingsGet');
});

/* ── Sandbox ── */

function buildSandbox(cfg = defaultConfig(), opts = {}) {
  const hbSrc = emitHookBusRuntime({ debugLog: false });
  const spSrc = emitSettingsPanelRuntime(cfg);

  const elements = new Map();
  function makeElement(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id, hidden: id === 'settingsBackdrop',
      className: '', value: '',
      _classes: new Set(), _attrs: {}, _listeners: new Map(),
      classList: {
        add(c){ el._classes.add(c); }, remove(c){ el._classes.delete(c); },
        toggle(c, on){ if (on) el._classes.add(c); else el._classes.delete(c); },
        contains(c){ return el._classes.has(c); },
      },
      setAttribute(k, v){ el._attrs[k] = v; },
      getAttribute(k){ return el._attrs[k]; },
      addEventListener(name, fn){
        if (!el._listeners.has(name)) el._listeners.set(name, []);
        el._listeners.get(name).push(fn);
      },
      removeEventListener(){},
      focus(){ el._focused = true; },
      click(){ for (const fn of (el._listeners.get('click') || [])) fn({ target: el }); },
      _fire(name, ev){ for (const fn of (el._listeners.get(name) || [])) fn(ev || { target: el }); },
    };
    elements.set(id, el);
    return el;
  }
  /* settingsMenuBtn is the orchestrator-rendered hub hamburger that
   * settingsPanel binds to (Boki rule: no duplicate floating button). */
  for (const id of ['settingsMenuBtn','settingsBackdrop','settingsCloseBtn','settingsResetBtn',
                    'settingsTurboToggle','settingsSoundToggle','settingsReducedMotionToggle',
                    'settingsQuickSpinToggle','settingsAutoHideWinToggle','settingsLocaleSelect']) {
    makeElement(id);
  }

  const docListeners = new Map();
  const fakeDocument = {
    readyState: 'complete',
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(name, fn) {
      if (!docListeners.has(name)) docListeners.set(name, []);
      docListeners.get(name).push(fn);
    },
    _fireDoc(name, ev) { for (const fn of (docListeners.get(name) || [])) fn(ev); },
  };

  const _ls = opts.localStoragePrefill || new Map();
  const fakeLs = opts.brokenLocalStorage ? null : {
    getItem(k) { return _ls.has(k) ? _ls.get(k) : null; },
    setItem(k, v) { _ls.set(k, String(v)); },
    removeItem(k) { _ls.delete(k); },
  };

  const fakeWindow = Object.assign({}, opts.window || {}, { localStorage: fakeLs });
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };

  /* eslint-disable-next-line no-new-func */
  const factory = new Function(
    'window', 'document', 'console',
    hbSrc + '\n' + spSrc + '\nreturn { HookBus: window.HookBus };'
  );
  factory(fakeWindow, fakeDocument, fakeConsole);

  return { window: fakeWindow, document: fakeDocument, elements, docListeners, ls: _ls, HookBus: fakeWindow.HookBus };
}

t('sandbox: init paints defaults + sets global flags', () => {
  const sb = buildSandbox(defaultConfig());
  eq(sb.window.__SLOT_REDUCED_MOTION__, false);
  eq(sb.window.__SLOT_QUICK_SPIN__, false);
  eq(sb.window.__SLOT_AUTO_HIDE_WIN__, true);
  eq(sb.window.__SLOT_LOCALE__, 'en-US');
  /* Sound toggle UI = ON when soundMuted=false. */
  ok(sb.elements.get('settingsSoundToggle')._classes.has('is-on'));
  ok(sb.elements.get('settingsAutoHideWinToggle')._classes.has('is-on'));
  ok(!sb.elements.get('settingsTurboToggle')._classes.has('is-on'));
});

t('sandbox: init reads persisted prefs from localStorage', () => {
  const prefill = new Map([
    ['slot.settings.turbo', 'true'],
    ['slot.settings.quickSpin', '1'],
    ['slot.settings.locale', 'sr-Latn'],
  ]);
  const sb = buildSandbox(defaultConfig(), { localStoragePrefill: prefill });
  eq(sb.window.settingsGet('turbo'), true);
  eq(sb.window.settingsGet('quickSpin'), true);
  eq(sb.window.settingsGet('locale'), 'sr-Latn');
  eq(sb.window.__SLOT_QUICK_SPIN__, true);
});

t('sandbox: settingsSet writes global + localStorage + paints toggle', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsSet('reducedMotion', true);
  eq(sb.window.__SLOT_REDUCED_MOTION__, true);
  eq(sb.ls.get('slot.settings.reducedMotion'), 'true');
  ok(sb.elements.get('settingsReducedMotionToggle')._classes.has('is-on'));
});

t('sandbox: settingsSet rejects unknown key', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsSet('not_a_real_key', true);
  /* No-op. */
  eq(sb.ls.has('slot.settings.not_a_real_key'), false);
});

t('sandbox: settingsSet locale validates against availableLocales', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsSet('locale', 'sr-Latn');
  eq(sb.window.__SLOT_LOCALE__, 'sr-Latn');
  sb.window.settingsSet('locale', 'klingon-XX');
  eq(sb.window.__SLOT_LOCALE__, 'en-US', 'invalid locale falls back to default');
});

t('sandbox: settingsSet idempotent (same value = no rewrite)', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsSet('quickSpin', true);
  const stamp1 = sb.ls.get('slot.settings.quickSpin');
  sb.window.settingsSet('quickSpin', true);
  const stamp2 = sb.ls.get('slot.settings.quickSpin');
  eq(stamp1, stamp2);
});

t('sandbox: settingsReset restores defaults', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsSet('quickSpin', true);
  sb.window.settingsSet('reducedMotion', true);
  sb.window.settingsReset();
  eq(sb.window.settingsGet('quickSpin'), false);
  eq(sb.window.settingsGet('reducedMotion'), false);
  eq(sb.window.__SLOT_QUICK_SPIN__, false);
});

t('sandbox: turbo toggle delegates to window.turboModeOn/Off', () => {
  const sb = buildSandbox(defaultConfig());
  const calls = [];
  /* settingsSet('turbo', ...) guards on `typeof window.turboModeToggle ===
   * 'function'` before calling turboModeOn/Off — need all 3 mocked. */
  sb.window.turboModeToggle   = () => {};
  sb.window.turboModeOn       = (src) => calls.push(['on', src]);
  sb.window.turboModeOff      = (src) => calls.push(['off', src]);
  sb.window.turboModeIsActive = () => false;
  sb.window.settingsSet('turbo', true);
  eq(calls.length, 1);
  eq(calls[0][0], 'on');
  sb.window.turboModeIsActive = () => true;
  sb.window.settingsSet('turbo', false);
  eq(calls.length, 2);
  eq(calls[1][0], 'off');
});

t('sandbox: sound toggle delegates to window.audioSetMuted', () => {
  const sb = buildSandbox(defaultConfig());
  const calls = [];
  sb.window.audioSetMuted = (v) => calls.push(v);
  sb.window.settingsSet('soundMuted', true);
  eq(calls[0], true);
  sb.window.settingsSet('soundMuted', false);
  eq(calls[1], false);
});

t('sandbox: external onTurboToggle mirrors to settings UI', () => {
  const sb = buildSandbox(defaultConfig());
  eq(sb.window.settingsGet('turbo'), false);
  sb.HookBus.emit('onTurboToggle', { active: true, source: 'button' });
  eq(sb.window.settingsGet('turbo'), true);
  ok(sb.elements.get('settingsTurboToggle')._classes.has('is-on'));
});

t('sandbox: settingsPanelShow opens + Hide closes + Toggle flips', () => {
  const sb = buildSandbox(defaultConfig());
  eq(sb.elements.get('settingsBackdrop').hidden, true);
  sb.window.settingsPanelShow();
  eq(sb.elements.get('settingsBackdrop').hidden, false);
  sb.window.settingsPanelHide();
  eq(sb.elements.get('settingsBackdrop').hidden, true);
  sb.window.settingsPanelToggle();
  eq(sb.window.SETTINGS_PANEL_STATE.open, true);
});

t('sandbox: clicking hub hamburger toggles modal', () => {
  const sb = buildSandbox(defaultConfig());
  sb.elements.get('settingsMenuBtn').click();
  eq(sb.window.SETTINGS_PANEL_STATE.open, true);
});

t('sandbox: clicking close button hides', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsPanelShow();
  sb.elements.get('settingsCloseBtn').click();
  eq(sb.window.SETTINGS_PANEL_STATE.open, false);
});

t('sandbox: clicking reset button restores defaults', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsSet('quickSpin', true);
  sb.elements.get('settingsResetBtn').click();
  eq(sb.window.settingsGet('quickSpin'), false);
});

t('sandbox: Escape key closes panel (closeOnEscape=true default)', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsPanelShow();
  sb.document._fireDoc('keydown', { key: 'Escape' });
  eq(sb.window.SETTINGS_PANEL_STATE.open, false);
});

t('sandbox: backdrop click closes; inner click does NOT', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsPanelShow();
  const bd = sb.elements.get('settingsBackdrop');
  bd._fire('click', { target: { fake: 'inner' } });
  eq(sb.window.SETTINGS_PANEL_STATE.open, true);
  bd._fire('click', { target: bd });
  eq(sb.window.SETTINGS_PANEL_STATE.open, false);
});

t('sandbox: preSpin auto-hides when autoHideOnSpin=true', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsPanelShow();
  sb.HookBus.emit('preSpin', { duringFs: false });
  eq(sb.window.SETTINGS_PANEL_STATE.open, false);
});

t('sandbox: preSpin does NOT hide when autoHideOnSpin=false', () => {
  const sb = buildSandbox({ ...defaultConfig(), autoHideOnSpin: false });
  sb.window.settingsPanelShow();
  sb.HookBus.emit('preSpin', { duringFs: false });
  eq(sb.window.SETTINGS_PANEL_STATE.open, true);
});

t('sandbox: onFsTrigger + onAutoplayStart always hide', () => {
  const sb = buildSandbox({ ...defaultConfig(), autoHideOnSpin: false });
  sb.window.settingsPanelShow();
  sb.HookBus.emit('onFsTrigger', {});
  eq(sb.window.SETTINGS_PANEL_STATE.open, false);
  sb.window.settingsPanelShow();
  sb.HookBus.emit('onAutoplayStart', { remaining: 25, step: 25 });
  eq(sb.window.SETTINGS_PANEL_STATE.open, false);
});

t('sandbox: clicking individual toggle row flips that pref', () => {
  const sb = buildSandbox(defaultConfig());
  sb.elements.get('settingsQuickSpinToggle').click();
  eq(sb.window.settingsGet('quickSpin'), true);
  sb.elements.get('settingsQuickSpinToggle').click();
  eq(sb.window.settingsGet('quickSpin'), false);
});

t('sandbox: broken localStorage does not throw', () => {
  const sb = buildSandbox(defaultConfig(), { brokenLocalStorage: true });
  sb.window.settingsSet('quickSpin', true);
  sb.window.settingsSet('quickSpin', false);
  eq(true, true);
});

t('sandbox: close button receives focus after show', () => {
  const sb = buildSandbox(defaultConfig());
  sb.window.settingsPanelShow();
  eq(sb.elements.get('settingsCloseBtn')._focused, true);
});

/* ── Hygiene ── */

t('determinism: same config → byte-identical CSS', () => {
  eq(emitSettingsPanelCSS(defaultConfig()), emitSettingsPanelCSS(defaultConfig()));
});

t('vendor-neutral: no vendor strings anywhere', () => {
  const all = emitSettingsPanelCSS(defaultConfig()) +
              emitSettingsPanelMarkup(defaultConfig()) +
              emitSettingsPanelRuntime(defaultConfig());
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath',
                        'sweet bonanza','pragmatic','microgaming','playa-slot']) {
    nct(all.toLowerCase(), banned, 'banned: ' + banned);
  }
});

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
