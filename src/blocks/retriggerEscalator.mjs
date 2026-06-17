/**
 * src/blocks/retriggerEscalator.mjs
 *
 * Wave H30 — Retrigger Escalator (multi-tier FS retrigger reward ladder).
 *
 * Industry baseline (vendor-neutral):
 *   Different from `superchargedFs` (multiplier ladder per retrigger):
 *   this block escalates the number of FS *granted* on retrigger based
 *   on consecutive-retrigger position in a configured tier ladder.
 *
 *     Tier 1 retrigger → +5 FS
 *     Tier 2 retrigger → +8 FS
 *     Tier 3 retrigger → +12 FS
 *     Tier 4+ (max)    → +20 FS
 *
 *   Pure presenter — listens to onFsRetrigger (owned by superchargedFs),
 *   computes tier, announces escalation. Does not mutate FS counts itself.
 *
 * @module retriggerEscalator
 */

const BOUNDS = Object.freeze({
  fontSizePx: [11, 24],
  pulseMs:    [120, 1500],
  zIndex:     [10, 99],
  tierLen:    [2, 12],
});

function _clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}
function _safe(v, max, fb) {
  if (typeof v !== 'string') return fb;
  const s = v.replace(/[<>"'`]/g, '').slice(0, max);
  return s.length ? s : fb;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:        false,
    fsLadder:       Object.freeze([5, 8, 12, 20]),
    fontSizePx:     13,
    pulseMs:        540,
    zIndex:         36,
    bgColor:        'rgba(0,0,0,0.65)',
    fgColor:        '#ffd84d',
    activeBg:       '#ffd84d',
    activeFg:       '#03110a',
    labelTemplate:  '+{N} FS (tier {T})',
    hideAtBase:     true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.retriggerEscalator) || {};
  const auto = !!model.retriggerEscalator;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.fontSizePx = _clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.pulseMs    = _clamp(m.pulseMs,    BOUNDS.pulseMs,    cfg.pulseMs);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);

  cfg.bgColor   = _safe(m.bgColor,   64, cfg.bgColor);
  cfg.fgColor   = _safe(m.fgColor,   32, cfg.fgColor);
  cfg.activeBg  = _safe(m.activeBg,  48, cfg.activeBg);
  cfg.activeFg  = _safe(m.activeFg,  32, cfg.activeFg);

  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0 && m.labelTemplate.length <= 64) {
    cfg.labelTemplate = _safe(m.labelTemplate, 64, cfg.labelTemplate);
  }
  if (typeof m.hideAtBase === 'boolean') cfg.hideAtBase = m.hideAtBase;

  if (Array.isArray(m.fsLadder)) {
    var ladder = m.fsLadder
      .map(n => Number(n))
      .filter(n => Number.isFinite(n) && n >= 1 && n <= 999);
    if (ladder.length >= BOUNDS.tierLen[0] && ladder.length <= BOUNDS.tierLen[1]) {
      var clean = [];
      for (var i = 0; i < ladder.length; i++) {
        if (clean.length === 0 || ladder[i] >= clean[clean.length - 1]) clean.push(ladder[i]);
      }
      if (clean.length >= 2) cfg.fsLadder = Object.freeze(clean);
    }
  }
  return cfg;
}

export function emitRetriggerEscalatorCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* retriggerEscalator — Wave H30 */
  .re-badge {
    position: fixed;
    top: calc(max(8px, env(safe-area-inset-top, 0px) + 8px));
    right: calc(max(8px, env(safe-area-inset-right, 0px) + 8px));
    z-index: ${cfg.zIndex};
    padding: 5px 12px;
    border-radius: 999px;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.06em;
    pointer-events: none;
    display: none;
    border: 2px solid rgba(255,255,255,0.2);
  }
  .re-badge[data-visible="true"] { display: inline-block; }
  .re-badge[data-escalating="true"] {
    background: ${cfg.activeBg};
    color: ${cfg.activeFg};
    animation: re-badge-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes re-badge-pulse {
    0%   { transform: scale(1.0); }
    50%  { transform: scale(1.18); }
    100% { transform: scale(1.0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .re-badge { animation: none; }
  }
  `;
}

export function emitRetriggerEscalatorMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="reBadge" class="re-badge" role="status" aria-live="polite" aria-label="Retrigger escalator" data-visible="false" data-escalating="false" data-tier="0">+0 FS</div>`;
}

export function emitRetriggerEscalatorRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── retriggerEscalator BLOCK — Wave H30 ──────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var LADDER = ${JSON.stringify(cfg.fsLadder)};
    var TEMPLATE = ${JSON.stringify(cfg.labelTemplate)};
    var PULSE = ${cfg.pulseMs};
    var HIDE_BASE = ${JSON.stringify(cfg.hideAtBase)};

    var tier = 0;     /* 0 = pre-first retrigger */
    var totalFsAdded = 0;
    var badge = (typeof document !== 'undefined') ? document.getElementById('reBadge') : null;

    function currentFs() {
      if (tier <= 0) return 0;
      return LADDER[Math.min(LADDER.length - 1, tier - 1)] || 0;
    }
    function render(escalating) {
      if (!badge) return;
      var fs = currentFs();
      var label = TEMPLATE.replace('{N}', String(fs)).replace('{T}', String(tier));
      badge.textContent = label;
      badge.setAttribute('data-tier', String(tier));
      badge.setAttribute('data-fs', String(fs));
      var visible = !(HIDE_BASE && tier === 0);
      badge.setAttribute('data-visible', visible ? 'true' : 'false');
      if (escalating) {
        badge.setAttribute('data-escalating', 'true');
        setTimeout(function () { badge && badge.setAttribute('data-escalating', 'false'); }, PULSE + 60);
      }
    }
    function escalate(source) {
      var oldTier = tier;
      tier++;
      var clampedTier = Math.min(LADDER.length, tier);
      var fs = LADDER[clampedTier - 1] || 0;
      totalFsAdded += fs;
      render(true);
      try { window.HookBus.emit('onRetriggerEscalated', { fromTier: oldTier, toTier: clampedTier, fsAdded: fs, totalFsAdded: totalFsAdded, source: source || 'auto' }); } catch (_) {}
    }
    function reset(reason) {
      var hadTier = tier;
      tier = 0;
      totalFsAdded = 0;
      render(false);
      if (hadTier > 0) try { window.HookBus.emit('onRetriggerEscalatorReset', { reason: reason || 'auto' }); } catch (_) {}
    }

    window.HookBus.on('onFsTrigger',   function () { reset('onFsTrigger'); });
    window.HookBus.on('onFsRetrigger', function () { escalate('onFsRetrigger'); });
    window.HookBus.on('onFsEnd',       function () { reset('onFsEnd'); });

    /* Public API */
    window.retriggerEscalatorStep  = function () { escalate('api'); };
    window.retriggerEscalatorReset = function () { reset('api'); };
    window.retriggerEscalatorGet   = function () { return { tier: tier, fs: currentFs(), totalFsAdded: totalFsAdded }; };
  })();
  `;
}
