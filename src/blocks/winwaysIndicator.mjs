import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/winwaysIndicator.mjs
 *
 * Wave B66 — Win-Ways Count Indicator block.
 *
 * Industry baseline: every "ways" game (243 / 1024 / 4096 / 7776 / 117 649
 * ways) displays a persistent label so the player knows the topology
 * they're playing. This block emits a small fixed-position chip near the
 * frame top-left that shows "1024 WAYS" + dynamic per-spin highlight when
 * a ways win lands.
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                    → safe defaults (disabled, no UI).
 *   resolveConfig(model)               → merge defaults with model.winwaysIndicator,
 *                                       auto-enable if model.waysEval present.
 *   emitWinwaysIndicatorCSS(cfg)       → CSS rules for the chip + flash anim.
 *   emitWinwaysIndicatorMarkup(cfg)    → host element with ARIA wiring.
 *   emitWinwaysIndicatorRuntime(cfg)   → runtime JS listens to onSpinResult,
 *                                       flashes if award > 0 ways-win.
 *
 * Lifecycle:
 *   subscribes:
 *     onSpinResult — when payload.kind === 'ways' OR payload.waysHits > 0,
 *                    bump highlight class for cfg.flashMs and update count.
 *   emits:
 *     (none — pure presenter; no downstream side-effects)
 *
 * a11y:
 *   - role="status" + aria-live="polite" on host so screen readers
 *     announce "Ways win — 1024" without preempting other speech.
 *   - aria-label restates the topology for non-visual users at load.
 *   - prefers-reduced-motion disables the flash transition.
 *
 * Vendor-neutral. No game-name strings, no studio identifiers.
 */

const WAYS_BOUNDS = {
  fontSizePx: [11, 22],   // Apple HIG floor 11
  flashMs:    [200, 1500],
  zIndex:     [10, 99],
};

function clamp(v, [lo, hi], fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function defaultConfig() {
  return Object.freeze({
    enabled:     false,         // explicit opt-in OR auto-enable via model.waysEval
    waysCount:   243,           // declared ways topology (display only)
    position:    'top-left',    // top-left | top-right | bottom-left | bottom-right
    labelTemplate: '{N} WAYS',  // {N} → waysCount
    fontSizePx:  12,
    bgColor:     'rgba(0,0,0,0.55)',
    fgColor:     '#f2f2f2',
    accentColor: '#c9a227',
    flashMs:     650,
    zIndex:      32,            // sits with fsProgressBar between modals (30) and chips (35)
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.winwaysIndicator || {};
  // Auto-enable if waysEval declared in GDD
  const autoEnable = !!model.waysEval;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (autoEnable) cfg.enabled = true;

  // Derive waysCount from waysEval if not overridden
  if (Number.isFinite(m.waysCount)) cfg.waysCount = Math.max(9, Math.floor(m.waysCount));
  else if (model.waysEval && Number.isFinite(model.waysEval.waysCount)) {
    cfg.waysCount = Math.max(9, Math.floor(model.waysEval.waysCount));
  }

  if (['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(m.position)) cfg.position = m.position;
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0) cfg.labelTemplate = m.labelTemplate;
  cfg.fontSizePx  = clamp(m.fontSizePx,  WAYS_BOUNDS.fontSizePx,  cfg.fontSizePx);
  cfg.flashMs     = clamp(m.flashMs,     WAYS_BOUNDS.flashMs,     cfg.flashMs);
  cfg.zIndex      = clamp(m.zIndex,      WAYS_BOUNDS.zIndex,      cfg.zIndex);
  if (typeof m.bgColor    === 'string') cfg.bgColor    = m.bgColor;
  if (typeof m.fgColor    === 'string') cfg.fgColor    = m.fgColor;
  if (typeof m.accentColor === 'string') cfg.accentColor = m.accentColor;
  return cfg;
}

export function emitWinwaysIndicatorCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const pos = positionStyle(cfg.position);
  return `
  /* winwaysIndicator — Wave B66 */
  .winways-chip {
    position: fixed;
    ${pos}
    z-index: ${cfg.zIndex};
    padding: 4px 10px;
    border-radius: 999px;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1.4;
    pointer-events: none;
    transition: background ${cfg.flashMs}ms ease-out, color ${cfg.flashMs}ms ease-out;
  }
  .winways-chip[data-flash="true"] {
    background: ${cfg.accentColor};
    color: #000;
  }
  @media (prefers-reduced-motion: reduce) {
    .winways-chip {
      transition: none;
    }
  }
  `;
}

function positionStyle(pos) {
  const inset = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const insetH = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
  switch (pos) {
    case 'top-right':    return `top: ${inset}; right: ${insetH};`;
    case 'bottom-left':  return `bottom: ${inset}; left: ${insetH};`;
    case 'bottom-right': return `bottom: ${inset}; right: ${insetH};`;
    case 'top-left':
    default:             return `top: ${inset}; left: ${insetH};`;
  }
}

export function emitWinwaysIndicatorMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const label = String(cfg.labelTemplate || '{N} WAYS').replace('{N}', String(cfg.waysCount));
  return tagBlockMarkup(`<div id="winwaysChip" class="winways-chip" role="status" aria-live="polite" aria-label="${label}">${label}</div>`, 'winwaysIndicator');
}

export function emitWinwaysIndicatorRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  (function(){
    if (typeof window === 'undefined' || !window.HookBus) return;
    var chip = document.getElementById('winwaysChip');
    if (!chip) return;
    var flashMs = ${cfg.flashMs};
    var resetTimer = null;

    HookBus.on('onSpinResult', function (p) {
      if (!p) return;
      var hit = (p.kind === 'ways') || (Number(p.waysHits) > 0) || (Number(p.waysWins) > 0);
      if (!hit) return;
      chip.setAttribute('data-flash', 'true');
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(function () {
        chip.setAttribute('data-flash', 'false');
      }, flashMs);
    });

    // Always reset on preSpin so the chip is calm at the start of the next round.
    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('preSpin', function () {
      chip.setAttribute('data-flash', 'false');
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
    }) : void 0);
  })();
  `;
}
