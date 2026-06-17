/**
 * src/blocks/colorblindPatterns.mjs
 *
 * Wave H4 — Color-blind pattern overlay (WCAG 2.2 SC 1.4.1 Use of Color · AAA).
 *
 * Industry baseline (vendor-neutral):
 *   Information that is conveyed by colour alone (symbol tier, win/loss state,
 *   wild/scatter distinction) MUST also be conveyed by a non-colour signal.
 *   Modern slots solve this with per-tier *pattern overlays* (hatching, dots,
 *   diagonal stripes, double border) that are visible regardless of palette
 *   or CVD (deuteranopia / protanopia / tritanopia / achromatopsia).
 *
 * This block is a **pure CSS + minimal-runtime decorator**:
 *   • Owns ONLY the `.symbol-cell[data-cb-tier="…"]::before` overlay layer.
 *   • Listens to `postSpin` + `onTumbleStep` + `onFsSpinResult` to (re-)apply
 *     `data-cb-tier` attribute on every cell based on its symbol code →
 *     tier classification (HP / MP / LP / WILD / SCATTER / BONUS / SPECIAL).
 *   • Emits ZERO events. Read-only presentation layer (like motionOverlay).
 *   • User toggle: persisted under `localStorage[slot.cbPatterns]` and a
 *     settingsPanel-compatible flag `window.__SLOT_CB_PATTERNS_ON__`.
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                   → safe defaults (auto-on if missing).
 *   resolveConfig(model)              → merge GDD model overrides.
 *   emitColorblindPatternsCSS(cfg)    → CSS layer (per-tier patterns).
 *   emitColorblindPatternsMarkup(cfg) → toggle chip (top-right corner).
 *   emitColorblindPatternsRuntime(cfg)→ HookBus listener + decorate engine.
 *
 * Lifecycle:
 *   subscribes:
 *     postSpin           — decorate base-game cells after settle
 *     onTumbleStep       — re-decorate after cascade refill
 *     onFsSpinResult     — decorate FS spins
 *     onCbPatternsToggle — settings panel triggers visual flip (own event)
 *   emits:
 *     onCbPatternsToggle { enabled } — when chip clicked OR API set
 *
 * a11y:
 *   - role="switch" on the toggle chip with `aria-checked` / `aria-label`.
 *   - prefers-reduced-motion respected (no flash transition).
 *   - Apple HIG 11px font-size floor.
 *   - High-contrast 7:1 stroke on the pattern (works on dark + light bg).
 *
 * Vendor-neutral: NO game / studio / engine names in source or output.
 *
 * GDD config (consumed from `model.colorblindPatterns`):
 *   {
 *     enabled:        boolean (default true — accessibility default-on)
 *     autoActivate:   boolean (default false — start hidden; player opt-in)
 *     position:       'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
 *     chipLabel:      string (default 'CB')
 *     chipFontSize:   number 11..18
 *     patternOpacity: number 0.10..1.00
 *     blendMode:      'normal' | 'overlay' | 'multiply' | 'screen'
 *     tierMap:        { [symbolCode]: 'HP'|'MP'|'LP'|'WILD'|'SCATTER'|'BONUS'|'SPECIAL' }
 *     persistKey:     string  (localStorage key)
 *     zIndex:         number  (overlay layer)
 *   }
 *
 * @module colorblindPatterns
 */

/* ── Canonical tier whitelist + pattern bank ──────────────────────────────
 * Each tier maps to a deterministic SVG `data:` URL background-image. All
 * patterns are stroke-based for high CVD contrast and bg-agnostic legibility. */
const TIERS = Object.freeze(['HP', 'MP', 'LP', 'WILD', 'SCATTER', 'BONUS', 'SPECIAL']);
const TIER_SET = new Set(TIERS);
const POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const BLEND_MODES = new Set(['normal', 'overlay', 'multiply', 'screen']);

const BOUNDS = Object.freeze({
  chipFontSize:   [11, 18],
  patternOpacity: [0.10, 1.00],
  zIndex:         [10, 99],
});

/* SVG pattern URI factory — 24×24 tile, white stroke, 1.4 stroke width.
 * Stroke colour is white so patterns read on both gold/dark and light themes
 * (player can blend-mode it onto bright symbols via `blendMode: 'multiply'`). */
function _patternURI(kind) {
  const W = 24;
  let body;
  switch (kind) {
    case 'HP':
      // diagonal stripes (↘) — chunky high-priority signal
      body = `<path d="M-2 18 L18 -2 M-2 26 L26 -2 M6 26 L26 6" stroke="#fff" stroke-width="2" fill="none" />`;
      break;
    case 'MP':
      // horizontal stripes (==) — medium-priority signal
      body = `<path d="M0 6 H24 M0 12 H24 M0 18 H24" stroke="#fff" stroke-width="1.5" fill="none" />`;
      break;
    case 'LP':
      // dots grid — low-priority background hum
      body = `<circle cx="6" cy="6" r="1.6" fill="#fff" /><circle cx="18" cy="6" r="1.6" fill="#fff" /><circle cx="6" cy="18" r="1.6" fill="#fff" /><circle cx="18" cy="18" r="1.6" fill="#fff" /><circle cx="12" cy="12" r="1.6" fill="#fff" />`;
      break;
    case 'WILD':
      // double-frame (inner + outer)
      body = `<rect x="2" y="2" width="20" height="20" stroke="#fff" stroke-width="2" fill="none" /><rect x="6" y="6" width="12" height="12" stroke="#fff" stroke-width="1.4" fill="none" />`;
      break;
    case 'SCATTER':
      // star burst (8-ray)
      body = `<g transform="translate(12 12)" stroke="#fff" stroke-width="1.6" fill="none"><line x1="0" y1="-9" x2="0" y2="9"/><line x1="-9" y1="0" x2="9" y2="0"/><line x1="-6" y1="-6" x2="6" y2="6"/><line x1="-6" y1="6" x2="6" y2="-6"/></g>`;
      break;
    case 'BONUS':
      // concentric circles (target)
      body = `<g fill="none" stroke="#fff" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6" fill="#fff"/></g>`;
      break;
    case 'SPECIAL':
    default:
      // crosshatch (diag + anti-diag)
      body = `<path d="M-2 18 L18 -2 M-2 26 L26 -2 M-2 6 L26 34 M-2 -2 L26 26" stroke="#fff" stroke-width="1.2" fill="none" />`;
      break;
  }
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${W}' width='${W}' height='${W}'>` +
    body +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function _clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}

function _safeStr(v, max = 40) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[<>"'`]/g, '').slice(0, max);
  return s.length ? s : null;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:        true,
    autoActivate:   false,            // start hidden — player toggles via chip
    position:       'top-right',
    chipLabel:      'CB',
    chipFontSize:   11,
    patternOpacity: 0.45,
    blendMode:      'overlay',
    tierMap:        Object.freeze({
      // Vendor-neutral defaults — game can override per-symbol.
      // Standard slot-template codes:
      H1: 'HP', H2: 'HP', H3: 'HP', H4: 'HP', H5: 'HP',
      M1: 'MP', M2: 'MP', M3: 'MP', M4: 'MP', M5: 'MP',
      L1: 'LP', L2: 'LP', L3: 'LP', L4: 'LP', L5: 'LP', L6: 'LP',
      W:  'WILD', WILD: 'WILD',
      S:  'SCATTER', SCAT: 'SCATTER', SC: 'SCATTER',
      B:  'BONUS', BONUS: 'BONUS', BN: 'BONUS',
    }),
    persistKey:     'slot.cbPatterns',
    zIndex:         15,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.colorblindPatterns) || {};

  if (typeof m.enabled === 'boolean')      cfg.enabled = m.enabled;
  if (typeof m.autoActivate === 'boolean') cfg.autoActivate = m.autoActivate;

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  if (typeof m.blendMode === 'string' && BLEND_MODES.has(m.blendMode)) cfg.blendMode = m.blendMode;

  const chipLabel = _safeStr(m.chipLabel, 8);
  if (chipLabel) cfg.chipLabel = chipLabel;

  cfg.chipFontSize   = _clamp(m.chipFontSize,   BOUNDS.chipFontSize,   cfg.chipFontSize);
  cfg.patternOpacity = _clamp(m.patternOpacity, BOUNDS.patternOpacity, cfg.patternOpacity);
  cfg.zIndex         = _clamp(m.zIndex,         BOUNDS.zIndex,         cfg.zIndex);

  if (m.tierMap && typeof m.tierMap === 'object') {
    const merged = { ...cfg.tierMap };
    for (const [code, tier] of Object.entries(m.tierMap)) {
      if (typeof code !== 'string' || code.length === 0 || code.length > 12) continue;
      if (typeof tier === 'string' && TIER_SET.has(tier)) {
        merged[code] = tier;
      }
    }
    cfg.tierMap = Object.freeze(merged);
  }

  const persistKey = _safeStr(m.persistKey, 64);
  if (persistKey) cfg.persistKey = persistKey;

  return cfg;
}

function _positionStyle(pos) {
  const v  = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const h  = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
  const bV = 'calc(max(8px, env(safe-area-inset-bottom, 0px) + 8px))';
  const rH = 'calc(max(8px, env(safe-area-inset-right, 0px) + 8px))';
  switch (pos) {
    case 'top-left':     return `top: ${v}; left: ${h};`;
    case 'bottom-left':  return `bottom: ${bV}; left: ${h};`;
    case 'bottom-right': return `bottom: ${bV}; right: ${rH};`;
    case 'top-right':
    default:             return `top: ${v}; right: ${rH};`;
  }
}

export function emitColorblindPatternsCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  /* Inline data:image SVG patterns. Browser-cached after first paint. */
  const patternRules = TIERS.map(tier => {
    const uri = _patternURI(tier);
    return `  .symbol-cell[data-cb-tier="${tier}"]::before {
    background-image: url("${uri}");
  }`;
  }).join('\n');

  return `
  /* colorblindPatterns — Wave H4 (WCAG 2.2 SC 1.4.1) */
  .cb-chip {
    position: fixed;
    ${_positionStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    min-width: 44px;
    min-height: 44px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.65);
    color: #f2f2f2;
    font-size: ${cfg.chipFontSize}px;
    font-weight: 700;
    letter-spacing: 0.06em;
    border: 2px solid rgba(255, 255, 255, 0.18);
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: background-color 200ms ease, border-color 200ms ease;
  }
  .cb-chip[aria-checked="true"] {
    background: rgba(72, 213, 151, 0.85);
    color: #03110a;
    border-color: rgba(255, 255, 255, 0.65);
  }
  .cb-chip:focus-visible {
    outline: 2px solid #ffd84d;
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .cb-chip { transition: none; }
  }

  /* Per-tier ::before pattern overlay layer — body[data-cb-active="true"] gate.
   * The overlay is ONLY visible when player has activated the toggle, so the
   * default render is unchanged for non-CVD users. */
  body[data-cb-active="true"] .symbol-cell { position: relative; }
  body[data-cb-active="true"] .symbol-cell::before {
    content: "";
    position: absolute;
    inset: 0;
    background-repeat: repeat;
    background-size: 24px 24px;
    opacity: ${cfg.patternOpacity};
    mix-blend-mode: ${cfg.blendMode};
    pointer-events: none;
    border-radius: inherit;
  }
  body[data-cb-active="true"] .symbol-cell[data-cb-tier=""]::before,
  body[data-cb-active="true"] .symbol-cell:not([data-cb-tier])::before {
    /* no tier classification = no overlay (avoid pattern on empty cells) */
    background-image: none;
  }
${patternRules}
  `;
}

export function emitColorblindPatternsMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const checked = cfg.autoActivate ? 'true' : 'false';
  const label = (cfg.chipLabel || 'CB').replace(/[<>"'`]/g, '');
  return `<button id="cbPatternsChip" class="cb-chip" type="button"
    role="switch" aria-checked="${checked}"
    aria-label="Toggle colour-blind pattern overlay">${label}</button>`;
}

export function emitColorblindPatternsRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── colorblindPatterns BLOCK (disabled) ──────────────────────────── */
  window.__SLOT_CB_PATTERNS_ON__ = false;
`;
  }
  return `
  /* ── colorblindPatterns BLOCK — Wave H4 (WCAG 2.2 SC 1.4.1) ───────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var TIER_MAP = ${JSON.stringify(cfg.tierMap)};
    var PERSIST_KEY = ${JSON.stringify(cfg.persistKey)};
    var AUTO = ${JSON.stringify(cfg.autoActivate)};
    var TIER_SET = ${JSON.stringify(TIERS)};
    var validTiers = {};
    for (var i = 0; i < TIER_SET.length; i++) validTiers[TIER_SET[i]] = 1;

    function readPersisted() {
      try {
        var v = window.localStorage.getItem(PERSIST_KEY);
        if (v === '1') return true;
        if (v === '0') return false;
      } catch (_) { /* privacy mode */ }
      return null;
    }
    function writePersisted(on) {
      try { window.localStorage.setItem(PERSIST_KEY, on ? '1' : '0'); } catch (_) {}
    }

    var bootState = readPersisted();
    var active = bootState != null ? bootState : !!AUTO;
    window.__SLOT_CB_PATTERNS_ON__ = active;

    function applyBody() {
      if (typeof document === 'undefined' || !document.body) return;
      document.body.setAttribute('data-cb-active', active ? 'true' : 'false');
    }
    function decorateCell(cell) {
      if (!cell || cell.nodeType !== 1) return;
      var sym = cell.getAttribute('data-sym') || cell.getAttribute('data-symbol') || '';
      var tier = TIER_MAP[sym] || '';
      if (tier && validTiers[tier]) {
        cell.setAttribute('data-cb-tier', tier);
      } else {
        cell.setAttribute('data-cb-tier', '');
      }
    }
    function decorateAll() {
      if (typeof document === 'undefined') return;
      var cells = document.querySelectorAll('.symbol-cell');
      for (var i = 0; i < cells.length; i++) decorateCell(cells[i]);
    }

    function setActive(on, source) {
      var next = !!on;
      if (next === active) return;
      active = next;
      window.__SLOT_CB_PATTERNS_ON__ = active;
      writePersisted(active);
      applyBody();
      if (active) decorateAll();
      try { window.HookBus.emit('onCbPatternsToggle', { enabled: active, source: source || 'api' }); } catch (_) {}
    }

    /* Settings-panel integration handle — same API surface as turboMode. */
    window.colorblindPatternsOn  = function () { setActive(true, 'api'); };
    window.colorblindPatternsOff = function () { setActive(false, 'api'); };
    window.colorblindPatternsToggle = function () { setActive(!active, 'api'); };

    function bindChip() {
      var chip = document.getElementById('cbPatternsChip');
      if (!chip || chip.__bound) return;
      chip.__bound = true;
      chip.setAttribute('aria-checked', active ? 'true' : 'false');
      chip.addEventListener('click', function () {
        setActive(!active, 'chip');
        chip.setAttribute('aria-checked', active ? 'true' : 'false');
      });
    }

    /* Lifecycle decorate hooks. */
    window.HookBus.on('postSpin',        function () { if (active) decorateAll(); });
    window.HookBus.on('onTumbleStep',    function () { if (active) decorateAll(); });
    window.HookBus.on('onFsSpinResult',  function () { if (active) decorateAll(); });
    /* External toggle (e.g. settings panel) — keep chip aria + DOM in sync. */
    window.HookBus.on('onCbPatternsToggle', function (p) {
      var on = !!(p && p.enabled);
      if (on === active) return;
      /* External authority — call setActive WITHOUT re-emitting to avoid loop. */
      active = on;
      window.__SLOT_CB_PATTERNS_ON__ = active;
      writePersisted(active);
      applyBody();
      if (active) decorateAll();
      var chip = document.getElementById('cbPatternsChip');
      if (chip) chip.setAttribute('aria-checked', active ? 'true' : 'false');
    });

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { applyBody(); bindChip(); if (active) decorateAll(); });
      } else {
        applyBody(); bindChip(); if (active) decorateAll();
      }
    }
  })();
  `;
}
