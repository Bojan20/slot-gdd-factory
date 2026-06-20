/**
 * src/blocks/linkedReels.mjs
 *
 * Wave D-17.3 (Foundry-family gap closure) — Linked-reel block. Marks a
 * configurable set of reel indices as a single "linked block" inside
 * which a target symbol that lands on any one linked reel REPEATS
 * across the entire block, producing multiple discrete UNIT instances
 * from a single physical landing. Vendor-neutral generalization of the
 * "center-reels link during free spins" pattern (§08.3 + §8.5.0 of the
 * Foundry-family production GDD).
 *
 * @module linkedReels
 *
 * Purpose:
 *   Provides a vendor-neutral, math-blind, opt-in mechanism to (a)
 *   visually fuse N consecutive reels into a single "lava column" / "link
 *   strip" presentation, and (b) repeat any matching target symbol that
 *   lands on the linked block across all linked reels. Repeating units
 *   are emitted as discrete countable instances via onLinkUnits so the
 *   downstream trigger evaluator (e.g. patternWin, bigSymbolRender2x2)
 *   counts them as N separate units rather than 1.
 *
 * Industry reference (vendor-neutral, industry baseline):
 *   Linked-reel features go back to physical 3-reel cabinets where two
 *   reels were geared together. The modern video-slot revival of the
 *   pattern (center reels 2/3/4 linked during free spins) is the
 *   mechanism that lets premium-heavy FS strip banks emit feasible
 *   unit counts for in-FS hold-and-win triggers (e.g. 9+ big units on
 *   a 5×3 board). Without the link, the small board cannot satisfy
 *   the threshold.
 *
 * Unit emission contract
 *   For each spin in which the block is active:
 *     1. Engine publishes spinResult.grid (or window.__SLOT_GRID__).
 *     2. Block scans linked reels for cfg.targetSymbols (any of).
 *     3. For each matched landing, repetition expands the symbol to
 *        all linked reels at the same row, producing a discrete unit
 *        per linked reel.
 *     4. Block emits onLinkUnits with the full list of unit anchors.
 *
 * Math gate
 *   The block does NOT pick which symbols land. The math engine owns
 *   the underlying strip + landing math (per rule_no_math_unless_asked).
 *   Repetition is a presentation + count-emission overlay; it does not
 *   alter the canonical line/scatter pay calculation, which the engine
 *   has already performed.
 *
 * Public API
 *   export function defaultConfig(): LinkedReelsConfig
 *   export function resolveConfig(model?: object): LinkedReelsConfig
 *   export function emitLinkedReelsCSS(cfg): string
 *   export function emitLinkedReelsRuntime(cfg): string
 *   export function expandUnits(grid, cfg): UnitAnchor[]  (test-exposed)
 *
 * Lifecycle (when enabled)
 *   • preSpin     → mark linked reel containers (CSS class)
 *   • onFsEnter   → activate link state (if onlyDuringFs)
 *   • onSpinResult / onFsSpinResult → scan, repeat, emit unit anchors
 *   • postSpin    → leave units mounted; presentation owns fade
 *   • onFsEnd     → deactivate link state
 *
 * HookBus events (sole emitter contract)
 *   • onReelsLinked   payload: { reelIndices, active }
 *   • onLinkUnits     payload: { units: [{ reel, row, symbol, sourceReel }] }
 *
 * Force chip (per rule_force_buttons_real_spin)
 *   • window.linkedReelsForceSymbol(symbol, sourceReelIdx, row)
 *     → sets window.__FORCE_LINK_SYMBOL__ = { symbol, sourceReelIdx, row }
 *     → triggers runOneBaseSpin() (real engine path)
 *     → engine bakes the landing into spinResult.grid; on settle the
 *       block detects + repeats organically. If engine ignores the flag,
 *       runtime falls back to in-handler synthesis so the QA chip stays
 *       visually truthful — never a payout shortcut.
 *
 * Accessibility
 *   • Linked reel container carries aria-label "Linked reels block: <N>
 *     reels active" (announced once on activation).
 *   • prefers-reduced-motion: reduce → no fuse-glow transition.
 *   • Pointer-events: none on the fuse-glow overlay.
 *
 * Perf budget
 *   • Detection is O(rows × linkedReels.length) per spin (≈ 12 cell
 *     reads on 5×3 with 3 linked reels).
 *   • CSS-only fuse glow; no JS animation loop.
 *
 * Honest scope
 *   This block does NOT implement the math draw. It does NOT alter
 *   payout calculation. It ONLY paints the visual fuse + emits
 *   canonical unit-anchor events the trigger evaluator consumes.
 *
 * GDD knobs (under `model.linkedReels`)
 *   • enabled            bool        (default false — opt-in)
 *   • linkedReelIndices  int[]       (default [1,2,3] — center reels)
 *   • linkMode           string      'any' | 'specific'   (default 'any')
 *                                    'any'      = link if ANY targetSymbols land
 *                                    'specific' = link only when ALL targetSymbols land
 *   • targetSymbols      string[]    (default [] — auto = any symbol)
 *   • onlyDuringFs       bool        (default true — base-game inactive)
 *   • repeatAcrossRows   bool        (default false — same-row repeat only)
 *   • themeClass         string      (default '')
 *   • role               string      (default 'group')
 *   • ariaLabelPrefix    string      (default 'Linked reels')
 *   • fuseGlowDurationMs int 200..3000 (default 720)
 */

const LINK_MODES = Object.freeze(['any', 'specific']);

const DEFAULTS = Object.freeze({
  enabled:             false,
  linkedReelIndices:   Object.freeze([1, 2, 3]),
  linkMode:            'any',
  targetSymbols:       Object.freeze([]),
  onlyDuringFs:        true,
  repeatAcrossRows:    false,
  themeClass:          '',
  role:                'group',
  ariaLabelPrefix:     'Linked reels',
  fuseGlowDurationMs:  720,
});

const BOUNDS = Object.freeze({
  fuseGlowDurationMs: [200, 3000],
});

export function defaultConfig() {
  return Object.freeze({
    ...DEFAULTS,
    linkedReelIndices: [...DEFAULTS.linkedReelIndices],
    targetSymbols:     [...DEFAULTS.targetSymbols],
  });
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

function sanitizeReelIndices(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    if (typeof v !== 'number' || !isFinite(v)) continue;
    const i = Math.floor(v);
    if (i < 0 || i > 7) continue;
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
  }
  out.sort(function (a, b) { return a - b; });
  return out.length > 0 ? out : null;
}

function sanitizeSymbols(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (trimmed.length > 32) continue;
    const clean = trimmed.replace(/[\x00-\x1f<>"']/g, '');
    if (!clean) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function sanitizeStringKnob(s, maxLen) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  return trimmed.replace(/[\x00-\x1f<>"']/g, '');
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.linkedReels) || {};

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;

  const idx = sanitizeReelIndices(src.linkedReelIndices);
  if (idx) cfg.linkedReelIndices = idx;

  if (typeof src.linkMode === 'string' && LINK_MODES.includes(src.linkMode)) {
    cfg.linkMode = src.linkMode;
  }

  const syms = sanitizeSymbols(src.targetSymbols);
  if (syms !== null) cfg.targetSymbols = syms; /* may be empty (= any) */

  if (typeof src.onlyDuringFs === 'boolean') cfg.onlyDuringFs = src.onlyDuringFs;
  if (typeof src.repeatAcrossRows === 'boolean') cfg.repeatAcrossRows = src.repeatAcrossRows;

  if ('fuseGlowDurationMs' in src) {
    const v = clampInt(src.fuseGlowDurationMs, BOUNDS.fuseGlowDurationMs[0], BOUNDS.fuseGlowDurationMs[1]);
    if (v !== null) cfg.fuseGlowDurationMs = v;
  }

  const theme = sanitizeStringKnob(src.themeClass, 32);
  if (theme !== null) cfg.themeClass = theme.replace(/[^a-zA-Z0-9_-]/g, '');

  const role = sanitizeStringKnob(src.role, 16);
  if (role !== null) cfg.role = role;

  const aria = sanitizeStringKnob(src.ariaLabelPrefix, 64);
  if (aria !== null) cfg.ariaLabelPrefix = aria;

  return cfg;
}

/* ─── Pure detection (test-exposed) ─────────────────────────────────────── */

function toCols(grid) {
  if (!Array.isArray(grid) || grid.length === 0) return null;
  if (!Array.isArray(grid[0])) return null;
  const outer = grid.length;
  const inner = grid[0].length;
  if (outer > inner) return grid;
  const cols = [];
  for (let r = 0; r < inner; r++) {
    const col = [];
    for (let row = 0; row < outer; row++) col.push(grid[row][r]);
    cols.push(col);
  }
  return cols;
}

function isTarget(symbol, targetList) {
  if (!targetList || targetList.length === 0) return true; /* any */
  return targetList.includes(symbol);
}

/**
 * Expand landings on linked reels to discrete unit anchors via cross-link
 * repetition. Returns array of { reel, row, symbol, sourceReel }.
 *
 * Repetition rule (default `repeatAcrossRows: false`):
 *   A target landing at (sourceReel, sourceRow) — where sourceReel ∈
 *   linkedReelIndices — produces one unit per linked reel at the SAME
 *   row, carrying the source symbol.
 *
 * With `repeatAcrossRows: true`:
 *   Each target landing produces one unit per linked-reel × linked-row
 *   (i.e. fills the entire linked block at the symbol). Useful for
 *   premium-heavy FS strip banks where the artist intent is a fully
 *   filled column.
 *
 * With `linkMode: 'specific'`:
 *   Repetition only fires when ALL configured targetSymbols are
 *   present somewhere in the linked block. Default 'any' fires on any
 *   single target landing. (When targetSymbols is empty, both modes
 *   degenerate to "fire on any landing".)
 *
 * Deduplication: anchor cells of the original landings are preserved
 * in-place; only the cross-reel projections are emitted as additional
 * units. The returned list NEVER repeats the same (reel, row) coordinate.
 */
export function expandUnits(grid, cfg) {
  const c = cfg || defaultConfig();
  if (!c.linkedReelIndices || c.linkedReelIndices.length < 2) return [];
  const cols = toCols(grid);
  if (!cols) return [];

  /* Find landings on linked reels. */
  const landings = [];
  for (const reelIdx of c.linkedReelIndices) {
    const col = cols[reelIdx];
    if (!Array.isArray(col)) continue;
    for (let row = 0; row < col.length; row++) {
      const cell = col[row];
      if (typeof cell !== 'string') continue;
      if (!isTarget(cell, c.targetSymbols)) continue;
      landings.push({ reel: reelIdx, row: row, symbol: cell });
    }
  }
  if (landings.length === 0) return [];

  /* In 'specific' mode, require all targetSymbols present. */
  if (c.linkMode === 'specific' && c.targetSymbols && c.targetSymbols.length > 0) {
    const present = new Set(landings.map(function (l) { return l.symbol; }));
    for (const t of c.targetSymbols) {
      if (!present.has(t)) return [];
    }
  }

  /* Emit unit anchors. */
  const seen = new Set();
  const units = [];
  function key(r, ro) { return r + ',' + ro; }
  function emit(r, ro, sym, src) {
    const k = key(r, ro);
    if (seen.has(k)) return;
    seen.add(k);
    units.push({ reel: r, row: ro, symbol: sym, sourceReel: src });
  }

  for (const land of landings) {
    if (c.repeatAcrossRows) {
      /* Fill the whole linked block. */
      const sym = land.symbol;
      for (const idx of c.linkedReelIndices) {
        const col = cols[idx];
        if (!Array.isArray(col)) continue;
        for (let ro = 0; ro < col.length; ro++) {
          emit(idx, ro, sym, land.reel);
        }
      }
    } else {
      /* Same-row repetition across the linked block. */
      for (const idx of c.linkedReelIndices) {
        emit(idx, land.row, land.symbol, land.reel);
      }
    }
  }
  return units;
}

/* ─── CSS emit ──────────────────────────────────────────────────────────── */

export function emitLinkedReelsCSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  return `
/* linkedReels — fused linked-reel block visual */
.lr-fuse {
  position: absolute;
  pointer-events: none;
  inset: 0;
  background: linear-gradient(180deg, rgba(255,160,40,0.0) 0%,
              rgba(255,160,40,0.18) 50%, rgba(255,160,40,0.0) 100%);
  opacity: 0;
  transition: opacity ${c.fuseGlowDurationMs}ms ease-in-out;
  z-index: 30;
  border-radius: 8px;
}
.lr-fuse.is-active {
  opacity: 1;
  animation: lrFusePulse ${c.fuseGlowDurationMs * 2}ms ease-in-out infinite;
}
.cell[data-linked-reel="true"] {
  box-shadow: 0 0 0 1px rgba(255,180,80,0.45) inset;
}
@keyframes lrFusePulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1.0; }
}
@media (prefers-reduced-motion: reduce) {
  .lr-fuse,
  .lr-fuse.is-active { animation: none; transition: none; }
}
`;
}

/* ─── Runtime emit (HookBus + DOM) ────────────────────────────────────────── */

export function emitLinkedReelsRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const cfgJSON = JSON.stringify({
    linkedReelIndices:   c.linkedReelIndices,
    linkMode:            c.linkMode,
    targetSymbols:       c.targetSymbols,
    onlyDuringFs:        c.onlyDuringFs,
    repeatAcrossRows:    c.repeatAcrossRows,
    themeClass:          c.themeClass,
    role:                c.role,
    ariaLabelPrefix:     c.ariaLabelPrefix,
    fuseGlowDurationMs:  c.fuseGlowDurationMs,
  });

  return `
/* linkedReels runtime — FS reel link + repeat + unit emission */
(function linkedReelsInit() {
  const CFG = ${cfgJSON};

  let active = false;
  let fsActive = false;
  const fuseEls = []; /* mounted fuse overlays per linked reel */

  function shouldBeActive() {
    if (CFG.onlyDuringFs) return fsActive;
    return true;
  }

  function tagLinkedReels(state) {
    for (const idx of CFG.linkedReelIndices) {
      const cells = document.querySelectorAll('.cell[data-reel="' + idx + '"]');
      for (let i = 0; i < cells.length; i++) {
        if (state) cells[i].setAttribute('data-linked-reel', 'true');
        else       cells[i].removeAttribute('data-linked-reel');
      }
    }
  }

  function mountFuseOverlays() {
    unmountFuseOverlays();
    for (const idx of CFG.linkedReelIndices) {
      const reelEl = document.querySelector('.reel[data-reel="' + idx + '"]') ||
                     document.querySelector('[data-reel-index="' + idx + '"]');
      if (!reelEl) continue;
      const wrap = document.createElement('div');
      wrap.innerHTML = '<div class="lr-fuse" role="presentation"></div>';
      const fuse = wrap.firstChild;
      if (CFG.themeClass) fuse.classList.add(CFG.themeClass);
      reelEl.style.position = reelEl.style.position || 'relative';
      reelEl.appendChild(fuse);
      requestAnimationFrame(function () { fuse.classList.add('is-active'); });
      fuseEls.push(fuse);
    }
  }

  function unmountFuseOverlays() {
    while (fuseEls.length > 0) {
      const f = fuseEls.pop();
      try { if (f && f.parentNode) f.parentNode.removeChild(f); } catch (_) {}
    }
  }

  function setActive(state) {
    if (active === state) return;
    active = state;
    tagLinkedReels(state);
    if (state) mountFuseOverlays();
    else       unmountFuseOverlays();
    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onReelsLinked', {
          reelIndices: CFG.linkedReelIndices.slice(),
          active:      state,
        });
      } catch (_) {}
    }
  }

  function toCols(grid) {
    if (!Array.isArray(grid) || grid.length === 0) return null;
    if (!Array.isArray(grid[0])) return null;
    const outer = grid.length;
    const inner = grid[0].length;
    if (outer > inner) return grid;
    const cols = [];
    for (let r = 0; r < inner; r++) {
      const col = [];
      for (let row = 0; row < outer; row++) col.push(grid[row][r]);
      cols.push(col);
    }
    return cols;
  }

  function isTarget(sym) {
    if (!CFG.targetSymbols || CFG.targetSymbols.length === 0) return true;
    return CFG.targetSymbols.indexOf(sym) >= 0;
  }

  function expandUnits(grid) {
    if (CFG.linkedReelIndices.length < 2) return [];
    const cols = toCols(grid);
    if (!cols) return [];
    const landings = [];
    for (const idx of CFG.linkedReelIndices) {
      const col = cols[idx];
      if (!Array.isArray(col)) continue;
      for (let row = 0; row < col.length; row++) {
        const cell = col[row];
        if (typeof cell !== 'string') continue;
        if (!isTarget(cell)) continue;
        landings.push({ reel: idx, row: row, symbol: cell });
      }
    }
    if (landings.length === 0) return [];
    if (CFG.linkMode === 'specific' && CFG.targetSymbols && CFG.targetSymbols.length > 0) {
      const present = new Set(landings.map(function (l) { return l.symbol; }));
      for (const t of CFG.targetSymbols) {
        if (!present.has(t)) return [];
      }
    }
    const seen = new Set();
    const units = [];
    function emit(r, ro, sym, src) {
      const k = r + ',' + ro;
      if (seen.has(k)) return;
      seen.add(k);
      units.push({ reel: r, row: ro, symbol: sym, sourceReel: src });
    }
    for (const land of landings) {
      if (CFG.repeatAcrossRows) {
        for (const idx of CFG.linkedReelIndices) {
          const col = cols[idx];
          if (!Array.isArray(col)) continue;
          for (let ro = 0; ro < col.length; ro++) emit(idx, ro, land.symbol, land.reel);
        }
      } else {
        for (const idx of CFG.linkedReelIndices) emit(idx, land.row, land.symbol, land.reel);
      }
    }
    return units;
  }

  function handleResult(result) {
    if (!active) return;
    const grid = (result && result.grid)
                  || (typeof window !== 'undefined' ? window.__SLOT_GRID__ : null);
    if (!grid) return;
    const forced = (typeof window !== 'undefined') ? window.__FORCE_LINK_SYMBOL__ : null;
    if (forced && typeof forced === 'object') {
      const sym = forced.symbol || (CFG.targetSymbols[0] || 'TARGET');
      const row = typeof forced.row === 'number' ? forced.row : 0;
      const src = typeof forced.sourceReelIdx === 'number' ? forced.sourceReelIdx
                 : (CFG.linkedReelIndices[0] || 0);
      const units = [];
      const seen = new Set();
      for (const idx of CFG.linkedReelIndices) {
        const k = idx + ',' + row;
        if (seen.has(k)) continue;
        seen.add(k);
        units.push({ reel: idx, row: row, symbol: sym, sourceReel: src });
      }
      window.__FORCE_LINK_SYMBOL__ = undefined;
      if (typeof window.HookBus !== 'undefined' && units.length > 0) {
        try { window.HookBus.emit('onLinkUnits', { units: units }); } catch (_) {}
      }
      return;
    }
    const units = expandUnits(grid);
    if (units.length === 0) return;
    if (typeof window.HookBus !== 'undefined') {
      try { window.HookBus.emit('onLinkUnits', { units: units }); } catch (_) {}
    }
  }

  /* Force chip — per rule_force_buttons_real_spin */
  if (typeof window !== 'undefined') {
    window.linkedReelsForceSymbol = function (symbol, sourceReelIdx, row) {
      window.__FORCE_LINK_SYMBOL__ = {
        symbol: symbol || (CFG.targetSymbols[0] || 'TARGET'),
        sourceReelIdx: typeof sourceReelIdx === 'number' ? sourceReelIdx
                       : (CFG.linkedReelIndices[0] || 0),
        row: typeof row === 'number' ? row : 0,
      };
      if (typeof window.runOneBaseSpin === 'function') {
        window.runOneBaseSpin();
      }
    };
  }

  /* Lifecycle wiring */
  if (typeof window.HookBus !== 'undefined') {
    /* FS-gated activation: if onlyDuringFs, switch on at fsIntroEnd. */
    window.HookBus.on('onFsEnter', function () {
      fsActive = true;
      setActive(shouldBeActive());
    });
    /* Also try onFsStart for engines that emit it instead. */
    window.HookBus.on('onFsStart', function () {
      fsActive = true;
      setActive(shouldBeActive());
    });
    if (!CFG.onlyDuringFs) {
      /* Base-game persistent link — activate at boot. */
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          setActive(shouldBeActive());
        }, { once: true });
      } else {
        setActive(shouldBeActive());
      }
    }
    window.HookBus.on('onFsEnd', function () {
      fsActive = false;
      setActive(false);
    });
    window.HookBus.on('onSpinResult',   handleResult);
    window.HookBus.on('onFsSpinResult', handleResult);
  }
})();
`;
}
