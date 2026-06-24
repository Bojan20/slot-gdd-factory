import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/syncReels.mjs
 *
 * Wave H19 — Sync Reels (2+ reels show identical symbol stack).
 *
 * Industry baseline (vendor-neutral):
 *   Feature in which a configured pair (or trio) of reels are forced to
 *   land with identical visible symbols, dramatically boosting line/way
 *   wins. Block is a pure PRESENTER — it announces a sync occurred and
 *   decorates the affected reels for player feedback.
 *
 * @module syncReels
 */

const BOUNDS = Object.freeze({
  pulseMs:    [120, 1500],
  zIndex:     [10, 99],
  maxReels:   [2, 12],
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
    flashColor:     'rgba(255,216,77,0.65)',
    pulseMs:        540,
    zIndex:         18,
    autoDetect:     true,             /* scan grid for matching reels */
    detectMinReels: 2,                /* min adjacent reels to call sync */
    persistRound:   false,            /* keep highlight after preSpin */
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.syncReels) || {};
  const auto = !!model.syncReels;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.pulseMs        = _clamp(m.pulseMs,        BOUNDS.pulseMs,    cfg.pulseMs);
  cfg.zIndex         = _clamp(m.zIndex,         BOUNDS.zIndex,     cfg.zIndex);
  cfg.detectMinReels = _clamp(m.detectMinReels, BOUNDS.maxReels,   cfg.detectMinReels);

  cfg.flashColor = _safe(m.flashColor, 48, cfg.flashColor);
  if (typeof m.autoDetect === 'boolean')   cfg.autoDetect   = m.autoDetect;
  if (typeof m.persistRound === 'boolean') cfg.persistRound = m.persistRound;
  return cfg;
}

export function emitSyncReelsCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* syncReels — Wave H19 */
  .reel-column[data-synced="true"],
  .reel[data-synced="true"] {
    box-shadow: inset 0 0 24px ${cfg.flashColor};
    z-index: ${cfg.zIndex};
    animation: sync-reels-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes sync-reels-pulse {
    0%   { box-shadow: inset 0 0 0px ${cfg.flashColor}; }
    60%  { box-shadow: inset 0 0 32px ${cfg.flashColor}; }
    100% { box-shadow: inset 0 0 24px ${cfg.flashColor}; }
  }
  @media (prefers-reduced-motion: reduce) {
    .reel-column[data-synced="true"],
    .reel[data-synced="true"] { animation: none; }
  }
  `;
}

export function emitSyncReelsMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<!-- syncReels decorates .reel-column[data-synced="true"] at runtime -->`, 'syncReels');
}

export function emitSyncReelsRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── syncReels BLOCK — Wave H19 ───────────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var AUTO = ${JSON.stringify(cfg.autoDetect)};
    var MIN = ${cfg.detectMinReels};
    var PERSIST = ${JSON.stringify(cfg.persistRound)};

    function reelEls() {
      if (typeof document === 'undefined') return [];
      var nodes = document.querySelectorAll('.reel-column[data-reel], .reel[data-reel]');
      var arr = [];
      for (var i = 0; i < nodes.length; i++) arr.push(nodes[i]);
      return arr;
    }
    function reelSignature(reel) {
      var cells = reel.querySelectorAll('.symbol-cell');
      var sig = [];
      for (var i = 0; i < cells.length; i++) {
        sig.push(cells[i].getAttribute('data-sym') || cells[i].getAttribute('data-symbol') || '');
      }
      return sig.join('|');
    }
    function clearAll(reason) {
      var reels = reelEls();
      var any = false;
      for (var i = 0; i < reels.length; i++) {
        if (reels[i].getAttribute('data-synced') === 'true') any = true;
        reels[i].setAttribute('data-synced', 'false');
      }
      if (any) try { window.HookBus.emit('onSyncReelsCleared', { reason: reason || 'auto' }); } catch (_) {}
    }
    function markSynced(reelIdxList, signature, source) {
      var reels = reelEls();
      var marked = [];
      for (var i = 0; i < reels.length; i++) {
        var idx = parseInt(reels[i].getAttribute('data-reel') || '-1', 10);
        if (reelIdxList.indexOf(idx) >= 0) {
          reels[i].setAttribute('data-synced', 'true');
          marked.push(idx);
        }
      }
      if (marked.length >= MIN) {
        try { window.HookBus.emit('onReelsSynced', { reels: marked, count: marked.length, signature: signature, source: source || 'auto' }); } catch (_) {}
      }
    }
    function detect(source) {
      if (!AUTO) return;
      var reels = reelEls();
      if (reels.length < MIN) return;
      var groups = {};
      for (var i = 0; i < reels.length; i++) {
        var sig = reelSignature(reels[i]);
        if (!sig) continue;
        var idx = parseInt(reels[i].getAttribute('data-reel') || '-1', 10);
        if (idx < 0) continue;
        (groups[sig] = groups[sig] || []).push(idx);
      }
      for (var key in groups) {
        if (groups[key].length >= MIN) {
          markSynced(groups[key], key, source);
        }
      }
    }

    window.HookBus.on('preSpin',        function () { if (!PERSIST) clearAll('preSpin'); });
    window.HookBus.on('onSpinResult',   function () { detect('onSpinResult'); });
    window.HookBus.on('onTumbleStep',   function () { detect('onTumbleStep'); });
    window.HookBus.on('onFsSpinResult', function () { detect('onFsSpinResult'); });

    /* Public API */
    window.syncReelsMark = function (reelIdxList) {
      var arr = Array.isArray(reelIdxList) ? reelIdxList.map(function (n) { return n | 0; }) : [];
      markSynced(arr, 'manual', 'api');
    };
    window.syncReelsClear = function () { clearAll('api'); };
  })();
  `;
}
