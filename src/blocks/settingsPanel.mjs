/**
 * src/blocks/settingsPanel.mjs
 *
 * Wave U13 — Settings Panel (gear-icon modal).
 *
 * Industry-standard pattern (every certified slot ships one): a gear /
 * cog button on the hub opens a modal sa konsolidovanim user-toggle
 * setting-zima. Replaces scattered ad-hoc toggles with a single audit-
 * friendly pane. Regulator-mandated for MGA / UKGC / NJ (per-session
 * preferences must be exposed + persisted).
 *
 * Toggles wired in this block (each one composes with an existing
 * Wave block; the panel is a discoverable single-source-of-truth UI):
 *
 *   • Turbo Mode               → turboModeToggle() (Wave U11)
 *   • Sound (master)           → window.audioSetMuted (Wave U2, deactivated)
 *   • Reduced Animations       → window.__SLOT_REDUCED_MOTION__ (new flag)
 *   • Quick Spin (instant settle) → window.__SLOT_QUICK_SPIN__ (new flag)
 *   • Auto-Hide Win Plaque     → window.__SLOT_AUTO_HIDE_WIN__ (new flag)
 *   • Language                 → window.__SLOT_LOCALE__ (BCP-47 string)
 *
 * Each toggle persists in localStorage under `slot.settings.<key>` so
 * preferences survive reload. Backed by a single owns-everything API:
 *   settingsGet(key) / settingsSet(key, value) / settingsReset()
 *
 * The block does NOT compute math — it's a centralised preferences
 * widget that READS state from other blocks (turboMode, audio) and
 * WRITES global flags consumed by future cadence-aware listeners.
 *
 * Lifecycle (HookBus contract):
 *   onTurboToggle (U11) → mirror state to settings UI (so external
 *                         toggle via U11 button updates the panel row)
 *   preSpin              → auto-hide panel (if autoHideOnSpin)
 *   onFsTrigger          → auto-hide (FS owns screen)
 *   onAutoplayStart      → auto-hide
 *
 * The block does NOT emit any new HookBus events — preferences flow
 * through window globals + direct API calls to other blocks.
 *
 * Bake-time config:
 *   { enabled, chipLabel, chipColor, chipTextColor,
 *     modalBgColor, modalAccentColor,
 *     showTurboToggle, showSoundToggle, showReducedMotionToggle,
 *     showQuickSpinToggle, showAutoHideWinToggle, showLanguageSelector,
 *     availableLocales,
 *     persistInLocalStorage,
 *     closeOnBackdrop, closeOnEscape, autoHideOnSpin,
 *     ariaLabel }
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitSettingsPanelCSS(cfg)
 *   emitSettingsPanelMarkup(cfg)
 *   emitSettingsPanelRuntime(cfg)
 *
 * Runtime contract:
 *   settingsPanelShow / settingsPanelHide / settingsPanelToggle
 *   settingsGet(key) / settingsSet(key, value) / settingsReset
 *   SETTINGS_PANEL_STATE on window
 */

export const SETTINGS_KEYS = Object.freeze([
  'turbo',
  'soundMuted',
  'reducedMotion',
  'quickSpin',
  'autoHideWin',
  'locale',
]);

export function defaultConfig() {
  return {
    enabled: true,
    chipLabel: '⚙',
    chipColor:     '201,162,39',
    chipTextColor: '255,230,168',
    modalBgColor:    '10,12,18',
    modalAccentColor: '201,162,39',
    showTurboToggle:        true,
    showSoundToggle:        true,
    showReducedMotionToggle: true,
    showQuickSpinToggle:    true,
    showAutoHideWinToggle:  true,
    showLanguageSelector:   false,
    /* Industry-baseline language set — narrowed per game by GDD. */
    availableLocales: ['en-US', 'sr-Latn', 'de-DE', 'es-ES', 'fr-FR'],
    persistInLocalStorage: true,
    closeOnBackdrop: true,
    closeOnEscape:   true,
    autoHideOnSpin:  true,
    ariaLabel: 'Open settings',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.settingsPanel) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  if (typeof m.chipLabel === 'string' && m.chipLabel.length > 0 && m.chipLabel.length <= 4) {
    cfg.chipLabel = m.chipLabel;
  }
  for (const key of ['chipColor', 'chipTextColor', 'modalBgColor', 'modalAccentColor']) {
    if (typeof m[key] === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(m[key])) {
      cfg[key] = m[key].replace(/\s+/g, '');
    }
  }
  for (const flag of ['showTurboToggle', 'showSoundToggle', 'showReducedMotionToggle',
                       'showQuickSpinToggle', 'showAutoHideWinToggle', 'showLanguageSelector',
                       'persistInLocalStorage', 'closeOnBackdrop', 'closeOnEscape',
                       'autoHideOnSpin']) {
    if (m[flag] != null) cfg[flag] = !!m[flag];
  }

  if (Array.isArray(m.availableLocales) && m.availableLocales.length > 0) {
    /* Defensive: keep only valid BCP-47-ish strings (lang-Region). */
    const cleaned = m.availableLocales
      .filter(x => typeof x === 'string' && /^[a-z]{2,3}(-[A-Z][a-zA-Z]{1,7})?$/.test(x));
    if (cleaned.length > 0) cfg.availableLocales = cleaned.slice(0, 20);
  }

  if (typeof m.ariaLabel === 'string' && m.ariaLabel.length > 0 && m.ariaLabel.length <= 64) {
    cfg.ariaLabel = m.ariaLabel;
  }

  if (model.features && Array.isArray(model.features)) {
    const explicitlyOff = model.features.some(
      (f) => f && typeof f.kind === 'string' && /^(no[_-]?settings|settings[_-]?disabled)$/i.test(f.kind),
    );
    if (explicitlyOff) cfg.enabled = false;
  }

  return cfg;
}

function _escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emitSettingsPanelCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ settingsPanel: cfg });
  return `
  /* ── settingsPanel BLOCK — emitted by src/blocks/settingsPanel.mjs ─── */
  .settings-btn {
    width: 36px; height: 36px;
    border-radius: 50%;
    border: 2px solid rgba(${c.chipColor}, 0.7);
    background: linear-gradient(180deg, rgba(${c.chipColor}, 0.18), rgba(${c.chipColor}, 0.06));
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 800;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 2px 6px rgba(0, 0, 0, 0.45);
    transition: transform 280ms ease-out, opacity 140ms ease-out;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .settings-btn:hover  { transform: rotate(45deg); opacity: 0.95; }
  .settings-btn:active { transform: scale(0.94); }
  @media (prefers-reduced-motion: reduce) {
    .settings-btn { transition: none; }
    .settings-btn:hover { transform: none; }
  }

  .settings-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: settings-fade-in 180ms ease-out;
  }
  .settings-backdrop[hidden] { display: none !important; }
  @keyframes settings-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .settings-modal {
    background: linear-gradient(180deg, rgba(${c.modalBgColor}, 0.98), rgba(${c.modalBgColor}, 1));
    border: 2px solid rgba(${c.modalAccentColor}, 0.85);
    border-radius: 16px;
    box-shadow:
      0 20px 60px rgba(0, 0, 0, 0.7),
      0 0 32px rgba(${c.modalAccentColor}, 0.25);
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    max-width: 480px;
    width: 100%;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    padding: 22px 26px;
  }
  .settings-modal h2 {
    font-size: 16px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: rgb(${c.modalAccentColor});
    margin-bottom: 18px;
    text-align: center;
    font-weight: 800;
  }

  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid rgba(${c.modalAccentColor}, 0.15);
  }
  .settings-row:last-of-type { border-bottom: none; }
  .settings-row__label {
    font-size: 13px;
    letter-spacing: 0.5px;
    flex: 1 1 auto;
  }
  .settings-row__hint {
    display: block;
    font-size: 10px;
    letter-spacing: 1px;
    opacity: 0.55;
    text-transform: uppercase;
    margin-top: 2px;
  }

  /* iOS-style switch toggle. */
  .settings-toggle {
    position: relative;
    width: 44px; height: 24px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(${c.modalAccentColor}, 0.3);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 180ms ease-out;
  }
  .settings-toggle::after {
    content: '';
    position: absolute;
    top: 2px; left: 2px;
    width: 18px; height: 18px;
    border-radius: 50%;
    background: rgb(${c.chipTextColor});
    transition: transform 180ms ease-out;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
  }
  .settings-toggle.is-on {
    background: rgba(${c.modalAccentColor}, 0.85);
    border-color: rgba(${c.modalAccentColor}, 1);
  }
  .settings-toggle.is-on::after {
    transform: translateX(20px);
  }

  .settings-locale-select {
    background: rgba(${c.modalAccentColor}, 0.12);
    border: 1px solid rgba(${c.modalAccentColor}, 0.4);
    color: rgb(${c.chipTextColor});
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }

  .settings-actions {
    display: flex;
    gap: 10px;
    margin-top: 18px;
  }
  .settings-action {
    flex: 1 1 auto;
    padding: 10px 0;
    border-radius: 10px;
    border: 2px solid rgba(${c.modalAccentColor}, 0.8);
    background: rgba(${c.modalAccentColor}, 0.18);
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 800;
    font-size: 13px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .settings-action--reset {
    background: rgba(255, 100, 100, 0.18);
    border-color: rgba(255, 100, 100, 0.8);
  }
  .settings-action:hover { background: rgba(${c.modalAccentColor}, 0.32); }
  .settings-action--reset:hover { background: rgba(255, 100, 100, 0.3); }

  @media (max-width: 480px) {
    .settings-modal { padding: 16px 14px; max-height: calc(100vh - 16px); }
    .settings-row__label { font-size: 12px; }
  }
`;
}

export function emitSettingsPanelMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ settingsPanel: cfg });
  const safeAria  = _escape(c.ariaLabel);
  const safeLabel = _escape(c.chipLabel);

  /* Build rows in deterministic order — config gates each individually. */
  const rows = [];
  if (c.showTurboToggle) rows.push(`
        <div class="settings-row" data-setting="turbo">
          <div>
            <div class="settings-row__label">Turbo Mode</div>
            <div class="settings-row__hint">Faster spin cadence</div>
          </div>
          <button id="settingsTurboToggle" class="settings-toggle" type="button" aria-label="Turbo toggle" aria-pressed="false"></button>
        </div>`);
  if (c.showSoundToggle) rows.push(`
        <div class="settings-row" data-setting="soundMuted">
          <div>
            <div class="settings-row__label">Sound</div>
            <div class="settings-row__hint">Master audio mute</div>
          </div>
          <button id="settingsSoundToggle" class="settings-toggle" type="button" aria-label="Sound toggle" aria-pressed="false"></button>
        </div>`);
  if (c.showReducedMotionToggle) rows.push(`
        <div class="settings-row" data-setting="reducedMotion">
          <div>
            <div class="settings-row__label">Reduced Animations</div>
            <div class="settings-row__hint">Honor prefers-reduced-motion</div>
          </div>
          <button id="settingsReducedMotionToggle" class="settings-toggle" type="button" aria-label="Reduced motion toggle" aria-pressed="false"></button>
        </div>`);
  if (c.showQuickSpinToggle) rows.push(`
        <div class="settings-row" data-setting="quickSpin">
          <div>
            <div class="settings-row__label">Quick Spin</div>
            <div class="settings-row__hint">Instant settle on click</div>
          </div>
          <button id="settingsQuickSpinToggle" class="settings-toggle" type="button" aria-label="Quick spin toggle" aria-pressed="false"></button>
        </div>`);
  if (c.showAutoHideWinToggle) rows.push(`
        <div class="settings-row" data-setting="autoHideWin">
          <div>
            <div class="settings-row__label">Auto-Hide Win Plaque</div>
            <div class="settings-row__hint">Dismiss banner on next spin</div>
          </div>
          <button id="settingsAutoHideWinToggle" class="settings-toggle" type="button" aria-label="Auto-hide win toggle" aria-pressed="false"></button>
        </div>`);
  if (c.showLanguageSelector) {
    const options = c.availableLocales.map(l => `<option value="${_escape(l)}">${_escape(l)}</option>`).join('');
    rows.push(`
        <div class="settings-row" data-setting="locale">
          <div>
            <div class="settings-row__label">Language</div>
            <div class="settings-row__hint">UI locale</div>
          </div>
          <select id="settingsLocaleSelect" class="settings-locale-select" aria-label="Locale selector">${options}</select>
        </div>`);
  }

  return `
  <button id="settingsBtn" class="settings-btn" type="button" aria-label="${safeAria}">${safeLabel}</button>
  <div id="settingsBackdrop" class="settings-backdrop" hidden role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
    <div id="settingsModal" class="settings-modal" role="document">
      <h2 id="settingsTitle">Settings</h2>
      <div id="settingsRows">${rows.join('')}</div>
      <div class="settings-actions">
        <button id="settingsResetBtn" class="settings-action settings-action--reset" type="button">Reset</button>
        <button id="settingsCloseBtn" class="settings-action" type="button">Close</button>
      </div>
    </div>
  </div>`;
}

export function emitSettingsPanelRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── settingsPanel BLOCK (disabled) — stub ───────────────────────── */
  window.settingsPanelShow   = function () {};
  window.settingsPanelHide   = function () {};
  window.settingsPanelToggle = function () {};
  window.settingsGet         = function () { return undefined; };
  window.settingsSet         = function () {};
  window.settingsReset       = function () {};
  window.SETTINGS_PANEL_STATE = { enabled: false, open: false, prefs: {} };
`;
  }

  const c = resolveConfig({ settingsPanel: cfg });
  return `
  /* ── settingsPanel BLOCK — emitted by src/blocks/settingsPanel.mjs ───
     Owns: window.__SLOT_REDUCED_MOTION__, __SLOT_QUICK_SPIN__,
           __SLOT_AUTO_HIDE_WIN__, __SLOT_LOCALE__ + the preferences
           localStorage namespace 'slot.settings.*'.
     Subscribes:
       onTurboToggle  → mirror UI row state (external U11 button)
       preSpin        → auto-hide panel (if autoHideOnSpin)
       onFsTrigger    → auto-hide
       onAutoplayStart → auto-hide
     Emits: nothing — pure preferences UI. */
  (function () {
    var SHOW_TURBO   = ${c.showTurboToggle};
    var SHOW_SOUND   = ${c.showSoundToggle};
    var SHOW_RM      = ${c.showReducedMotionToggle};
    var SHOW_QS      = ${c.showQuickSpinToggle};
    var SHOW_AHW     = ${c.showAutoHideWinToggle};
    var SHOW_LOCALE  = ${c.showLanguageSelector};
    var PERSIST      = ${c.persistInLocalStorage};
    var CLOSE_BACK   = ${c.closeOnBackdrop};
    var CLOSE_ESC    = ${c.closeOnEscape};
    var AUTO_HIDE    = ${c.autoHideOnSpin};
    var LOCALES      = ${JSON.stringify(c.availableLocales)};
    var LS_PREFIX    = 'slot.settings.';

    var DEFAULTS = {
      turbo:         false,
      soundMuted:    false,
      reducedMotion: false,
      quickSpin:     false,
      autoHideWin:   true,
      locale:        LOCALES[0] || 'en-US',
    };

    var STATE = {
      enabled: true,
      open: false,
      prefs: Object.assign({}, DEFAULTS),
    };
    if (typeof window !== 'undefined') window.SETTINGS_PANEL_STATE = STATE;

    function _btn()       { return document.getElementById('settingsBtn'); }
    function _backdrop()  { return document.getElementById('settingsBackdrop'); }
    function _closeBtn()  { return document.getElementById('settingsCloseBtn'); }
    function _resetBtn()  { return document.getElementById('settingsResetBtn'); }
    function _toggle(name){ return document.getElementById('settings' + name + 'Toggle'); }
    function _locale()    { return document.getElementById('settingsLocaleSelect'); }

    function _readLs(key) {
      if (!PERSIST) return null;
      try {
        var raw = window.localStorage && window.localStorage.getItem(LS_PREFIX + key);
        return raw;
      } catch (_) { return null; }
    }
    function _writeLs(key, val) {
      if (!PERSIST) return;
      try {
        if (window.localStorage) window.localStorage.setItem(LS_PREFIX + key, String(val));
      } catch (_) { /* defensive */ }
    }

    function _applyGlobals() {
      if (typeof window === 'undefined') return;
      window.__SLOT_REDUCED_MOTION__ = !!STATE.prefs.reducedMotion;
      window.__SLOT_QUICK_SPIN__     = !!STATE.prefs.quickSpin;
      window.__SLOT_AUTO_HIDE_WIN__  = !!STATE.prefs.autoHideWin;
      window.__SLOT_LOCALE__         = String(STATE.prefs.locale);
    }

    function _paintToggle(name, on) {
      var el = _toggle(name);
      if (!el) return;
      el.classList.toggle('is-on', !!on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    function _paintAll() {
      if (SHOW_TURBO) _paintToggle('Turbo',         STATE.prefs.turbo);
      if (SHOW_SOUND) _paintToggle('Sound',         !STATE.prefs.soundMuted); /* ON means sound enabled */
      if (SHOW_RM)    _paintToggle('ReducedMotion', STATE.prefs.reducedMotion);
      if (SHOW_QS)    _paintToggle('QuickSpin',     STATE.prefs.quickSpin);
      if (SHOW_AHW)   _paintToggle('AutoHideWin',   STATE.prefs.autoHideWin);
      if (SHOW_LOCALE) {
        var sel = _locale();
        if (sel) sel.value = STATE.prefs.locale;
      }
    }

    /* ─── public API ─────────────────────────────────────────────────── */

    function settingsGet(key) { return STATE.prefs[key]; }

    function settingsSet(key, value) {
      if (!(key in DEFAULTS)) return;
      var coerced;
      if (key === 'locale') {
        coerced = (typeof value === 'string' && LOCALES.indexOf(value) !== -1) ? value : DEFAULTS.locale;
      } else {
        coerced = !!value;
      }
      if (STATE.prefs[key] === coerced) return;
      STATE.prefs[key] = coerced;
      _writeLs(key, coerced);
      _applyGlobals();
      _paintAll();
      /* Side effects to other blocks. */
      if (key === 'turbo' && typeof window.turboModeToggle === 'function') {
        if (coerced && typeof window.turboModeOn === 'function') {
          if (!window.turboModeIsActive || !window.turboModeIsActive()) window.turboModeOn('api');
        } else if (!coerced && typeof window.turboModeOff === 'function') {
          if (!window.turboModeIsActive || window.turboModeIsActive()) window.turboModeOff('api');
        }
      }
      if (key === 'soundMuted' && typeof window.audioSetMuted === 'function') {
        try { window.audioSetMuted(coerced); } catch (_) {}
      }
    }

    function settingsReset() {
      var keys = Object.keys(DEFAULTS);
      for (var i = 0; i < keys.length; i++) {
        STATE.prefs[keys[i]] = DEFAULTS[keys[i]];
        _writeLs(keys[i], DEFAULTS[keys[i]]);
      }
      _applyGlobals();
      _paintAll();
      /* Notify turbo block of explicit off (idempotent if already off). */
      if (typeof window.turboModeOff === 'function') {
        try { window.turboModeOff('api'); } catch (_) {}
      }
    }

    function settingsPanelShow() {
      if (STATE.open) return;
      _paintAll();
      var bd = _backdrop();
      if (!bd) return;
      bd.hidden = false;
      STATE.open = true;
      var cb = _closeBtn();
      if (cb && typeof cb.focus === 'function') { try { cb.focus(); } catch (_) {} }
    }
    function settingsPanelHide() {
      if (!STATE.open) return;
      var bd = _backdrop(); if (bd) bd.hidden = true;
      STATE.open = false;
    }
    function settingsPanelToggle() {
      if (STATE.open) settingsPanelHide(); else settingsPanelShow();
    }

    if (typeof window !== 'undefined') {
      window.settingsPanelShow   = settingsPanelShow;
      window.settingsPanelHide   = settingsPanelHide;
      window.settingsPanelToggle = settingsPanelToggle;
      window.settingsGet         = settingsGet;
      window.settingsSet         = settingsSet;
      window.settingsReset       = settingsReset;
    }

    /* Init: load persisted prefs, apply globals, paint UI. */
    function _init() {
      var keys = Object.keys(DEFAULTS);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var raw = _readLs(k);
        if (raw === null) continue;
        if (k === 'locale') {
          if (LOCALES.indexOf(raw) !== -1) STATE.prefs[k] = raw;
        } else {
          STATE.prefs[k] = (raw === 'true' || raw === '1');
        }
      }
      _applyGlobals();
      _paintAll();
    }

    function _wireDom() {
      var b = _btn();         if (b) b.addEventListener('click', settingsPanelToggle);
      var c = _closeBtn();    if (c) c.addEventListener('click', settingsPanelHide);
      var r = _resetBtn();    if (r) r.addEventListener('click', settingsReset);

      if (SHOW_TURBO) {
        var t = _toggle('Turbo');
        if (t) t.addEventListener('click', function () { settingsSet('turbo', !STATE.prefs.turbo); });
      }
      if (SHOW_SOUND) {
        var s = _toggle('Sound');
        /* UI shows "Sound ON" = sound enabled = soundMuted false. Flip. */
        if (s) s.addEventListener('click', function () { settingsSet('soundMuted', !STATE.prefs.soundMuted); });
      }
      if (SHOW_RM) {
        var rm = _toggle('ReducedMotion');
        if (rm) rm.addEventListener('click', function () { settingsSet('reducedMotion', !STATE.prefs.reducedMotion); });
      }
      if (SHOW_QS) {
        var qs = _toggle('QuickSpin');
        if (qs) qs.addEventListener('click', function () { settingsSet('quickSpin', !STATE.prefs.quickSpin); });
      }
      if (SHOW_AHW) {
        var ahw = _toggle('AutoHideWin');
        if (ahw) ahw.addEventListener('click', function () { settingsSet('autoHideWin', !STATE.prefs.autoHideWin); });
      }
      if (SHOW_LOCALE) {
        var sel = _locale();
        if (sel) sel.addEventListener('change', function () { settingsSet('locale', sel.value); });
      }

      if (CLOSE_BACK) {
        var bd = _backdrop();
        if (bd) bd.addEventListener('click', function (ev) {
          if (ev.target === bd) settingsPanelHide();
        });
      }
      if (CLOSE_ESC) {
        document.addEventListener('keydown', function (ev) {
          if (ev.key === 'Escape' && STATE.open) settingsPanelHide();
        });
      }
      _init();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _wireDom, { once: true });
    } else {
      _wireDom();
    }

    /* HookBus listeners. */
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      /* External turbo toggle (via U11 button) → mirror to settings UI. */
      window.HookBus.on('onTurboToggle', function (p) {
        if (!p) return;
        if (STATE.prefs.turbo !== !!p.active) {
          STATE.prefs.turbo = !!p.active;
          _writeLs('turbo', STATE.prefs.turbo);
          _paintToggle('Turbo', STATE.prefs.turbo);
        }
      });
      if (AUTO_HIDE) {
        window.HookBus.on('preSpin',         function () { settingsPanelHide(); });
      }
      window.HookBus.on('onFsTrigger',     function () { settingsPanelHide(); });
      window.HookBus.on('onAutoplayStart', function () { settingsPanelHide(); });
    }
  })();
`;
}
