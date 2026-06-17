/**
 * src/blocks/nearMissTease.mjs
 *
 * Wave H22 — Near-Miss Tease (visual "almost won" highlight).
 *
 * Industry baseline (vendor-neutral):
 *   When a high-value combination falls one cell short (e.g. 2 scatter on
 *   reels 1+2 with a non-scatter near the trigger zone), modern slots
 *   tease the player with a brief highlight on the "almost" cells. This
 *   block owns that tease. Strictly presentation — no math impact.
 *
 *   Different from `anticipation` (which runs DURING reel landing) — this
 *   block fires AFTER settle when the post-spin result is detectable.
 *
 * @module nearMissTease
 */

const BOUNDS = Object.freeze({
  teaseMs:        [200, 3000],
  zIndex:         [10, 99],
  scatterDeficit: [1, 5],
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
    enabled:         false,
    teaseMs:         1200,
    zIndex:          16,
    glowColor:       'rgba(255,170,80,0.65)',
    scatterSymbol:   'S',
    scatterTrigger:  3,            /* full trigger count */
    scatterDeficit:  1,            /* tease when scatterCount = trigger - deficit */
    skipDuringFs:    true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.nearMissTease) || {};
  const auto = !!model.nearMissTease;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.teaseMs        = _clamp(m.teaseMs,        BOUNDS.teaseMs,        cfg.teaseMs);
  cfg.zIndex         = _clamp(m.zIndex,         BOUNDS.zIndex,         cfg.zIndex);
  cfg.scatterDeficit = _clamp(m.scatterDeficit, BOUNDS.scatterDeficit, cfg.scatterDeficit);

  if (Number.isFinite(m.scatterTrigger)) cfg.scatterTrigger = Math.max(2, Math.min(12, m.scatterTrigger | 0));
  cfg.glowColor     = _safe(m.glowColor, 48, cfg.glowColor);
  cfg.scatterSymbol = _safe(m.scatterSymbol, 12, cfg.scatterSymbol);
  if (typeof m.skipDuringFs === 'boolean') cfg.skipDuringFs = m.skipDuringFs;
  return cfg;
}

export function emitNearMissTeaseCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* nearMissTease — Wave H22 */
  .symbol-cell[data-near-miss="true"] {
    position: relative;
  }
  .symbol-cell[data-near-miss="true"]::after {
    content: "";
    position: absolute;
    inset: -2px;
    box-shadow: 0 0 20px 4px ${cfg.glowColor}, inset 0 0 16px ${cfg.glowColor};
    border-radius: inherit;
    z-index: ${cfg.zIndex};
    pointer-events: none;
    animation: near-miss-tease ${cfg.teaseMs}ms ease-out;
  }
  @keyframes near-miss-tease {
    0%   { opacity: 0.0; }
    30%  { opacity: 1.0; }
    70%  { opacity: 1.0; }
    100% { opacity: 0.0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .symbol-cell[data-near-miss="true"]::after { animation: none; opacity: 0.5; }
  }
  `;
}

export function emitNearMissTeaseMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<!-- nearMissTease decorates .symbol-cell[data-near-miss="true"] at runtime -->`;
}

export function emitNearMissTeaseRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── nearMissTease BLOCK — Wave H22 ───────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var TEASE = ${cfg.teaseMs};
    var SCATTER_SYM = ${JSON.stringify(cfg.scatterSymbol)};
    var SCATTER_TRIG = ${cfg.scatterTrigger};
    var DEFICIT = ${cfg.scatterDeficit};
    var SKIP_FS = ${JSON.stringify(cfg.skipDuringFs)};
    var inFs = false;

    function clearAll(reason) {
      if (typeof document === 'undefined') return;
      var cells = document.querySelectorAll('.symbol-cell[data-near-miss="true"]');
      var n = cells.length;
      for (var i = 0; i < cells.length; i++) cells[i].setAttribute('data-near-miss', 'false');
      if (n > 0) try { window.HookBus.emit('onNearMissCleared', { reason: reason || 'auto' }); } catch (_) {}
    }
    function detectAndTease(source) {
      if (typeof document === 'undefined') return;
      if (SKIP_FS && inFs) return;
      var cells = document.querySelectorAll('.symbol-cell');
      var scatterCells = [];
      for (var i = 0; i < cells.length; i++) {
        var s = cells[i].getAttribute && (cells[i].getAttribute('data-sym') || cells[i].getAttribute('data-symbol') || '');
        if (s === SCATTER_SYM) scatterCells.push(cells[i]);
      }
      var count = scatterCells.length;
      var deficit = SCATTER_TRIG - count;
      if (deficit < 1 || deficit > DEFICIT) return;
      for (var j = 0; j < scatterCells.length; j++) {
        scatterCells[j].setAttribute('data-near-miss', 'true');
      }
      try { window.HookBus.emit('onNearMissTease', { count: count, trigger: SCATTER_TRIG, deficit: deficit, source: source || 'auto' }); } catch (_) {}
      setTimeout(function () { clearAll('auto'); }, TEASE + 60);
    }

    window.HookBus.on('preSpin',       function () { clearAll('preSpin'); });
    window.HookBus.on('onSpinResult',  function () { detectAndTease('onSpinResult'); });
    window.HookBus.on('onFsTrigger',   function () { inFs = true;  clearAll('onFsTrigger'); });
    window.HookBus.on('onFsEnd',       function () { inFs = false; });

    /* Public API */
    window.nearMissTeaseScan  = function () { detectAndTease('api'); };
    window.nearMissTeaseClear = function () { clearAll('api'); };
  })();
  `;
}
