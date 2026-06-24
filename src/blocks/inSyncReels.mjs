/**
 * src/blocks/inSyncReels.mjs
 *
 * UQ-DEEP-AK · WAVE 1 · BLOCK B — Synchronized Reels presentation + state.
 *
 * Industry baseline (vendor-neutral):
 *   "Synchronized reels" / "linked columns" paradigm — a configured group
 *   of N reels are forced to spin in lock-step. When the source reel
 *   (lowest index in group) lands on a stop, every other reel in the
 *   group lands on the IDENTICAL stop position (same stripPos, same
 *   final visible symbol column). This is a state contract, not a
 *   post-hoc visual overlay (cf. syncReels.mjs which auto-detects
 *   accidental matches after a spin).
 *
 * GDD plumbing:
 *   • Parser (src/parser.mjs) detects "Reels 2-3 spin in sync" /
 *     "synchronized reels" / SR "rolne 2 i 3 su sinhronizovane" and
 *     writes model.wild.special.in_sync = { reels:[2,3], evidence,lang }.
 *   • This block consumes that field (or a model.inSyncReels override)
 *     and produces:
 *       - syncGroups: int[][] (each sub-array length≥2, dedup+sort)
 *       - mode: 'base' | 'fs' | 'both'
 *       - linkBarMs, highlightColor: visual link-bar style
 *       - mirrorStops + mirrorSymbols: engine-level contract flags
 *
 * Public API (matches walkingWild.mjs shape):
 *   defaultConfig()          → frozen baseline
 *   resolveConfig(model)     → frozen, auto-enable when in_sync present
 *   emitInSyncReelsCSS(cfg)
 *   emitInSyncReelsMarkup(cfg)
 *   emitInSyncReelsRuntime(cfg, model)
 *
 * Runtime hooks (HookBus, when present):
 *   preSpin       → for each syncGroup, lock target reels to mirror
 *                   the source reel stop (priority +10 over RNG land)
 *   onSpinResult  → paint visual link-bar across grouped reels
 *   onFsSpinResult → same as onSpinResult, mode='fs' permits
 *
 * Idempotency: window.__ISR_WIRED__ sentinel guards repeat baking.
 * Mount API:   window.inSyncAPI = { syncStops(groupIndex, sourceStop), state }
 *
 * No user-text sinks: runtime never calls eval/Function/document.write
 * and never assigns innerHTML from any user-derived string. CSS values
 * are validated (hex regex) before interpolation.
 */

const ISR_LINK_BAR_MS_MIN  = 60;
const ISR_LINK_BAR_MS_MAX  = 1500;
const ISR_DEFAULT_COLOR    = '#5dd2ff';
const ISR_SCHEMA_VERSION   = '1';
const ISR_HEX_RE           = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ISR_MODES            = new Set(['base', 'fs', 'both']);

function _validHex(s) {
  return typeof s === 'string' && ISR_HEX_RE.test(s);
}

function _clampInt(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}

/* Normalize a single sync-group: ints only, dedupe, sort ascending,
 * drop if length < 2 after cleaning. */
function _normGroup(g) {
  if (!Array.isArray(g)) return null;
  const seen = new Set();
  for (const r of g) {
    const n = Number(r);
    if (!Number.isFinite(n)) continue;
    const i = Math.floor(n);
    if (i < 0 || i > 31) continue;
    seen.add(i);
  }
  if (seen.size < 2) return null;
  return Array.from(seen).sort((a, b) => a - b);
}

function _normGroups(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const g of arr) {
    const ng = _normGroup(g);
    if (ng) out.push(ng);
  }
  return out;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:        false,
    syncGroups:     Object.freeze([]),
    mode:           'both',
    highlightColor: ISR_DEFAULT_COLOR,
    linkBarMs:      240,
    mirrorStops:    true,
    mirrorSymbols:  true,
    schemaVersion:  ISR_SCHEMA_VERSION,
  });
}

export function resolveConfig(model = {}) {
  const d   = defaultConfig();
  const cfg = {
    enabled:        d.enabled,
    syncGroups:     [],
    mode:           d.mode,
    highlightColor: d.highlightColor,
    linkBarMs:      d.linkBarMs,
    mirrorStops:    d.mirrorStops,
    mirrorSymbols:  d.mirrorSymbols,
    schemaVersion:  d.schemaVersion,
  };

  const userOver = (model && model.inSyncReels) || null;
  const parserHit = model && model.wild && model.wild.special && model.wild.special.in_sync;

  /* Collect candidate groups from BOTH parser hit and override. Parser
   * hit contributes a single group (reels:[…]); override may contribute
   * a full multi-group syncGroups array. */
  const candidates = [];
  if (parserHit && Array.isArray(parserHit.reels)) {
    candidates.push(parserHit.reels);
  }
  if (userOver && Array.isArray(userOver.syncGroups)) {
    for (const g of userOver.syncGroups) candidates.push(g);
  }
  cfg.syncGroups = _normGroups(candidates);

  /* Auto-enable when we have at least one valid group from either
   * source. Explicit override.enabled wins last. */
  if (cfg.syncGroups.length > 0) cfg.enabled = true;

  if (userOver) {
    if (typeof userOver.enabled === 'boolean') cfg.enabled = userOver.enabled;
    if (ISR_MODES.has(userOver.mode)) cfg.mode = userOver.mode;
    if (typeof userOver.mirrorStops === 'boolean') cfg.mirrorStops = userOver.mirrorStops;
    if (typeof userOver.mirrorSymbols === 'boolean') cfg.mirrorSymbols = userOver.mirrorSymbols;
    if (_validHex(userOver.highlightColor)) cfg.highlightColor = userOver.highlightColor;
    if (userOver.linkBarMs != null) {
      cfg.linkBarMs = _clampInt(userOver.linkBarMs, ISR_LINK_BAR_MS_MIN, ISR_LINK_BAR_MS_MAX, d.linkBarMs);
    }
  }

  /* If after all normalization we have no groups, force disabled. */
  if (cfg.syncGroups.length === 0) cfg.enabled = false;

  /* Deep-freeze groups so consumers cannot mutate. */
  cfg.syncGroups = Object.freeze(cfg.syncGroups.map((g) => Object.freeze(g.slice())));
  return Object.freeze(cfg);
}

export function emitInSyncReelsCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const color = _validHex(cfg.highlightColor) ? cfg.highlightColor : ISR_DEFAULT_COLOR;
  const ms = _clampInt(cfg.linkBarMs, ISR_LINK_BAR_MS_MIN, ISR_LINK_BAR_MS_MAX, 240);
  return `
/* ─── inSyncReels (UQ-DEEP-AK B) ───────────────────────────────── */
.isr-link-bar {
  position: absolute;
  height: 2px;
  background: ${color};
  opacity: 0.85;
  pointer-events: none;
  z-index: 14;
  animation: isr-link-pulse ${ms}ms ease-in-out infinite alternate;
}
.isr-reel-glow {
  box-shadow: 0 0 6px ${color};
  transition: box-shadow ${ms}ms ease-out;
}
@keyframes isr-link-pulse {
  0%   { opacity: 0.55; }
  100% { opacity: 0.95; }
}
@media (prefers-reduced-motion: reduce) {
  .isr-link-bar  { animation: none; opacity: 0.85; }
  .isr-reel-glow { transition: none; }
}
`;
}

export function emitInSyncReelsMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  /* Static host div — runtime appends .isr-link-bar children per group.
   * data-* attributes carry the resolved group list as JSON so the
   * runtime does not have to re-derive it. JSON.stringify on a plain
   * int-array produces only safe characters. */
  const groupsJson = JSON.stringify(cfg.syncGroups.map((g) => g.slice()));
  return `<div id="isrLinkHost" class="isr-link-host" data-sync-groups='${groupsJson}' aria-hidden="true"></div>`;
}

export function emitInSyncReelsRuntime(cfg = defaultConfig(), model = {}) {
  if (!cfg.enabled) return '';
  const groups = cfg.syncGroups.map((g) => g.slice());
  const color  = _validHex(cfg.highlightColor) ? cfg.highlightColor : ISR_DEFAULT_COLOR;
  const ms     = _clampInt(cfg.linkBarMs, ISR_LINK_BAR_MS_MIN, ISR_LINK_BAR_MS_MAX, 240);

  return `/* ─── inSyncReels runtime (UQ-DEEP-AK B) ──────────────────────── */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__ISR_WIRED__) return;
  window.__ISR_WIRED__ = true;

  var ISR_GROUPS = ${JSON.stringify(groups)};
  var ISR_MODE   = ${JSON.stringify(cfg.mode)};
  var ISR_COLOR  = ${JSON.stringify(color)};
  var ISR_MS     = ${ms};
  var ISR_MIRROR_STOPS   = ${cfg.mirrorStops ? 'true' : 'false'};
  var ISR_MIRROR_SYMBOLS = ${cfg.mirrorSymbols ? 'true' : 'false'};

  var state = {
    groups:        ISR_GROUPS,
    lastStops:     {},  /* groupIndex → sourceStop int */
    lastMirrored:  {},  /* groupIndex → [targetReel, …] */
    linkBars:      []
  };

  function _phaseAllowed() {
    /* mode='fs' only fires during FS; 'base' only outside FS; 'both' always. */
    var ph = null;
    if (window.FSM) ph = window.FSM.phase || window.FSM.state || null;
    if (ISR_MODE === 'both') return true;
    if (!ph) return ISR_MODE !== 'fs';
    if (ISR_MODE === 'fs')   return /^FS_/.test(ph);
    if (ISR_MODE === 'base') return !/^FS_/.test(ph);
    return true;
  }

  function _syncStops(gi, sourceStop) {
    if (gi < 0 || gi >= state.groups.length) return null;
    if (!ISR_MIRROR_STOPS) return null;
    var grp = state.groups[gi];
    var src = grp[0];
    var stop = (sourceStop == null && window.REELS_STATE && window.REELS_STATE[src])
                  ? window.REELS_STATE[src].stop : sourceStop;
    if (stop == null) return null;
    var mirrored = [];
    for (var i = 1; i < grp.length; i++) {
      var tgt = grp[i];
      if (window.REELS_STATE && window.REELS_STATE[tgt]) {
        window.REELS_STATE[tgt].stop = stop;
        if (ISR_MIRROR_SYMBOLS && window.REELS_STATE[src] && window.REELS_STATE[src].symbols) {
          window.REELS_STATE[tgt].symbols = window.REELS_STATE[src].symbols.slice();
        }
      }
      mirrored.push(tgt);
    }
    state.lastStops[gi]    = stop;
    state.lastMirrored[gi] = mirrored;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onReelsSynced', { groupIndex: gi, reels: grp.slice(), stop: stop, source: 'inSyncReels' }); } catch (_) {}
    }
    return { reels: mirrored, stop: stop };
  }

  function _clearBars() {
    for (var i = 0; i < state.linkBars.length; i++) {
      var b = state.linkBars[i];
      if (b && b.parentNode) b.parentNode.removeChild(b);
    }
    state.linkBars = [];
  }

  function _paintBars() {
    if (!_phaseAllowed()) return;
    var host = document.getElementById('isrLinkHost');
    if (!host) return;
    _clearBars();
    for (var gi = 0; gi < state.groups.length; gi++) {
      var grp = state.groups[gi];
      for (var i = 0; i < grp.length - 1; i++) {
        var bar = document.createElement('div');
        bar.className = 'isr-link-bar';
        bar.setAttribute('data-sync-group', String(gi));
        bar.setAttribute('data-from-reel', String(grp[i]));
        bar.setAttribute('data-to-reel',   String(grp[i + 1]));
        host.appendChild(bar);
        state.linkBars.push(bar);
      }
      /* Apply glow class to each grouped reel column (DOM-side mark). */
      var cols = document.querySelectorAll('[data-reel]');
      for (var ci = 0; ci < cols.length; ci++) {
        var idx = parseInt(cols[ci].getAttribute('data-reel') || '-1', 10);
        if (grp.indexOf(idx) >= 0) {
          cols[ci].classList.add('isr-reel-glow');
          cols[ci].setAttribute('data-sync-group', String(gi));
        }
      }
    }
  }

  function _preSpinLock() {
    if (!_phaseAllowed()) return;
    /* Lock each group: priority +10 over normal RNG land so the engine
     * draws the source reel first, then mirrors target reels deterministic. */
    for (var gi = 0; gi < state.groups.length; gi++) {
      _syncStops(gi, null);
    }
  }

  /* Mount public API for engine + tests. */
  window.inSyncAPI = {
    syncStops: _syncStops,
    state:     state,
    repaint:   _paintBars,
    groups:    state.groups
  };

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('preSpin',        _preSpinLock);
    window.HookBus.on('onSpinResult',   _paintBars);
    window.HookBus.on('onFsSpinResult', _paintBars);
    window.HookBus.on('onFsEnd',        _clearBars);
  }
})();
`;
}
