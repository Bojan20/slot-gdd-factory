/**
 * src/blocks/paletteRoulette.mjs
 *
 * Wave LEGO-THEME (B-8 · 2/3) — Random palette roulette (per session).
 *
 * @module paletteRoulette
 *
 * Purpose:
 *   On page load, randomly picks one of N configured color palettes
 *   (weighted) and applies it via CSS custom properties on
 *   `document.documentElement`. Adds visual variety across sessions
 *   without changing core game mechanics. Player can re-roll via a
 *   small "↻" button next to the theme picker.
 *
 * Industry-reference (vendor-neutral):
 *   Session-randomized palettes are an emerging 2024-2026 retention
 *   pattern — gives players a "new look every session" feel without
 *   changing the game itself. Industry baseline: 3-8 palettes, equal
 *   weights, re-roll on demand. Distinct from themePicker (which is
 *   semantic light/dark) — palette is purely aesthetic accent color.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitPaletteRouletteCSS(cfg)              → CSS string
 *   emitPaletteRouletteMarkup(cfg)           → HTML string
 *   emitPaletteRouletteRuntime(cfg)          → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onThemeChanged — re-apply palette over new theme
 *   emits:       onPaletteRolled { paletteId, paletteIndex }
 *
 * a11y / perf:
 *   • Re-roll button: real <button> + aria-label
 *   • CSS variables: --pal-accent / --pal-accent-dark / --pal-accent-rgb
 *   • prefers-reduced-motion honored (no spin animation)
 *   • Tokens hoisted
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  topPad:        14,
  topPadMobile:  10,
  rightPad:      384,   /* sits to LEFT of themePicker (right 340 + 36 + gap) */
  rightPadMobile: 314,
  zIndex:        58,
  btnSize:       32,
  btnSizeMobile: 28,
  fontRem:       0.9,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ID_RE  = /^[a-z][a-z0-9_-]{0,15}$/i;
const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;

function _defaultPalettes() {
  return Object.freeze([
    Object.freeze({ id: 'gold',    label: 'Gold',    accent: '#ffd34a', accentDark: '#a07520', accentRGB: '255,211,74',  weight: 30 }),
    Object.freeze({ id: 'ocean',   label: 'Ocean',   accent: '#7fbfff', accentDark: '#205080', accentRGB: '127,191,255', weight: 25 }),
    Object.freeze({ id: 'rose',    label: 'Rose',    accent: '#ffaad4', accentDark: '#9a2466', accentRGB: '255,170,212', weight: 20 }),
    Object.freeze({ id: 'emerald', label: 'Emerald', accent: '#7fffd4', accentDark: '#205045', accentRGB: '127,255,212', weight: 15 }),
    Object.freeze({ id: 'amethyst',label: 'Amethyst',accent: '#c5a8ff', accentDark: '#5a3a9c', accentRGB: '197,168,255', weight: 10 }),
  ]);
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'Palette',
    palettes: _defaultPalettes(),
    /* Persist last rolled palette so reload shows same look. Set
     * false for "fresh each session" mode. */
    persist: true,
    storageKey: 'slot.palette',
  });
}

function _validatePalette(raw, idx) {
  const fallback = _defaultPalettes()[Math.min(idx, 4)] || _defaultPalettes()[0];
  return Object.freeze({
    id: ID_RE.test(String(raw && raw.id || '')) ? String(raw.id) : `pal${idx}`,
    label: (typeof raw.label === 'string' && raw.label.length > 0 && raw.label.length <= 24)
      ? raw.label : fallback.label,
    accent:     (typeof raw.accent === 'string'     && HEX_RE.test(raw.accent))     ? raw.accent     : fallback.accent,
    accentDark: (typeof raw.accentDark === 'string' && HEX_RE.test(raw.accentDark)) ? raw.accentDark : fallback.accentDark,
    accentRGB:  (typeof raw.accentRGB === 'string'  && RGB_RE.test(raw.accentRGB))  ? raw.accentRGB  : fallback.accentRGB,
    weight:     (Number.isFinite(raw.weight) && raw.weight > 0) ? Math.min(1000, Math.floor(raw.weight)) : fallback.weight,
  });
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('paletteRoulette', defaultConfig(), model) };
  cfg.palettes = cfg.palettes.slice();
  const m = model.paletteRoulette || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('paletteRoulette', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 16) cfg.label = m.label;
  if (typeof m.persist === 'boolean') cfg.persist = m.persist;
  if (typeof m.storageKey === 'string' && /^[a-z][a-z0-9_.-]{1,32}$/i.test(m.storageKey)) cfg.storageKey = m.storageKey;

  if (Array.isArray(m.palettes) && m.palettes.length > 0) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < m.palettes.length && out.length < 10; i++) {
      const p = _validatePalette(m.palettes[i] || {}, i);
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    if (out.length > 0) cfg.palettes = out;
  }

  if (cfg.enabled && cfg.palettes.length < 2) {
    cfg.enabled = false;
    cfg.collapsedToSinglePalette = true;
  }

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'palette_roulette' || f.kind === 'session_palette')) {
    const ctxOverride = applyGridProfile('paletteRoulette', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  cfg.palettes = Object.freeze(cfg.palettes);
  return cfg;
}

export function emitPaletteRouletteCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── palette roulette re-roll button ───────────────────────────── */
.palette-roulette-btn {
  position: fixed;
  top: max(${T.topPad}px, env(safe-area-inset-top, ${T.topPad}px));
  right: ${T.rightPad}px;
  z-index: ${T.zIndex};
  width: ${T.btnSize}px; height: ${T.btnSize}px;
  background: rgba(0,0,0,.6);
  border: 1px solid rgba(255,255,255,.3);
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  font-size: ${T.fontRem}rem;
  display: flex; align-items: center; justify-content: center;
  appearance: none;
  transition: transform .35s ease, filter .15s ease;
}
.palette-roulette-btn:hover { filter: brightness(1.15); }
.palette-roulette-btn:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.palette-roulette-btn[data-rolling="true"] { transform: rotate(360deg); }
@media (max-width: 620px) {
  .palette-roulette-btn {
    top: max(${T.topPadMobile}px, env(safe-area-inset-top, ${T.topPadMobile}px));
    right: ${T.rightPadMobile}px;
    width: ${T.btnSizeMobile}px; height: ${T.btnSizeMobile}px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .palette-roulette-btn { transition: none !important; }
  .palette-roulette-btn[data-rolling="true"] { transform: none !important; }
}
`;
}

export function emitPaletteRouletteMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<button id="paletteRouletteBtn" class="palette-roulette-btn" type="button"
        aria-label="Roll a new color ${escapeAttr(cfg.label)}" data-rolling="false">↻</button>`;
}

export function emitPaletteRouletteRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* paletteRoulette: disabled */`;
  const palettesJSON = JSON.stringify(cfg.palettes);
  return `/* ─── palette roulette runtime ───────────────────────────────── */
const PR_PALETTES   = ${palettesJSON};
const PR_PERSIST    = ${cfg.persist};
const PR_STORAGE_KEY= ${JSON.stringify(cfg.storageKey)};

(function wirePaletteRoulette(){
  const btn = document.getElementById('paletteRouletteBtn');
  if (!btn) return;

  function applyPalette(p, source) {
    const root = document.documentElement;
    root.style.setProperty('--pal-accent',      p.accent);
    root.style.setProperty('--pal-accent-dark', p.accentDark);
    root.style.setProperty('--pal-accent-rgb',  p.accentRGB);
    root.setAttribute('data-palette', p.id);
    if (PR_PERSIST) {
      try { localStorage.setItem(PR_STORAGE_KEY, p.id); } catch (_) {}
    }
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      const idx = PR_PALETTES.findIndex(function(x){ return x.id === p.id; });
      HookBus.emit('onPaletteRolled', { paletteId: p.id, paletteIndex: idx });
    }
  }

  function rollWeighted() {
    const total = PR_PALETTES.reduce(function(s, p){ return s + p.weight; }, 0);
    let roll = Math.random() * total;
    for (const p of PR_PALETTES) {
      roll -= p.weight;
      if (roll <= 0) return p;
    }
    return PR_PALETTES[PR_PALETTES.length - 1];
  }

  /* Hydrate: persisted palette or fresh roll */
  let stored = null;
  if (PR_PERSIST) {
    try { stored = localStorage.getItem(PR_STORAGE_KEY); } catch (_) {}
  }
  const fromStored = stored ? PR_PALETTES.find(function(p){ return p.id === stored; }) : null;
  applyPalette(fromStored || rollWeighted(), fromStored ? 'storage' : 'initial');

  btn.addEventListener('click', function(){
    btn.setAttribute('data-rolling', 'true');
    setTimeout(function(){ btn.setAttribute('data-rolling', 'false'); }, 380);
    applyPalette(rollWeighted(), 'user');
  });

  /* On theme change, re-apply current palette so accents stay
   * consistent over the new theme background. */
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onThemeChanged', function(){
    const current = document.documentElement.getAttribute('data-palette');
    const p = current ? PR_PALETTES.find(function(x){ return x.id === current; }) : null;
    if (p) applyPalette(p, 'theme-sync');
  }) : void 0);
})();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
