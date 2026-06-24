import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
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
  /* Wave K7 — extension: player-side selectors / toggles that drive
     downstream blocks (spin engine, autoplay, win-cap enforcement). */
  'volatility',        /* 'low' | 'medium' | 'high' */
  'betStepPreset',     /* number — coin / bet step quick-select */
  'maxWinCapEnabled',  /* boolean — opt-in cap from limits.max_win_x */
]);

/** @type {Readonly<string[]>} */
const VOLATILITY_OPTIONS_DEFAULT = Object.freeze(['low', 'medium', 'high']);

/** @type {Readonly<number[]>} industry baseline ladder (covers retail floor) */
const BET_STEP_PRESETS_DEFAULT = Object.freeze([0.10, 0.50, 1.00, 5.00]);

export function defaultConfig() {
  return Object.freeze({
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
    /* Wave K7 — extension defaults (all ON in baseline; gridProfile +
       GDD can opt-out per topology where the row isn't meaningful). */
    showVolatilitySelector:  true,
    showBetStepPresets:      true,
    showMaxWinCapToggle:     true,
    showHapticToggle:        true,
    defaultHapticEnabled:    false,
    volatilityOptions:       ['low', 'medium', 'high'],
    betStepPresets:          [0.10, 0.50, 1.00, 5.00],
    defaultVolatility:       'medium',
    defaultBetStepPreset:    1.00,
    defaultMaxWinCapEnabled: true,
    persistInLocalStorage: true,
    closeOnBackdrop: true,
    closeOnEscape:   true,
    autoHideOnSpin:  true,
    ariaLabel: 'Open settings',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
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
                       'showVolatilitySelector', 'showBetStepPresets', 'showMaxWinCapToggle',
                       'showHapticToggle', 'persistInLocalStorage', 'closeOnBackdrop', 'closeOnEscape',
                       'autoHideOnSpin']) {
    if (m[flag] != null) cfg[flag] = !!m[flag];
  }
  if (m.defaultHapticEnabled != null) cfg.defaultHapticEnabled = !!m.defaultHapticEnabled;

  /* Wave K7 — volatility option list (defensive: keep only canonical labels) */
  if (Array.isArray(m.volatilityOptions) && m.volatilityOptions.length > 0) {
    const cleaned = m.volatilityOptions
      .filter(v => typeof v === 'string' && /^(low|medium|high)$/.test(v));
    if (cleaned.length > 0) cfg.volatilityOptions = [...new Set(cleaned)];
  }
  if (typeof m.defaultVolatility === 'string' && /^(low|medium|high)$/.test(m.defaultVolatility)) {
    cfg.defaultVolatility = m.defaultVolatility;
  }

  /* Wave K7 — bet-step preset ladder (defensive: only finite positive numbers
     within plausible retail range, deduped, max 8 entries) */
  if (Array.isArray(m.betStepPresets) && m.betStepPresets.length > 0) {
    const cleaned = m.betStepPresets
      .map(n => Number(n))
      .filter(n => Number.isFinite(n) && n > 0 && n <= 10000);
    if (cleaned.length > 0) cfg.betStepPresets = [...new Set(cleaned)].sort((a, b) => a - b).slice(0, 8);
  }
  if (Number.isFinite(m.defaultBetStepPreset) && m.defaultBetStepPreset > 0) {
    cfg.defaultBetStepPreset = Number(m.defaultBetStepPreset);
  }

  /* Wave K7 — max-win cap default state (industry baseline = enabled, but
     a GDD can ship the toggle off-by-default for free-play / no-limits demos). */
  if (m.defaultMaxWinCapEnabled != null) {
    cfg.defaultMaxWinCapEnabled = !!m.defaultMaxWinCapEnabled;
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
  /* Utility-rail slot 1 (bottom of rail): bottom-left.
     Stack (bottom-up): settings (96) → paytable (156) → history (216).
     2026-06-09 — was 92 (collided with paytable's 96). Now anchored to
     the canonical 96 anchor and the rail stacks UP from here. */
  .settings-btn {
    position: fixed;
    left: max(18px, env(safe-area-inset-left, 18px));
    bottom: calc(max(18px, env(safe-area-inset-bottom, 18px)) + 96px);
    z-index: 25;
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
  @media (max-width: 620px) {
    .settings-btn {
      left: max(12px, env(safe-area-inset-left, 12px));
      /* Mobile rail: settings (88) → paytable (148) → history (208). */
      bottom: calc(max(12px, env(safe-area-inset-bottom, 12px)) + 88px);
    }
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
    font-size: 11px;          /* Apple HIG floor — was 10px, lifted by huff-puff deep QA */
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
  /* WCAG 2.4.7 (F4 A2) — focus ring */
  .settings-toggle:focus-visible {
    outline: 2px solid rgba(${c.modalAccentColor}, 0.95);
    outline-offset: 2px;
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

  /* Wave K7 — stack layout for rows that carry a segmented selector
     instead of a binary toggle (volatility / bet-step). */
  .settings-row--stack {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .settings-seg-group {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    width: 100%;
  }
  .settings-seg {
    flex: 1 1 auto;
    min-width: 60px;
    /* Wave K5 — clears 44pt tap-target floor (WCAG 2.5.5 / Apple HIG). */
    min-height: 44px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid rgba(${c.modalAccentColor}, 0.45);
    background: rgba(${c.modalAccentColor}, 0.12);
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    cursor: pointer;
    touch-action: manipulation;
    transition: background 120ms ease-out, border-color 120ms ease-out, transform 100ms ease-out;
  }
  .settings-seg:hover  { background: rgba(${c.modalAccentColor}, 0.24); }
  .settings-seg:active { transform: scale(0.96); }
  .settings-seg.is-active {
    background: rgba(${c.modalAccentColor}, 0.85);
    border-color: rgba(${c.modalAccentColor}, 1);
    color: rgb(${c.modalBgColor});
  }
  .settings-seg:focus-visible {
    outline: 2px solid rgba(${c.modalAccentColor}, 1);
    outline-offset: 2px;
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

  /* Wave K7 — Volatility segmented control. */
  if (c.showVolatilitySelector) {
    const segs = c.volatilityOptions.map(v =>
      `<button type="button" class="settings-seg" data-volatility="${_escape(v)}" aria-label="Volatility ${_escape(v)}">${_escape(v[0].toUpperCase() + v.slice(1))}</button>`
    ).join('');
    rows.push(`
        <div class="settings-row settings-row--stack" data-setting="volatility">
          <div>
            <div class="settings-row__label">Volatility</div>
            <div class="settings-row__hint">Risk profile of math layer</div>
          </div>
          <div id="settingsVolatilitySeg" class="settings-seg-group" role="radiogroup" aria-label="Volatility selector">${segs}</div>
        </div>`);
  }

  /* Wave K7 — Bet-step preset ladder (quick-select coin / bet value). */
  if (c.showBetStepPresets) {
    const presets = c.betStepPresets.map((n, i) => {
      const safe = (typeof n === 'number' && isFinite(n)) ? n.toFixed(2) : '0.00';
      return tagBlockMarkup(`<button type="button" class="settings-seg" data-bet-step-idx="${i}" aria-label="Bet step ${_escape(safe)}">${_escape(safe)}</button>`, 'settingsPanel');
    }).join('');
    rows.push(`
        <div class="settings-row settings-row--stack" data-setting="betStepPreset">
          <div>
            <div class="settings-row__label">Bet Step</div>
            <div class="settings-row__hint">Quick-select coin value</div>
          </div>
          <div id="settingsBetStepSeg" class="settings-seg-group" role="radiogroup" aria-label="Bet step selector">${presets}</div>
        </div>`);
  }

  /* Wave K7 — Max Win Cap toggle. */
  if (c.showMaxWinCapToggle) {
    rows.push(`
        <div class="settings-row" data-setting="maxWinCapEnabled">
          <div>
            <div class="settings-row__label">Max Win Cap</div>
            <div class="settings-row__hint">Honor regulator / GDD win ceiling</div>
          </div>
          <button id="settingsMaxWinCapToggle" class="settings-toggle" type="button" aria-label="Max win cap toggle" aria-pressed="false"></button>
        </div>`);
  }
  if (c.showHapticToggle) {
    rows.push(`
        <div class="settings-row" data-setting="hapticEnabled">
          <div>
            <div class="settings-row__label">Haptic Feedback</div>
            <div class="settings-row__hint">Vibrate on big wins & free spins</div>
          </div>
          <button id="settingsHapticToggle" class="settings-toggle" type="button" aria-label="Haptic feedback toggle" aria-pressed="false"></button>
        </div>`);
  }

  /* Boki rule (04.06.2026): settings reuses the hamburger `#settingsMenuBtn`
   * already rendered by the orchestrator inside `.hub`. The block emits
   * ONLY the modal — runtime wires its open behaviour onto the existing
   * hamburger. No duplicate floating button. */
  /* UQ-DEEP-AQ H-1: data-i18n stamping on dialog controls. */
  return tagBlockMarkup(`
  <div id="settingsBackdrop" class="settings-backdrop" hidden role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
    <div id="settingsModal" class="settings-modal" role="document">
      <h2 id="settingsTitle" data-i18n="settingsPanel.title" data-i18n-fallback="Settings">Settings</h2>
      <div id="settingsRows">${rows.join('')}</div>
      <div class="settings-actions">
        <button id="settingsResetBtn" class="settings-action settings-action--reset" type="button" data-i18n="common.reset" data-i18n-fallback="Reset">Reset</button>
        <button id="settingsCloseBtn" class="settings-action" type="button" data-i18n="common.close" data-i18n-fallback="Close">Close</button>
      </div>
    </div>
  </div>`, 'settingsPanel');
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
    if (typeof document === 'undefined') {
      if (typeof window !== 'undefined') {
        window.settingsPanelShow   = function () {};
        window.settingsPanelHide   = function () {};
        window.settingsPanelToggle = function () {};
        window.settingsGet         = function () { return undefined; };
        window.settingsSet         = function () {};
        window.settingsReset       = function () {};
        window.SETTINGS_PANEL_STATE = { enabled: false, open: false, prefs: {} };
      }
      return;
    }
    var SHOW_TURBO   = ${c.showTurboToggle};
    var SHOW_SOUND   = ${c.showSoundToggle};
    var SHOW_RM      = ${c.showReducedMotionToggle};
    var SHOW_QS      = ${c.showQuickSpinToggle};
    var SHOW_AHW     = ${c.showAutoHideWinToggle};
    var SHOW_LOCALE  = ${c.showLanguageSelector};
    /* Wave K7 — extension visibility flags. */
    var SHOW_VOLATILITY = ${c.showVolatilitySelector};
    var SHOW_BETSTEP    = ${c.showBetStepPresets};
    var SHOW_MAXWIN     = ${c.showMaxWinCapToggle};
    var SHOW_HAPTIC     = ${c.showHapticToggle};
    var PERSIST      = ${c.persistInLocalStorage};
    var CLOSE_BACK   = ${c.closeOnBackdrop};
    var CLOSE_ESC    = ${c.closeOnEscape};
    var AUTO_HIDE    = ${c.autoHideOnSpin};
    var LOCALES      = ${JSON.stringify(c.availableLocales)};
    /* Wave K7 — canonical option lists, baked from cfg. */
    var VOLATILITY_OPTIONS = ${JSON.stringify(c.volatilityOptions)};
    var BET_STEP_PRESETS   = ${JSON.stringify(c.betStepPresets)};
    var LS_PREFIX    = 'slot.settings.';

    var DEFAULTS = {
      turbo:            false,
      soundMuted:       false,
      reducedMotion:    false,
      quickSpin:        false,
      autoHideWin:      true,
      locale:           LOCALES[0] || 'en-US',
      /* Wave K7 — extension defaults */
      volatility:       ${JSON.stringify(c.defaultVolatility)},
      betStepPreset:    ${Number(c.defaultBetStepPreset)},
      maxWinCapEnabled: ${!!c.defaultMaxWinCapEnabled},
      hapticEnabled:    ${!!c.defaultHapticEnabled},
    };

    var STATE = {
      enabled: true,
      open: false,
      prefs: Object.assign({}, DEFAULTS),
    };
    window.SETTINGS_PANEL_STATE = STATE;

    /* Reuse the existing .hub settingsMenuBtn (hamburger icon) rendered
     * by the orchestrator. Boki rule: no duplicate floating button. */
    function _btn()       { return document.getElementById('settingsMenuBtn'); }
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
      window.__SLOT_REDUCED_MOTION__ = !!STATE.prefs.reducedMotion;
      window.__SLOT_QUICK_SPIN__     = !!STATE.prefs.quickSpin;
      window.__SLOT_AUTO_HIDE_WIN__  = !!STATE.prefs.autoHideWin;
      window.__SLOT_LOCALE__         = String(STATE.prefs.locale);
      /* Wave K7 — downstream blocks read these directly (engine cadence
         tuning, autoplay max-bet clamp, win-cap enforcement). */
      window.__SLOT_VOLATILITY__         = String(STATE.prefs.volatility);
      window.__SLOT_BET_STEP_PRESET__    = Number(STATE.prefs.betStepPreset);
      window.__SLOT_MAX_WIN_CAP_ENABLED__ = !!STATE.prefs.maxWinCapEnabled;
      window.__SLOT_HAPTIC_ENABLED__     = !!STATE.prefs.hapticEnabled;
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
      /* Wave K7 — paint segmented groups + max-win toggle. */
      if (SHOW_VOLATILITY) _paintSegGroup('settingsVolatilitySeg', 'volatility', String(STATE.prefs.volatility));
      if (SHOW_BETSTEP)    _paintSegGroup('settingsBetStepSeg',    'bet-step-idx', String(BET_STEP_PRESETS.indexOf(STATE.prefs.betStepPreset)));
      if (SHOW_MAXWIN)     _paintToggle('MaxWinCap', STATE.prefs.maxWinCapEnabled);
      if (SHOW_HAPTIC)     _paintToggle('Haptic',    STATE.prefs.hapticEnabled);
    }

    /* Wave K7 — helpers for segmented group rendering. */
    function _fmtBet(n) {
      var v = Number(n);
      if (!isFinite(v)) v = DEFAULTS.betStepPreset;
      return v.toFixed(2);
    }
    function _paintSegGroup(rootId, attr, activeValue) {
      var root = document.getElementById(rootId);
      if (!root) return;
      var segs = root.querySelectorAll('.settings-seg');
      for (var i = 0; i < segs.length; i++) {
        var seg = segs[i];
        var v = seg.getAttribute('data-' + attr);
        var on = String(v) === String(activeValue);
        seg.classList.toggle('is-active', on);
        seg.setAttribute('aria-checked', on ? 'true' : 'false');
        seg.setAttribute('role', 'radio');
        seg.setAttribute('tabindex', on ? '0' : '-1');
      }
    }

    /* Wave K7 — ARIA radiogroup keyboard navigation. Arrows advance focus +
       apply selection so keyboard-only users can move between options. */
    function _wireSegKbd(root, attr, apply) {
      if (!root) return;
      root.addEventListener('keydown', function (ev) {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' &&
            ev.key !== 'ArrowUp'   && ev.key !== 'ArrowDown') return;
        var segs = root.querySelectorAll('.settings-seg');
        if (segs.length === 0) return;
        var cur = -1;
        for (var i = 0; i < segs.length; i++) {
          if (segs[i] === document.activeElement) { cur = i; break; }
        }
        if (cur === -1) {
          for (var j = 0; j < segs.length; j++) {
            if (segs[j].classList.contains('is-active')) { cur = j; break; }
          }
        }
        if (cur === -1) cur = 0;
        var next = (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp')
          ? (cur - 1 + segs.length) % segs.length
          : (cur + 1) % segs.length;
        ev.preventDefault();
        if (typeof segs[next].focus === 'function') { try { segs[next].focus(); } catch (_) {} }
        var v = segs[next].getAttribute('data-' + attr);
        if (v != null) apply(v);
      });
    }

    /* ─── public API ─────────────────────────────────────────────────── */

    function settingsGet(key) { return STATE.prefs[key]; }

    function settingsSet(key, value) {
      if (!(key in DEFAULTS)) return;
      var coerced;
      if (key === 'locale') {
        coerced = (typeof value === 'string' && LOCALES.indexOf(value) !== -1) ? value : STATE.prefs[key];
      } else if (key === 'volatility') {
        coerced = (typeof value === 'string' && VOLATILITY_OPTIONS.indexOf(value) !== -1)
          ? value : STATE.prefs[key];
      } else if (key === 'betStepPreset') {
        var n = Number(value);
        coerced = (isFinite(n) && BET_STEP_PRESETS.indexOf(n) !== -1) ? n : STATE.prefs[key];
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
      /* Wave K7 — settingsPanel is the SOLE OWNER of these three lifecycle
         emits (LEGO single-owner gate). Downstream blocks (spin engine,
         betSelector, winCap) listen and update their internal state. */
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        if (key === 'volatility') {
          window.HookBus.emit('onVolatilityChanged', { value: coerced, source: 'settings' });
        } else if (key === 'betStepPreset') {
          window.HookBus.emit('onBetStepPresetChanged', { value: coerced, source: 'settings' });
        } else if (key === 'maxWinCapEnabled') {
          window.HookBus.emit('onMaxWinCapToggled', { enabled: coerced, source: 'settings' });
        } else if (key === 'locale') {
          /* Wave A5 — rtlLayout consumes this to flip html[dir] live. */
          window.HookBus.emit('onLocaleChanged', { value: coerced, source: 'settings' });
        }
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
      /* Mirror muted reset to audio block — UI paints "Sound ON" so the
         session must actually be unmuted, not just look that way. */
      if (typeof window.audioSetMuted === 'function') {
        try { window.audioSetMuted(false); } catch (_) {}
      }
      /* settingsPanel is the SOLE OWNER of these K7 emits — reset must
         re-emit so downstream listeners (spin engine, betSelector, winCap)
         resync to defaults instead of holding the pre-reset value. */
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        window.HookBus.emit('onVolatilityChanged',    { value: DEFAULTS.volatility,       source: 'reset' });
        window.HookBus.emit('onBetStepPresetChanged', { value: DEFAULTS.betStepPreset,    source: 'reset' });
        window.HookBus.emit('onMaxWinCapToggled',     { enabled: DEFAULTS.maxWinCapEnabled, source: 'reset' });
        window.HookBus.emit('onLocaleChanged',        { value: DEFAULTS.locale,           source: 'reset' });
        /* Wave A10 — haptic global resynced via _applyGlobals() above. */
      }
    }

    /* WCAG 2.4.3 / 2.1.2 focus trap — dialog with aria-modal="true" must
       hold focus until dismissed, then restore the prior focus owner. */
    var _prevFocus = null;
    function _modalFocusables() {
      var modal = document.getElementById('settingsModal');
      if (!modal) return [];
      var list = modal.querySelectorAll(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (el.offsetParent !== null || el === document.activeElement) out.push(el);
      }
      return out;
    }
    function _onTrapKeydown(ev) {
      if (ev.key !== 'Tab' || !STATE.open) return;
      var f = _modalFocusables();
      if (f.length === 0) return;
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        if (typeof last.focus === 'function') { try { last.focus(); } catch (_) {} }
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        if (typeof first.focus === 'function') { try { first.focus(); } catch (_) {} }
      }
    }

    function settingsPanelShow() {
      if (STATE.open) return;
      _paintAll();
      var bd = _backdrop();
      if (!bd) return;
      _prevFocus = document.activeElement;
      bd.hidden = false;
      STATE.open = true;
      document.addEventListener('keydown', _onTrapKeydown);
      var cb = _closeBtn();
      if (cb && typeof cb.focus === 'function') { try { cb.focus(); } catch (_) {} }
    }
    function settingsPanelHide() {
      if (!STATE.open) return;
      var bd = _backdrop(); if (bd) bd.hidden = true;
      STATE.open = false;
      document.removeEventListener('keydown', _onTrapKeydown);
      if (_prevFocus && typeof _prevFocus.focus === 'function') {
        try { _prevFocus.focus(); } catch (_) {}
      }
      _prevFocus = null;
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
        } else if (k === 'volatility') {
          if (VOLATILITY_OPTIONS.indexOf(raw) !== -1) STATE.prefs[k] = raw;
        } else if (k === 'betStepPreset') {
          var n = Number(raw);
          if (isFinite(n) && BET_STEP_PRESETS.indexOf(n) !== -1) STATE.prefs[k] = n;
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

      /* Wave K7 — segmented group click handlers (event delegation). */
      if (SHOW_VOLATILITY) {
        var volRoot = document.getElementById('settingsVolatilitySeg');
        if (volRoot) volRoot.addEventListener('click', function (ev) {
          var btn = ev.target && ev.target.closest && ev.target.closest('.settings-seg');
          if (!btn) return;
          var v = btn.getAttribute('data-volatility');
          if (v) settingsSet('volatility', v);
        });
      }
      if (SHOW_BETSTEP) {
        var bsRoot = document.getElementById('settingsBetStepSeg');
        if (bsRoot) bsRoot.addEventListener('click', function (ev) {
          var btn = ev.target && ev.target.closest && ev.target.closest('.settings-seg');
          if (!btn) return;
          var raw = btn.getAttribute('data-bet-step');
          var n = Number(raw);
          if (isFinite(n)) settingsSet('betStepPreset', n);
        });
      }
      if (SHOW_MAXWIN) {
        var mw = _toggle('MaxWinCap');
        if (mw) mw.addEventListener('click', function () {
          settingsSet('maxWinCapEnabled', !STATE.prefs.maxWinCapEnabled);
        });
      }
      if (SHOW_HAPTIC) {
        var hapt = _toggle('Haptic');
        if (hapt) hapt.addEventListener('click', function () {
          settingsSet('hapticEnabled', !STATE.prefs.hapticEnabled);
        });
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
