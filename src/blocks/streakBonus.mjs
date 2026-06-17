/**
 * src/blocks/streakBonus.mjs
 *
 * Wave H25 — Streak Bonus (N consecutive wins trigger bonus).
 *
 * Industry baseline (vendor-neutral):
 *   Some slots reward consecutive winning spins with a bonus (free spins,
 *   multiplier bump, jackpot key). This block owns the streak counter +
 *   threshold detection + bonus announcement. Strictly presentation +
 *   counting — does not execute the bonus itself.
 *
 * @module streakBonus
 */

const REWARD_KINDS = new Set(['freeSpins', 'multBump', 'jackpotKey', 'cashBonus']);
const BOUNDS = Object.freeze({
  threshold:   [2, 99],
  fontSizePx:  [10, 22],
  pulseMs:     [120, 1500],
  zIndex:      [10, 99],
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
    threshold:      5,
    rewardKind:     'freeSpins',
    fontSizePx:     12,
    pulseMs:        320,
    zIndex:         33,
    bgColor:        'rgba(0,0,0,0.55)',
    fgColor:        '#f2f2f2',
    fullColor:      '#48d597',
    labelTemplate:  'STREAK {N}/{M}',
    resetAtThreshold: true,
    resetOnFsEnd:   true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.streakBonus) || {};
  const auto = !!model.streakBonus;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.threshold  = _clamp(m.threshold,  BOUNDS.threshold,  cfg.threshold);
  cfg.fontSizePx = _clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.pulseMs    = _clamp(m.pulseMs,    BOUNDS.pulseMs,    cfg.pulseMs);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);

  if (typeof m.rewardKind === 'string' && REWARD_KINDS.has(m.rewardKind)) cfg.rewardKind = m.rewardKind;
  cfg.bgColor   = _safe(m.bgColor,   64, cfg.bgColor);
  cfg.fgColor   = _safe(m.fgColor,   32, cfg.fgColor);
  cfg.fullColor = _safe(m.fullColor, 48, cfg.fullColor);
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0 && m.labelTemplate.length <= 48) {
    cfg.labelTemplate = _safe(m.labelTemplate, 48, cfg.labelTemplate);
  }
  if (typeof m.resetAtThreshold === 'boolean') cfg.resetAtThreshold = m.resetAtThreshold;
  if (typeof m.resetOnFsEnd === 'boolean')     cfg.resetOnFsEnd     = m.resetOnFsEnd;
  return cfg;
}

export function emitStreakBonusCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* streakBonus — Wave H25 */
  .streak-chip {
    position: fixed;
    top: calc(max(8px, env(safe-area-inset-top, 0px) + 8px));
    left: 50%;
    transform: translateX(-50%);
    z-index: ${cfg.zIndex};
    padding: 5px 12px 6px;
    border-radius: 999px;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.06em;
    pointer-events: none;
    display: none;
    border: 2px solid rgba(255,255,255,0.18);
  }
  .streak-chip[data-visible="true"] { display: inline-block; }
  .streak-chip[data-full="true"] {
    color: #03110a;
    background: ${cfg.fullColor};
    animation: streak-full-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes streak-full-pulse {
    0%   { transform: translateX(-50%) scale(1.0); }
    50%  { transform: translateX(-50%) scale(1.15); }
    100% { transform: translateX(-50%) scale(1.0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .streak-chip[data-full="true"] { animation: none; }
  }
  `;
}

export function emitStreakBonusMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const label = String(cfg.labelTemplate).replace('{N}', '0').replace('{M}', String(cfg.threshold));
  return `<div id="streakChip" class="streak-chip" role="status" aria-live="polite" aria-label="Streak counter" data-visible="false" data-full="false" data-value="0">${label}</div>`;
}

export function emitStreakBonusRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── streakBonus BLOCK — Wave H25 ─────────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var THRESH = ${cfg.threshold};
    var KIND = ${JSON.stringify(cfg.rewardKind)};
    var TEMPLATE = ${JSON.stringify(cfg.labelTemplate)};
    var RESET_THRESH = ${JSON.stringify(cfg.resetAtThreshold)};
    var RESET_FS_END = ${JSON.stringify(cfg.resetOnFsEnd)};
    var PULSE = ${cfg.pulseMs};

    var streak = 0;
    var chip = (typeof document !== 'undefined') ? document.getElementById('streakChip') : null;

    function render() {
      var v = Math.max(0, Math.min(THRESH, streak | 0));
      var full = v >= THRESH;
      if (chip) {
        chip.textContent = TEMPLATE.replace('{N}', String(v)).replace('{M}', String(THRESH));
        chip.setAttribute('data-value', String(v));
        chip.setAttribute('data-full', full ? 'true' : 'false');
        chip.setAttribute('data-visible', v > 0 ? 'true' : 'false');
      }
    }
    function bump(source) {
      var from = streak | 0;
      var to = Math.min(THRESH, from + 1);
      if (to === from) return;
      streak = to;
      try { window.HookBus.emit('onStreakBump', { from: from, to: to, threshold: THRESH, source: source || 'auto' }); } catch (_) {}
      render();
      if (to >= THRESH) {
        try { window.HookBus.emit('onStreakBonusEarned', { threshold: THRESH, kind: KIND, source: source || 'auto' }); } catch (_) {}
        if (RESET_THRESH) setTimeout(function () { reset('atThreshold'); }, PULSE + 240);
      }
    }
    function reset(reason) {
      var was = streak;
      streak = 0;
      render();
      if (was > 0) try { window.HookBus.emit('onStreakReset', { reason: reason || 'manual' }); } catch (_) {}
    }

    window.HookBus.on('onSpinResult', function (p) {
      var win = p ? Number(p.award || p.win || 0) : 0;
      if (win > 0) bump('onSpinResult');
      else if (streak > 0) reset('lossSpin');
    });
    window.HookBus.on('onFsEnd', function () { if (RESET_FS_END) reset('onFsEnd'); });

    /* Public API */
    window.streakBonusBump  = function () { bump('api'); };
    window.streakBonusReset = function () { reset('api'); };
    window.streakBonusGet   = function () { return { streak: streak, threshold: THRESH, kind: KIND }; };

    render();
  })();
  `;
}
