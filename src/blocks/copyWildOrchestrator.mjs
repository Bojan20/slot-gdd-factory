import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/copyWildOrchestrator.mjs
 *
 * UQ-DEEP-AK · WAVE 1 · BLOCK A — Copy Wild Orchestrator.
 *
 * Purpose
 * ───────
 *   Industry-canonical "copy wild" paradigm: when a wild symbol lands on
 *   a designated source reel, the engine copies that wild onto one or
 *   more designated target reels in the same spin (or, alternatively,
 *   on any winning spin). The parser already detects the pattern under
 *   `model.wild.special.copy_wild = { sourceReels, targetReels, ... }`,
 *   but until this block lands no runtime presenter wires the signal to
 *   the rendered grid. That is a P0 ship-blocker for industry-grade
 *   wire-contract compatibility — this block closes the gap.
 *
 * Vendor-neutral
 * ──────────────
 *   No vendor names, no game-name references. Pure mechanic: scan
 *   source reel for wild, propagate the wild glyph onto a random row in
 *   each target reel, emit halo/flash animation, optionally gate by
 *   winning-line presence (copyOnWin) or by FS phase (mode).
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitCopyWildOrchestratorCSS(cfg)
 *   emitCopyWildOrchestratorMarkup(cfg)
 *   emitCopyWildOrchestratorRuntime(cfg, model)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onSpinResult — base/both: scan + propagate
 *     • onFsSpinResult — fs/both: scan + propagate
 *   emits:
 *     • onCopyWildPropagated { sourceReel, targetReels, rows }
 *
 * Runtime contract
 * ────────────────
 *   window.copyWildAPI = {
 *     emitCopy(sourceReel, targetReels): void,
 *     state: { lastPropagation: object|null }
 *   }
 *
 * GDD config keys
 * ───────────────
 *   model.wild.special.copy_wild          → primary signal (parser)
 *   model.copyWildOrchestrator            → explicit override
 *
 * Performance budget: ≤ 0.3ms per spin settle on 5×3 grid; one
 * listener per event (wired-once via window.__CW_WIRED__).
 *
 * a11y: target cells carry aria-label="Copied wild" so screen readers
 * announce the propagation; prefers-reduced-motion disables the
 * animation keyframes.
 *
 * Hard XSS guard: NO eval, NO document.write, NO innerHTML assignment
 * for user-derived data. All cell painting via textContent +
 * setAttribute only.
 */

const MODE_WHITELIST     = Object.freeze(['base', 'fs', 'both']);
const REEL_MIN           = 1;
const REEL_MAX           = 32;
const PROPAGATION_MIN_MS = 80;
const PROPAGATION_MAX_MS = 2000;
const HALO_DEFAULT       = '255,214,110';
const SYMBOL_RE          = /^[A-Za-z][A-Za-z0-9_]{0,7}$/;
const RGB_RE             = /^(\d{1,3}),(\d{1,3}),(\d{1,3})$/;

function _clampInt(n, lo, hi) {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function _dedupeSortReels(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  for (const x of arr) {
    const n = Math.trunc(Number(x));
    if (Number.isFinite(n) && n >= REEL_MIN && n <= REEL_MAX) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

function _parseRGB(s) {
  if (typeof s !== 'string') return null;
  const m = RGB_RE.exec(s.trim());
  if (!m) return null;
  const r = _clampInt(m[1], 0, 255);
  const g = _clampInt(m[2], 0, 255);
  const b = _clampInt(m[3], 0, 255);
  return `${r},${g},${b}`;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:        false,
    sourceReels:    [],
    targetReels:    [],
    wildSymbolId:   'W',
    copyOnHit:      true,
    copyOnWin:      false,
    propagationMs:  340,
    haloRGB:        HALO_DEFAULT,
    mode:           'both',
    schemaVersion:  '1',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };

  /* Primary signal: parser output under model.wild.special.copy_wild */
  const parserSig = (model && model.wild && model.wild.special && model.wild.special.copy_wild) || null;
  /* Secondary signal: explicit override under model.copyWildOrchestrator */
  const explicit  = (model && model.copyWildOrchestrator) || null;

  let sourceReels = [];
  let targetReels = [];

  if (parserSig) {
    if (Array.isArray(parserSig.sourceReels)) sourceReels = parserSig.sourceReels;
    if (Array.isArray(parserSig.targetReels)) targetReels = parserSig.targetReels;
  }

  if (explicit) {
    if (Array.isArray(explicit.sourceReels)) sourceReels = explicit.sourceReels;
    if (Array.isArray(explicit.targetReels)) targetReels = explicit.targetReels;
    if (typeof explicit.wildSymbolId === 'string' && SYMBOL_RE.test(explicit.wildSymbolId)) {
      cfg.wildSymbolId = explicit.wildSymbolId;
    }
    if (typeof explicit.mode === 'string' && MODE_WHITELIST.includes(explicit.mode)) {
      cfg.mode = explicit.mode;
    }
    if (Number.isFinite(explicit.propagationMs)) {
      cfg.propagationMs = _clampInt(explicit.propagationMs, PROPAGATION_MIN_MS, PROPAGATION_MAX_MS);
    }
    if (typeof explicit.haloRGB === 'string') {
      const parsed = _parseRGB(explicit.haloRGB);
      if (parsed) cfg.haloRGB = parsed;
    }
    /* copyOnHit XOR copyOnWin — if both specified, copyOnWin wins;
       if both false, fall back to copyOnHit=true (default). */
    if (typeof explicit.copyOnHit === 'boolean' || typeof explicit.copyOnWin === 'boolean') {
      const hit = explicit.copyOnHit === true;
      const win = explicit.copyOnWin === true;
      if (win) {
        cfg.copyOnHit = false;
        cfg.copyOnWin = true;
      } else if (hit) {
        cfg.copyOnHit = true;
        cfg.copyOnWin = false;
      } else {
        /* both explicitly false → fall back to default copyOnHit=true */
        cfg.copyOnHit = true;
        cfg.copyOnWin = false;
      }
    }
  }

  /* Normalize reel arrays — dedupe, sort, range-clamp [1..32]. */
  const srcClean = _dedupeSortReels(sourceReels);
  const tgtRaw   = _dedupeSortReels(targetReels);
  /* target reels MUST NOT overlap with source reels. */
  const srcSet   = new Set(srcClean);
  const tgtClean = tgtRaw.filter((r) => !srcSet.has(r));

  cfg.sourceReels = srcClean;
  cfg.targetReels = tgtClean;

  /* Auto-enable when both source + target produce at least one reel. */
  if ((parserSig || explicit) && srcClean.length > 0 && tgtClean.length > 0) {
    cfg.enabled = true;
  } else {
    cfg.enabled = false;
  }

  /* Final freeze with frozen reel arrays to keep contract strict. */
  cfg.sourceReels = Object.freeze(cfg.sourceReels);
  cfg.targetReels = Object.freeze(cfg.targetReels);
  return Object.freeze(cfg);
}

export function emitCopyWildOrchestratorCSS(cfg = defaultConfig()) {
  if (!cfg || !cfg.enabled) return '';
  const halo = cfg.haloRGB || HALO_DEFAULT;
  const ms   = cfg.propagationMs || 340;
  return `
/* ── copyWildOrchestrator BLOCK — src/blocks/copyWildOrchestrator.mjs ── */
.cw-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 35;
}
.cw-source-glow {
  box-shadow:
    0 0 0 2px rgba(${halo}, 0.85),
    0 0 12px rgba(${halo}, 0.9);
  animation: cw-source-pulse ${Math.max(120, Math.round(ms * 1.05))}ms ease-out;
  z-index: 36;
}
.cw-target-flash {
  box-shadow:
    0 0 0 3px rgba(${halo}, 0.9),
    0 0 18px rgba(${halo}, 0.75);
  animation: cw-target-flash ${Math.max(160, Math.round(ms * 1.35))}ms ease-in;
  z-index: 37;
}
.cw-trail {
  position: absolute;
  height: 4px;
  background: linear-gradient(90deg, rgba(${halo}, 0) 0%, rgba(${halo}, 0.95) 50%, rgba(${halo}, 0) 100%);
  pointer-events: none;
  opacity: 0.85;
  z-index: 34;
}
@keyframes cw-source-pulse {
  0%   { transform: scale(1.0); filter: brightness(1.0); }
  50%  { transform: scale(1.08); filter: brightness(1.4); }
  100% { transform: scale(1.0); filter: brightness(1.0); }
}
@keyframes cw-target-flash {
  0%   { transform: scale(0.92); opacity: 0.0; }
  40%  { transform: scale(1.10); opacity: 1.0; }
  100% { transform: scale(1.0);  opacity: 1.0; }
}
@media (prefers-reduced-motion: reduce) {
  .cw-source-glow,
  .cw-target-flash { animation: none; }
}
`;
}

export function emitCopyWildOrchestratorMarkup(cfg = defaultConfig()) {
  if (!cfg || !cfg.enabled) return '';
  return tagBlockMarkup(`
<!-- copyWildOrchestrator BLOCK — propagation stage overlay -->
<div id="cw-stage" class="cw-overlay" aria-hidden="true" data-cw-source-reels="${cfg.sourceReels.join(',')}" data-cw-target-reels="${cfg.targetReels.join(',')}"></div>
`, 'copyWildOrchestrator');
}

export function emitCopyWildOrchestratorRuntime(cfg = defaultConfig() /*, model */) {
  if (!cfg || !cfg.enabled) return '';

  /* All template substitutions below are STRINGIFIED via JSON.stringify
     to prevent any runtime injection vector; numeric values are coerced
     through Number(). NO user-supplied content is ever assigned via
     innerHTML in the generated runtime. */
  const sourceReelsJs = JSON.stringify(cfg.sourceReels);
  const targetReelsJs = JSON.stringify(cfg.targetReels);
  const wildSymJs     = JSON.stringify(String(cfg.wildSymbolId));
  const modeJs        = JSON.stringify(String(cfg.mode));
  const haloJs        = JSON.stringify(String(cfg.haloRGB));
  const propMs        = Number(cfg.propagationMs) || 340;
  const copyOnHit     = cfg.copyOnHit ? 'true' : 'false';
  const copyOnWin     = cfg.copyOnWin ? 'true' : 'false';

  return `
/* ── copyWildOrchestrator BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__CW_WIRED__) return;
  window.__CW_WIRED__ = true;

  var CW_SOURCE_REELS = ${sourceReelsJs};
  var CW_TARGET_REELS = ${targetReelsJs};
  var CW_WILD_SYMBOL  = ${wildSymJs};
  var CW_MODE         = ${modeJs};
  var CW_HALO_RGB     = ${haloJs};
  var CW_PROP_MS      = ${propMs};
  var CW_COPY_ON_HIT  = ${copyOnHit};
  var CW_COPY_ON_WIN  = ${copyOnWin};

  var _state = { lastPropagation: null };

  function _rng() {
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _fsActive() {
    if (window.__FS_ACTIVE__ === true) return true;
    if (window.FSM && typeof window.FSM === 'object') {
      var st = window.FSM.state || window.FSM.phase;
      if (st && /^FS_/.test(st)) return true;
    }
    if (window.FREESPINS && window.FREESPINS.remaining > 0) return true;
    return false;
  }

  function _phaseAllowed() {
    if (CW_MODE === 'both') return true;
    if (CW_MODE === 'fs')   return _fsActive();
    if (CW_MODE === 'base') return !_fsActive();
    return false;
  }

  function _gridRows() {
    if (typeof window.ROWS === 'number' && window.ROWS > 0) return window.ROWS;
    var maxRow = -1;
    var cells = document.querySelectorAll('[data-reel][data-row]');
    cells.forEach(function(el) {
      var w = parseInt(el.getAttribute('data-row'), 10);
      if (Number.isFinite(w) && w > maxRow) maxRow = w;
    });
    return maxRow >= 0 ? (maxRow + 1) : 3;
  }

  function _sourceReelHasWild(reel1Based) {
    /* reel param is 1-based; DOM data-reel is 0-based. */
    var col = reel1Based - 1;
    if (col < 0) return false;
    var cells = document.querySelectorAll('[data-reel="' + col + '"][data-row]');
    for (var i = 0; i < cells.length; i++) {
      var el  = cells[i];
      var sym = el.getAttribute('data-symbol');
      if (sym === CW_WILD_SYMBOL) return true;
    }
    return false;
  }

  function _payloadHasWinningLines(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (Array.isArray(payload.wins) && payload.wins.length > 0) return true;
    if (Array.isArray(payload.winningLines) && payload.winningLines.length > 0) return true;
    if (Number.isFinite(payload.totalWin) && payload.totalWin > 0) return true;
    return false;
  }

  function _paintTargetCell(reel1Based, row0) {
    var col = reel1Based - 1;
    if (col < 0) return null;
    var sel = '[data-reel="' + col + '"][data-row="' + row0 + '"]';
    var el  = document.querySelector(sel);
    if (!el) return null;
    /* Hard XSS guard: textContent + setAttribute ONLY. */
    el.textContent = CW_WILD_SYMBOL;
    el.setAttribute('data-symbol', CW_WILD_SYMBOL);
    el.setAttribute('aria-label', 'Copied wild');
    el.classList.add('cw-target-flash');
    /* Push wild into engine GRID so win-eval reads from canonical model. */
    if (window.GRID && typeof window.GRID.set === 'function') {
      try { window.GRID.set(col, row0, CW_WILD_SYMBOL); } catch (_) {}
    }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('symbolOverride', { r: row0, c: col, sym: CW_WILD_SYMBOL, source: 'copyWildOrchestrator' }); } catch (_) {}
    }
    return { reel: reel1Based, row: row0 };
  }

  function _glowSourceCell(reel1Based) {
    var col = reel1Based - 1;
    if (col < 0) return;
    var cells = document.querySelectorAll('[data-reel="' + col + '"][data-row]');
    cells.forEach(function(el) {
      if (el.getAttribute('data-symbol') === CW_WILD_SYMBOL) {
        el.classList.add('cw-source-glow');
      }
    });
  }

  function emitCopy(sourceReel, targetReels) {
    if (!Number.isFinite(sourceReel)) return null;
    if (!Array.isArray(targetReels) || targetReels.length === 0) return null;
    var ROWS = _gridRows();
    var placed = [];
    _glowSourceCell(sourceReel);
    for (var i = 0; i < targetReels.length; i++) {
      var tgt = targetReels[i];
      var row = Math.min(ROWS - 1, Math.floor(_rng() * ROWS));
      var r   = _paintTargetCell(tgt, row);
      if (r) placed.push(r);
    }
    var propagation = {
      sourceReel: sourceReel,
      targetReels: targetReels.slice(),
      rows: placed,
      ts: Date.now(),
    };
    _state.lastPropagation = propagation;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onCopyWildPropagated', propagation); } catch (_) {}
    }
    return propagation;
  }

  function onSpinResult(payload) {
    if (!_phaseAllowed()) return;
    /* copyOnWin gates propagation on winning-line presence. */
    if (CW_COPY_ON_WIN && !_payloadHasWinningLines(payload)) return;
    /* copyOnHit (default): propagate as long as wild present on source. */
    var anyPropagated = false;
    for (var i = 0; i < CW_SOURCE_REELS.length; i++) {
      var src = CW_SOURCE_REELS[i];
      if (!_sourceReelHasWild(src)) continue;
      emitCopy(src, CW_TARGET_REELS);
      anyPropagated = true;
    }
    return anyPropagated;
  }

  window.copyWildAPI = {
    emitCopy: emitCopy,
    state: _state,
  };

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    /* mode='fs' → skip base hook; mode='base' → skip FS hook; both → wire both. */
    if (CW_MODE !== 'fs') {
      window.HookBus.on('onSpinResult', onSpinResult, { priority: 30 });
    }
    if (CW_MODE !== 'base') {
      window.HookBus.on('onFsSpinResult', onSpinResult, { priority: 30 });
    }
  }
})();
`;
}
