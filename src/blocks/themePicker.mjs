/**
 * src/blocks/themePicker.mjs
 *
 * Wave LEGO-THEME (B-8 · 1/3) — Player theme/skin picker.
 *
 * @module themePicker
 *
 * Purpose:
 *   Top-right gear-style picker that lets the player swap between
 *   configured visual themes (light / dark / high-contrast / custom).
 *   The picker writes the active theme id to document.documentElement
 *   as `data-theme="…"` and to localStorage so the choice persists
 *   across reloads. Sister blocks (paletteRoulette, ambientBgVariants)
 *   can subscribe to `onThemeChanged` to re-tune their visuals.
 *
 * Industry-reference (vendor-neutral):
 *   Theme switching is an accessibility + UX standard (WCAG 1.4.12
 *   text spacing + 1.4.6 contrast AAA). 2024-2026 baseline: 2-4
 *   themes (dark default, light, high-contrast). Selection persists
 *   per player. No vendor-specific brand themes.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitThemePickerCSS(cfg)                  → CSS string (button + dropdown)
 *   emitThemePickerMarkup(cfg)               → HTML string
 *   emitThemePickerRuntime(cfg)              → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  — none
 *   emits:       onThemeChanged { themeId, source }
 *                onThemePickerOpened { count }
 *                onThemePickerClosed { reason }
 *
 * a11y / perf:
 *   • Trigger button: real <button> with aria-haspopup="menu" +
 *     aria-expanded
 *   • Dropdown: role="menu" with role="menuitemradio" entries +
 *     aria-checked toggling
 *   • Keyboard: Arrow ↑↓ / Home / End / Esc / Enter / Space
 *   • Tokens hoisted (0 magic numbers)
 *   • localStorage persistence (key configurable per operator)
 *   • Defensive on private-mode storage failure
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  topPad:        14,
  topPadMobile:  10,
  /* sits to the LEFT of leaderboardChip (right 200). */
  rightPad:      340,
  rightPadMobile: 280,
  zIndex:        58,
  zIndexMenu:    65,
  btnSize:       36,
  btnSizeMobile: 30,
  fontRem:       0.74,
  fontRemMobile: 0.66,
  menuRadius:    12,
  menuMinWidth:  160,
  menuItemPadV:  6,
  menuItemPadH:  12,
  fadeMs:        160,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ID_RE  = /^[a-z][a-z0-9_-]{0,15}$/i;
const STORAGE_KEY_RE = /^[a-z][a-z0-9_.-]{1,32}$/i;

function _defaultThemes() {
  return Object.freeze([
    Object.freeze({ id: 'dark',     label: 'Dark',     swatch: '#1a1a1a' }),
    Object.freeze({ id: 'light',    label: 'Light',    swatch: '#f5f5f5' }),
    Object.freeze({ id: 'contrast', label: 'High Contrast', swatch: '#000000' }),
  ]);
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'THEME',
    themes: _defaultThemes(),
    defaultThemeIndex: 0,
    storageKey: 'slot.theme',
    color:    '#9aa4ff',
    colorDark: '#3a3f7c',
  });
}

function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function _validateTheme(raw, idx) {
  const fallback = _defaultThemes()[Math.min(idx, 2)] || _defaultThemes()[0];
  return Object.freeze({
    id: ID_RE.test(String(raw && raw.id || '')) ? String(raw.id) : `theme${idx}`,
    label: (typeof raw.label === 'string' && raw.label.length > 0 && raw.label.length <= 24)
      ? raw.label : fallback.label,
    swatch: (typeof raw.swatch === 'string' && HEX_RE.test(raw.swatch))
      ? raw.swatch : fallback.swatch,
  });
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('themePicker', defaultConfig(), model) };
  cfg.themes = cfg.themes.slice();
  const m = model.themePicker || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('themePicker', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 16) cfg.label = m.label;
  if (typeof m.storageKey === 'string' && STORAGE_KEY_RE.test(m.storageKey)) cfg.storageKey = m.storageKey;
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;

  if (Array.isArray(m.themes) && m.themes.length > 0) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < m.themes.length && out.length < 8; i++) {
      const t = _validateTheme(m.themes[i] || {}, i);
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    if (out.length > 0) cfg.themes = out;
  }

  /* Single-theme degeneracy collapses (picker is pointless). */
  if (cfg.enabled && cfg.themes.length < 2) {
    cfg.enabled = false;
    cfg.collapsedToSingleTheme = true;
  }

  cfg.defaultThemeIndex = _clampInt(
    Number.isFinite(m.defaultThemeIndex) ? m.defaultThemeIndex : 0,
    0, Math.max(0, cfg.themes.length - 1), 0
  );

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'theme_picker' || f.kind === 'skin_picker')) {
    const ctxOverride = applyGridProfile('themePicker', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  cfg.themes = Object.freeze(cfg.themes);
  return cfg;
}

export function emitThemePickerCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── theme picker ──────────────────────────────────────────────── */
.theme-picker-btn {
  position: fixed;
  top: max(${T.topPad}px, env(safe-area-inset-top, ${T.topPad}px));
  right: ${T.rightPad}px;
  z-index: ${T.zIndex};
  width: ${T.btnSize}px; height: ${T.btnSize}px;
  background: linear-gradient(135deg, ${cfg.color}, ${cfg.colorDark});
  border: 1px solid rgba(255,255,255,.4);
  border-radius: 50%;
  font-size: ${T.fontRem}rem;
  font-weight: 900;
  color: #fff;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  appearance: none;
  transition: filter .15s ease;
}
.theme-picker-btn:hover { filter: brightness(1.15); }
.theme-picker-btn:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }

.theme-picker-menu {
  position: fixed;
  top: calc(max(${T.topPad}px, env(safe-area-inset-top, ${T.topPad}px)) + ${T.btnSize + 8}px);
  right: ${T.rightPad}px;
  z-index: ${T.zIndexMenu};
  background: rgba(15,15,20,.96);
  border: 1px solid rgba(255,255,255,.18);
  border-radius: ${T.menuRadius}px;
  padding: 6px;
  min-width: ${T.menuMinWidth}px;
  display: flex; flex-direction: column; gap: 2px;
  opacity: 0; pointer-events: none;
  transform: translateY(-4px);
  transition: opacity ${T.fadeMs}ms ease, transform ${T.fadeMs}ms ease;
  box-shadow: 0 12px 36px rgba(0,0,0,.55);
}
.theme-picker-menu[data-open="true"] {
  opacity: 1; pointer-events: auto; transform: translateY(0);
}
.theme-picker-menu .tp-item {
  display: flex; align-items: center; gap: 10px;
  padding: ${T.menuItemPadV}px ${T.menuItemPadH}px;
  background: transparent;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: ${T.fontRem}rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-align: left;
  appearance: none;
  outline: none;
  transition: background .12s ease;
}
.theme-picker-menu .tp-item:hover { background: rgba(255,255,255,.08); }
.theme-picker-menu .tp-item:focus-visible {
  background: rgba(255,255,255,.08);
  outline: 2px solid ${cfg.color};
  outline-offset: -2px;
}
.theme-picker-menu .tp-item[aria-checked="true"] {
  background: linear-gradient(90deg, ${cfg.colorDark}, ${cfg.color});
}
.theme-picker-menu .tp-swatch {
  width: 14px; height: 14px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,.4);
  flex-shrink: 0;
}
@media (max-width: 620px) {
  .theme-picker-btn,
  .theme-picker-menu {
    top: max(${T.topPadMobile}px, env(safe-area-inset-top, ${T.topPadMobile}px));
    right: ${T.rightPadMobile}px;
  }
  .theme-picker-btn { width: ${T.btnSizeMobile}px; height: ${T.btnSizeMobile}px; font-size: ${T.fontRemMobile}rem; }
  .theme-picker-menu { font-size: ${T.fontRemMobile}rem; top: calc(max(${T.topPadMobile}px, env(safe-area-inset-top, ${T.topPadMobile}px)) + ${T.btnSizeMobile + 8}px); }
}
@media (prefers-reduced-motion: reduce) {
  .theme-picker-menu { transition: none !important; }
}
`;
}

export function emitThemePickerMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const di = cfg.defaultThemeIndex;
  const items = cfg.themes.map((t, i) => `
    <button class="tp-item" type="button" role="menuitemradio"
            data-theme-id="${escapeAttr(t.id)}" data-theme-index="${i}"
            aria-checked="${i === di ? 'true' : 'false'}"
            tabindex="${i === di ? '0' : '-1'}">
      <span class="tp-swatch" style="background:${escapeAttr(t.swatch)};"></span>
      <span>${escapeHtml(t.label)}</span>
    </button>`).join('');
  return `<button id="themePickerBtn" class="theme-picker-btn" type="button"
        aria-haspopup="menu" aria-expanded="false" aria-controls="themePickerMenu"
        aria-label="Open ${escapeAttr(cfg.label)} picker">⚙</button>
<div id="themePickerMenu" class="theme-picker-menu" data-open="false"
     role="menu" aria-labelledby="themePickerBtn">${items}
</div>`;
}

export function emitThemePickerRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* themePicker: disabled */`;
  return `/* ─── theme picker runtime ───────────────────────────────────── */
const TP_STORAGE_KEY    = ${JSON.stringify(cfg.storageKey)};
const TP_DEFAULT_INDEX  = ${cfg.defaultThemeIndex};

(function wireThemePicker(){
  const btn  = document.getElementById('themePickerBtn');
  const menu = document.getElementById('themePickerMenu');
  if (!btn || !menu) return;
  const items = Array.prototype.slice.call(menu.querySelectorAll('.tp-item'));
  if (items.length === 0) return;

  let lastFocus = null;

  function applyTheme(themeId, source) {
    document.documentElement.setAttribute('data-theme', themeId);
    try { localStorage.setItem(TP_STORAGE_KEY, themeId); }
    catch (_) { /* private-mode / quota — ignore */ }
    items.forEach(function(it){
      const sel = (it.getAttribute('data-theme-id') === themeId);
      it.setAttribute('aria-checked', sel ? 'true' : 'false');
      it.setAttribute('tabindex', sel ? '0' : '-1');
    });
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onThemeChanged', { themeId: themeId, source: source || 'user' });
    }
  }

  /* Hydrate from storage on first paint. */
  let stored = null;
  try { stored = localStorage.getItem(TP_STORAGE_KEY); } catch (_) {}
  if (stored && items.some(function(it){ return it.getAttribute('data-theme-id') === stored; })) {
    applyTheme(stored, 'storage');
  } else {
    applyTheme(items[TP_DEFAULT_INDEX].getAttribute('data-theme-id'), 'default');
  }

  function open() {
    lastFocus = document.activeElement;
    btn.setAttribute('aria-expanded', 'true');
    menu.setAttribute('data-open', 'true');
    const selected = items.find(function(it){ return it.getAttribute('aria-checked') === 'true'; });
    (selected || items[0]).focus();
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onThemePickerOpened', { count: items.length });
    }
  }

  function close(reason) {
    btn.setAttribute('aria-expanded', 'false');
    menu.setAttribute('data-open', 'false');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (_) {}
    }
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onThemePickerClosed', { reason: reason || 'user' });
    }
  }

  btn.addEventListener('click', function(){
    if (btn.getAttribute('aria-expanded') === 'true') close('toggle');
    else open();
  });

  items.forEach(function(item, idx){
    item.addEventListener('click', function(){
      applyTheme(item.getAttribute('data-theme-id'), 'user');
      close('selected');
    });
    item.addEventListener('keydown', function(e){
      let next = idx;
      if (e.key === 'ArrowDown')      next = (idx + 1) % items.length;
      else if (e.key === 'ArrowUp')   next = (idx - 1 + items.length) % items.length;
      else if (e.key === 'Home')      next = 0;
      else if (e.key === 'End')       next = items.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        applyTheme(item.getAttribute('data-theme-id'), 'user');
        close('selected'); return;
      }
      else if (e.key === 'Escape')    { e.preventDefault(); close('escape'); return; }
      else return;
      e.preventDefault();
      items[next].focus();
    });
  });

  document.addEventListener('click', function(e){
    if (btn.getAttribute('aria-expanded') !== 'true') return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    close('outside');
  });

  /* Auto-close menu when a spin starts — keeps focus on the game. */
  HookBus.on('preSpin', function(){
    if (btn.getAttribute('aria-expanded') === 'true') close('spin_start');
  });
})();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
