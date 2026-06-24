import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/reelLockHold.mjs
 *
 * Wave H23 — Reel Lock Hold (lock visible reels during a respin with countdown).
 *
 * Purpose: lock an entire reel column for a fixed N-spin window
 * showing a visual "LOCKED" badge with a per-tick countdown.
 *
 * Industry baseline (vendor-neutral, reference standard):
 *   Different from `holdAndWin` (which locks specific bonus cells across
 *   respins until the grid fills): this block locks WHOLE REELS for a
 *   fixed N-spin window. Engine consults `window.__REEL_LOCKED__[r]`
 *   before re-spinning each reel; locked reels skip the strip walk.
 *
 * Public API:
 *   defaultConfig()                            → frozen safe defaults
 *   resolveConfig(model)                       → merge with model.reelLockHold
 *   emitReelLockHoldCSS(cfg)                   → badge + countdown styles
 *   emitReelLockHoldMarkup(cfg)                → per-reel host nodes
 *   emitReelLockHoldRuntime(cfg)               → runtime JS string
 *   window.lockReelForRounds(reelIdx, rounds)  → programmatic lock
 *
 * Lifecycle (HookBus):
 *   subscribes:
 *     postSpin     → tick every active reel-lock; emit end for expired
 *     onFsTrigger  → suspend locks during FS (FS owns its own state machine)
 *     onFsEnd      → clear all locks (fresh start in base)
 *   emits (owned):
 *     onReelLockStart   {reel, rounds, source}
 *     onReelLockTick    {ended, remaining, source}
 *     onReelLockEnd     {reel, source}
 *     onReelLockCleared {reason}
 *
 * Performance budget:
 *   ≤ 1 DOM write per locked reel per spin (badge count update);
 *   no rAF, no polling; cleanup on animationend; 0 listeners stacked
 *   across HMR via wired-once sentinel.
 *
 * a11y:
 *   badge carries `aria-live="polite"` + `aria-atomic="true"` so SR
 *   users hear "Reel 2 locked: 2 spins remaining" on each tick.
 *   `prefers-reduced-motion` hard-zeros the pulse animation.
 *
 * GDD keys (consumed from model.reelLockHold):
 *   enabled, rounds, badgeFontPx, pulseMs, zIndex, badgeBg, badgeColor,
 *   text (label template with {N} placeholder)
 *
 * Vendor-neutral. No game / studio strings.
 *
 * @module reelLockHold
 */

const BOUNDS = Object.freeze({
  maxRounds:    [1, 12],
  badgeFontPx:  [10, 22],
  pulseMs:      [120, 1500],
  zIndex:       [10, 99],
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
    enabled:       false,
    rounds:        3,
    badgeFontPx:   12,
    pulseMs:       540,
    zIndex:        24,
    badgeBg:       'rgba(0,0,0,0.78)',
    badgeColor:    '#ffd84d',
    badgeLabel:    'LOCKED',
    autoExtendOnFs: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.reelLockHold) || {};
  const auto = !!model.reelLockHold;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.rounds      = _clamp(m.rounds,      BOUNDS.maxRounds,    cfg.rounds);
  cfg.badgeFontPx = _clamp(m.badgeFontPx, BOUNDS.badgeFontPx,  cfg.badgeFontPx);
  cfg.pulseMs     = _clamp(m.pulseMs,     BOUNDS.pulseMs,      cfg.pulseMs);
  cfg.zIndex      = _clamp(m.zIndex,      BOUNDS.zIndex,       cfg.zIndex);

  cfg.badgeBg    = _safe(m.badgeBg,    64, cfg.badgeBg);
  cfg.badgeColor = _safe(m.badgeColor, 32, cfg.badgeColor);
  cfg.badgeLabel = _safe(m.badgeLabel, 16, cfg.badgeLabel);
  if (typeof m.autoExtendOnFs === 'boolean') cfg.autoExtendOnFs = m.autoExtendOnFs;
  return cfg;
}

export function emitReelLockHoldCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* reelLockHold — Wave H23 */
  .reel-column[data-locked-hold="true"],
  .reel[data-locked-hold="true"] {
    position: relative;
    filter: brightness(1.05);
  }
  .reel-column[data-locked-hold="true"]::before,
  .reel[data-locked-hold="true"]::before {
    content: attr(data-lock-label);
    position: absolute;
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
    background: ${cfg.badgeBg};
    color: ${cfg.badgeColor};
    padding: 3px 9px;
    border-radius: 10px;
    font-size: ${cfg.badgeFontPx}px;
    font-weight: 800;
    letter-spacing: 0.08em;
    z-index: ${cfg.zIndex};
    pointer-events: none;
    animation: reel-lock-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes reel-lock-pulse {
    0%   { opacity: 0.0; transform: translate(-50%, -6px); }
    100% { opacity: 1.0; transform: translate(-50%, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .reel-column[data-locked-hold="true"]::before,
    .reel[data-locked-hold="true"]::before { animation: none; }
  }
  `;
}

export function emitReelLockHoldMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<!-- reelLockHold decorates .reel-column[data-locked-hold="true"] at runtime -->`, 'reelLockHold');
}

export function emitReelLockHoldRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── reelLockHold BLOCK — Wave H23 ────────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var ROUNDS = ${cfg.rounds};
    var LABEL = ${JSON.stringify(cfg.badgeLabel)};
    var AUTO_EXTEND_FS = ${JSON.stringify(cfg.autoExtendOnFs)};

    var locks = {};      /* reelIdx → remaining rounds */
    var inFs = false;

    function reelEl(reelIdx) {
      if (typeof document === 'undefined') return null;
      return document.querySelector('.reel-column[data-reel="' + reelIdx + '"]') ||
             document.querySelector('.reel[data-reel="' + reelIdx + '"]');
    }
    function apply(reelIdx) {
      var el = reelEl(reelIdx);
      if (!el) return;
      var rem = locks[reelIdx] | 0;
      var lab = LABEL + ' ' + rem;
      if (rem > 0) {
        el.setAttribute('data-locked-hold', 'true');
        el.setAttribute('data-lock-label', lab);
      } else {
        el.setAttribute('data-locked-hold', 'false');
        el.setAttribute('data-lock-label', '');
      }
    }
    function applyAll() { for (var k in locks) apply(k); }

    function lock(reelIdx, rounds, source) {
      var r = rounds > 0 ? rounds : ROUNDS;
      locks[reelIdx] = r;
      apply(reelIdx);
      try { window.HookBus.emit('onReelLockStart', { reel: reelIdx, rounds: r, source: source || 'auto' }); } catch (_) {}
    }
    function tickAll(source) {
      var ended = [];
      for (var k in locks) {
        if (locks[k] > 0) {
          locks[k]--;
          if (locks[k] === 0) {
            ended.push(k | 0);
            try { window.HookBus.emit('onReelLockEnd', { reel: k | 0, source: source || 'auto' }); } catch (_) {}
            /* unlock DOM BEFORE deleting from map */
            var endEl = reelEl(k | 0);
            if (endEl) {
              endEl.setAttribute('data-locked-hold', 'false');
              endEl.setAttribute('data-lock-label', '');
            }
            delete locks[k];
          }
        }
      }
      applyAll();
      if (ended.length > 0) {
        try { window.HookBus.emit('onReelLockTick', { ended: ended, remaining: Object.keys(locks).map(Number), source: source || 'auto' }); } catch (_) {}
      }
    }
    function clearAll(reason) {
      var any = Object.keys(locks).length > 0;
      locks = {};
      if (typeof document !== 'undefined') {
        var els = document.querySelectorAll('.reel-column[data-locked-hold="true"], .reel[data-locked-hold="true"]');
        for (var i = 0; i < els.length; i++) {
          els[i].setAttribute('data-locked-hold', 'false');
          els[i].setAttribute('data-lock-label', '');
        }
      }
      if (any) try { window.HookBus.emit('onReelLockCleared', { reason: reason || 'auto' }); } catch (_) {}
    }

    window.HookBus.on('postSpin', function () { tickAll('postSpin'); });
    window.HookBus.on('onFsTrigger', function () {
      inFs = true;
      if (AUTO_EXTEND_FS) {
        for (var k in locks) { locks[k] = ROUNDS; apply(k); }
      }
    });
    window.HookBus.on('onFsEnd', function () { inFs = false; clearAll('onFsEnd'); });

    /* Public API */
    window.reelLockHold      = function (reelIdx, rounds) { lock(reelIdx | 0, rounds | 0 || 0, 'api'); };
    window.reelLockHoldClear = function () { clearAll('api'); };
    window.reelLockHoldStatus = function () { return Object.assign({}, locks); };
  })();
  `;
}
