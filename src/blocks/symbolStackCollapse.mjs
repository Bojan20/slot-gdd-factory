/**
 * src/blocks/symbolStackCollapse.mjs
 *
 * Wave W47.S18 — B75 · symbolStackCollapse block.
 *
 * Full-column "stack drop" celebration that fires when a tumble step
 * clears an entire reel of the same symbol (or any clear that meets
 * a configurable threshold). Renders a vertical column overlay that
 * flashes, scales the cleared symbol's glyph briefly, then collapses
 * downward off-screen. Purely presentational — the math layer already
 * settled the win; this block exists to give the player a clear
 * "you just cleared a whole reel" moment.
 *
 * Industry baseline: ubiquitous in cluster-pays / cascade slots where
 * symbol-burst feedback is part of the core feel. Vendor-neutral
 * baseline: 5-rung column overlay, 1200ms cycle, full-bleed inline
 * with the reel area, RGB-driven flash + collapse keyframes.
 *
 * GDD knobs (consumed from model.symbolStackCollapse):
 *   enabled            boolean                              (default false)
 *   triggerMode        'same_symbol' | 'full_column'
 *                      | 'any_clear'                         (default 'same_symbol')
 *   minStackHeight     number — min cleared cells per reel
 *                      to trigger ('same_symbol' / 'full_column')
 *                                                            (default 3)
 *   minClearCount      number — min cleared cells total
 *                      ('any_clear' mode)                   (default 6)
 *   durationMs         number — total cycle                 (default 1200)
 *   autoCloseMs        number — hold after collapse         (default 400)
 *   flashColor         'r,g,b' — flash tint                 (default '255,235,150')
 *   accentColor        'r,g,b' — column edge accent         (default '255,200,80')
 *   showLabel          boolean — text overlay during flash  (default true)
 *   labelTemplate      string — accepts {N} (cleared count)
 *                      and {S} (symbol code)                (default '+{N} {S}')
 *   haptic             boolean — vibrate on collapse        (default false)
 *
 * Public API:
 *   defaultConfig()                              → safe defaults
 *   resolveConfig(model)                         → merge + clamp
 *   emitSymbolStackCollapseCSS(cfg)              → CSS string
 *   emitSymbolStackCollapseMarkup(cfg)           → HTML string
 *   emitSymbolStackCollapseRuntime(cfg)          → IIFE runtime
 *
 * Lifecycle (Runtime):
 *   listens : onTumbleStep — inspects payload for cleared cells +
 *             per-reel grouping; threshold-gated by triggerMode.
 *   emits   : onStackCollapseStart { reelIndex, cleared, symbol, source }
 *             onStackCollapseEnd   { reelIndex, cleared, symbol, reason }
 *
 * Accessibility:
 *   • role="status" + aria-live="polite" so screen readers announce
 *     the column clear naturally.
 *   • aria-label kept up-to-date as label text changes.
 *   • prefers-reduced-motion: reduce → animation: none, single 200ms
 *     opacity flash instead of column drop + scale + flash.
 *   • Apple HIG 11px font-size floor on label.
 *
 * Performance budget:
 *   • DOM: 1 host + 1 flash overlay + 1 label (≤3 nodes).
 *   • CSS animations on transform + opacity only (GPU).
 *   • No frame loop, no canvas.
 *   • Re-entrant: collapseToken cancels prior in-flight reveals cleanly.
 *
 * Vendor-neutral. No game / studio strings.
 */

const TRIGGER_MODES = Object.freeze(['same_symbol', 'full_column', 'any_clear']);

const DEFAULTS = Object.freeze({
  enabled:         false,
  triggerMode:     'same_symbol',
  minStackHeight:  3,
  minClearCount:   6,
  durationMs:      1200,
  autoCloseMs:     400,
  flashColor:      '255,235,150',
  accentColor:     '255,200,80',
  showLabel:       true,
  labelTemplate:   '+{N} {S}',
  haptic:          false,
});

const BOUNDS = Object.freeze({
  minStackHeight: { min: 2,   max: 12,    integer: true },
  minClearCount:  { min: 2,   max: 99,    integer: true },
  durationMs:     { min: 300, max: 6000,  integer: true },
  autoCloseMs:    { min: 100, max: 4000,  integer: true },
});

export function defaultConfig() {
  /* Mutable fresh copy — caller may spread/mutate.
     DEFAULTS itself stays frozen as single source of truth.
     Group AE CRITICAL fix 17.06.2026 — removed top-level freeze. */
  return { ...DEFAULTS };
}

function isValidRgb(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.symbolStackCollapse) || {};

  if (src.enabled != null) cfg.enabled = !!src.enabled;

  if (typeof src.triggerMode === 'string' && TRIGGER_MODES.includes(src.triggerMode)) {
    cfg.triggerMode = src.triggerMode;
  }
  if (isValidRgb(src.flashColor))  cfg.flashColor  = src.flashColor;
  if (isValidRgb(src.accentColor)) cfg.accentColor = src.accentColor;
  if (typeof src.haptic === 'boolean')    cfg.haptic    = src.haptic;
  if (typeof src.showLabel === 'boolean') cfg.showLabel = src.showLabel;
  if (typeof src.labelTemplate === 'string' && src.labelTemplate.length > 0 && src.labelTemplate.length <= 48) {
    cfg.labelTemplate = src.labelTemplate;
  }

  for (const key of Object.keys(BOUNDS)) {
    const v = src[key];
    const b = BOUNDS[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= b.min && v <= b.max) {
      cfg[key] = b.integer ? Math.floor(v) : v;
    }
  }

  /* Auto-enable: any cluster / cascade-friendly feature kind opts in.
     Stays opt-out via explicit enabled:false. */
  const features = Array.isArray(model.features) ? model.features : [];
  const hasStackKind = features.some(f =>
    typeof f === 'object' && f && (
      f.kind === 'stack_collapse' ||
      f.kind === 'mega_collapse' ||
      f.kind === 'full_reel_burst' ||
      f.kind === 'symbol_stack'
    )
  );
  const hasCascade = !!(model.tumble && model.tumble.enabled) ||
                     !!(model.topology && model.topology.cascade && model.topology.cascade.enabled);

  if (hasStackKind || hasCascade) {
    if (src.enabled !== false) cfg.enabled = true;
  }

  return cfg;
}

export function emitSymbolStackCollapseCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── symbolStackCollapse block — emitted by src/blocks/symbolStackCollapse.mjs ─── */
.stack-collapse {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  pointer-events: none;
  display: none;
  z-index: 88;
}
.stack-collapse[data-active="true"] { display: block; }
.stack-collapse .sc-flash {
  position: absolute;
  inset: 0;
  border-radius: 6px;
  background: linear-gradient(180deg,
    rgba(${cfg.flashColor}, 0.40) 0%,
    rgba(${cfg.flashColor}, 0.18) 60%,
    rgba(${cfg.flashColor}, 0.05) 100%);
  border-left: 2px solid rgba(${cfg.accentColor}, 0.85);
  border-right: 2px solid rgba(${cfg.accentColor}, 0.85);
  box-shadow: 0 0 18px rgba(${cfg.accentColor}, 0.55) inset,
              0 0 28px rgba(${cfg.flashColor}, 0.35);
  opacity: 0;
  transform-origin: 50% 0;
  will-change: transform, opacity;
}
.stack-collapse[data-active="true"] .sc-flash {
  animation: scFlash ${cfg.durationMs}ms cubic-bezier(.22, .61, .36, 1) forwards;
}
.stack-collapse .sc-label {
  position: absolute;
  left: 50%;
  top: 12%;
  transform: translate(-50%, 0);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7),
               0 0 12px rgba(${cfg.flashColor}, 0.65);
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  pointer-events: none;
  white-space: nowrap;
}
.stack-collapse[data-active="true"] .sc-label {
  animation: scLabel ${Math.max(300, cfg.durationMs - 200)}ms ease-out forwards;
}
@keyframes scFlash {
  0%   { opacity: 0;    transform: scaleY(0.1)  translateY(-4%); }
  18%  { opacity: 0.95; transform: scaleY(1.04) translateY(0%); }
  55%  { opacity: 0.9;  transform: scaleY(1)    translateY(0%); }
  100% { opacity: 0;    transform: scaleY(0.65) translateY(28%); }
}
@keyframes scLabel {
  0%   { opacity: 0; transform: translate(-50%, 4px); }
  20%  { opacity: 1; transform: translate(-50%, 0); }
  85%  { opacity: 1; transform: translate(-50%, 0); }
  100% { opacity: 0; transform: translate(-50%, -6px); }
}
@media (prefers-reduced-motion: reduce) {
  /* Hard motion kill — no scale, no collapse, no translate.
     Pure opacity flash preserves the celebration cue without
     vestibular load. */
  .stack-collapse[data-active="true"] .sc-flash,
  .stack-collapse[data-active="true"] .sc-label {
    animation: none;
    transform: translate(-50%, 0);
    transition: opacity 220ms ease-out;
  }
  .stack-collapse[data-active="true"] .sc-flash  { opacity: 0.65; transform: none; }
  .stack-collapse[data-active="true"] .sc-label  { opacity: 1; }
  .stack-collapse[data-active="false"] .sc-flash,
  .stack-collapse[data-active="false"] .sc-label { opacity: 0; }
}
@media (max-width: 480px) {
  .stack-collapse .sc-label { font-size: 11px; padding: 3px 8px; }
}
`;
}

export function emitSymbolStackCollapseMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="symbolStackCollapse" class="stack-collapse" data-active="false" role="status" aria-live="polite" aria-label="Symbol stack collapse" aria-hidden="true">
    <div class="sc-flash" aria-hidden="true"></div>
    <div class="sc-label">&nbsp;</div>
  </div>`;
}

export function emitSymbolStackCollapseRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';

  /* Pre-compute trigger threshold check fragment — single-binding,
     dead-branch elimination. */
  const triggerCfg = JSON.stringify({
    triggerMode:    cfg.triggerMode,
    minStackHeight: cfg.minStackHeight,
    minClearCount:  cfg.minClearCount,
  });

  let triggerCheck;
  switch (cfg.triggerMode) {
    case 'full_column':
      /* Strictest: needs cells equal to full reel height (heuristic: any
         reelHeight ≥ minStackHeight × 1.5 OR p.fullColumn === true flag). */
      triggerCheck = `      if (cleared.length < SC_CFG.minStackHeight) return;
      if (perReel.length === 0) return;
      var hit = perReel.find(function (r) {
        if (r.full === true) return true;
        if (Number.isFinite(r.rowSpan) && r.count >= r.rowSpan) return true;
        return false;
      });
      if (!hit) return;`;
      break;
    case 'any_clear':
      triggerCheck = `      if (cleared.length < SC_CFG.minClearCount) return;
      var hit = perReel[0] || { reelIndex: 0, count: cleared.length, symbol: null };`;
      break;
    case 'same_symbol':
    default:
      /* Default — at least one reel cleared ≥ minStackHeight cells of the
         same symbol. perReel groups cleared cells by reelIndex+symbol. */
      triggerCheck = `      var hit = null;
      for (var i = 0; i < perReel.length; i++) {
        if (perReel[i].count >= SC_CFG.minStackHeight) { hit = perReel[i]; break; }
      }
      if (!hit) return;`;
      break;
  }

  return `/* ─── symbolStackCollapse runtime — emitted by src/blocks/symbolStackCollapse.mjs ─── */
(function _stackCollapseRuntime() {
  var SC_CFG          = ${triggerCfg};
  var SC_TEMPLATE     = ${JSON.stringify(cfg.labelTemplate)};
  var SC_SHOW_LABEL   = ${cfg.showLabel ? 'true' : 'false'};
  var SC_DURATION_MS  = ${cfg.durationMs};
  var SC_AUTOCLOSE_MS = ${cfg.autoCloseMs};
  var SC_HAPTIC       = ${cfg.haptic ? 'true' : 'false'};
  var SC_TOKEN        = 0;
  var SC_TIMERS       = [];

  function _scHost() {
    return (typeof document !== 'undefined') ? document.getElementById('symbolStackCollapse') : null;
  }

  function _scClearTimers() {
    for (var i = 0; i < SC_TIMERS.length; i++) {
      try { clearTimeout(SC_TIMERS[i]); } catch (_) {}
    }
    SC_TIMERS = [];
  }

  /* Compute the host's left/width to land over the cleared reel column.
     Falls back to the play-area's full width when reel geometry is not
     available (so the cue never disappears silently). */
  function _scLayoutForReel(host, reelIndex) {
    if (!host) return;
    var area = host.parentElement;
    if (!area) return;
    var areaRect = area.getBoundingClientRect();
    var totalReels = (typeof window !== 'undefined' && Array.isArray(window.RECT_REELS))
      ? window.RECT_REELS.length : null;
    if (!totalReels || !Number.isFinite(reelIndex) || reelIndex < 0 || reelIndex >= totalReels) {
      host.style.left  = '0px';
      host.style.width = areaRect.width + 'px';
      return;
    }
    var reelW = areaRect.width / totalReels;
    host.style.left  = (reelW * reelIndex) + 'px';
    host.style.width = reelW + 'px';
  }

  function _scLabelFor(hit) {
    if (!SC_SHOW_LABEL) return '';
    var n = hit && Number.isFinite(hit.count) ? hit.count : 0;
    var s = hit && typeof hit.symbol === 'string' ? hit.symbol : '';
    return String(SC_TEMPLATE)
      .replace('{N}', String(n))
      .replace('{S}', s);
  }

  /* Group a flat cleared-cells array into per-reel + per-symbol buckets.
     Accepts payloads of shape: [{ col, row, symbol }] OR
     [{ reelIndex, rowIndex, symbol }]. Defensive against missing fields. */
  function _scGroupByReel(cleared) {
    var groups = {};
    if (!Array.isArray(cleared)) return [];
    for (var i = 0; i < cleared.length; i++) {
      var c = cleared[i];
      if (!c || typeof c !== 'object') continue;
      var col = (c.col != null) ? Number(c.col)
              : (c.reelIndex != null) ? Number(c.reelIndex) : NaN;
      if (!Number.isFinite(col)) continue;
      var sym = (typeof c.symbol === 'string') ? c.symbol : '?';
      var key = col + '\x00' + sym;
      if (!groups[key]) groups[key] = { reelIndex: col, symbol: sym, count: 0, full: !!c.fullColumn, rowSpan: c.rowSpan };
      groups[key].count++;
      if (c.fullColumn === true) groups[key].full = true;
      if (Number.isFinite(c.rowSpan) && (!groups[key].rowSpan || c.rowSpan > groups[key].rowSpan)) {
        groups[key].rowSpan = c.rowSpan;
      }
    }
    var out = [];
    for (var k in groups) {
      if (Object.prototype.hasOwnProperty.call(groups, k)) out.push(groups[k]);
    }
    /* Largest cleared-count per reel first, so the highest-impact column
       takes the cue. */
    out.sort(function (a, b) { return b.count - a.count; });
    return out;
  }

  function _scShow(host, hit) {
    if (!host) return;
    var labelEl = host.querySelector('.sc-label');
    var token = ++SC_TOKEN;
    _scClearTimers();
    _scLayoutForReel(host, hit ? hit.reelIndex : -1);
    if (labelEl) labelEl.textContent = _scLabelFor(hit);
    host.dataset.active = 'true';
    host.setAttribute('aria-hidden', 'false');
    if (hit) {
      host.setAttribute('aria-label',
        'Stack collapse on reel ' + (hit.reelIndex + 1) +
        ' clearing ' + hit.count + (hit.symbol ? (' ' + hit.symbol) : '') + ' symbol(s)');
    }

    if (typeof HookBus !== 'undefined' && hit) {
      try { HookBus.emit('onStackCollapseStart', {
        reelIndex: hit.reelIndex,
        cleared:   hit.count,
        symbol:    hit.symbol,
        source:    SC_CFG.triggerMode,
      }); } catch (_) {}
    }
    if (SC_HAPTIC && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(35); } catch (_) {}
    }

    SC_TIMERS.push(setTimeout(function () {
      if (token !== SC_TOKEN) return;
      host.dataset.active = 'false';
      host.setAttribute('aria-hidden', 'true');
      if (typeof HookBus !== 'undefined') {
        try { HookBus.emit('onStackCollapseEnd', {
          reelIndex: hit ? hit.reelIndex : -1,
          cleared:   hit ? hit.count : 0,
          symbol:    hit ? hit.symbol : null,
          reason:    'auto',
        }); } catch (_) {}
      }
    }, SC_DURATION_MS + SC_AUTOCLOSE_MS));
  }

  if (typeof window !== 'undefined') {
    window.fireSymbolStackCollapse = function (cleared) {
      var host = _scHost();
      if (!host) return;
      var perReel = _scGroupByReel(cleared || []);
      var hit = perReel[0] || null;
      _scShow(host, hit);
    };
  }

  if (typeof HookBus !== 'undefined') {
    HookBus.on('onTumbleStep', function (evt) {
      var host = _scHost();
      if (!host) return;
      var cleared = (evt && (evt.cleared || evt.clearedCells || evt.removed)) || [];
      if (!Array.isArray(cleared) || cleared.length === 0) return;
      var perReel = _scGroupByReel(cleared);
${triggerCheck}
      _scShow(host, hit);
    });
  }
})();
`;
}
