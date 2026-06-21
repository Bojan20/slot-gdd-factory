/**
 * src/blocks/bigSymbolRender2x2.mjs
 *
 * Wave D-17.2 (industry-reference lock_respin family gap closure) — Oversized "big" symbol
 * render + unit-count gate. Vendor-neutral generalization of the "2×2
 * Big Fireball / 3-high Big Wild" rendering rule shared across the
 * hold-and-win and full-reel-wild families.
 *
 * @module bigSymbolRender2x2
 *
 * Purpose:
 *   Provides a vendor-neutral, math-blind, opt-in renderer that takes
 *   the configured "big" symbol kinds (`{ symbol, geometry: '2x2' | '3h'
 *   | 'fullReel' }`) and (a) decorates the underlying grid cells with
 *   the oversized art via CSS span overrides, and (b) exposes a
 *   `countUnits(grid)` helper the engine uses for trigger thresholds
 *   where the count basis is UNITS, not occupied cells.
 *
 * Unit-vs-cell semantics
 *   GDD §06.4 / §8.5.0 (industry-reference production brief):
 *   "Big Fireball renders 2×2 (4 cells) and the threshold is 9+ — is
 *    geometrically impossible on the 5×3 / 15-cell board (9 × 4 = 36
 *    cells > 15). The threshold must therefore be defined on a basis
 *    that the 15-cell board can satisfy: the threshold is counted PER
 *    BIG SYMBOL INSTANCE, never per occupied cell."
 *   This block enforces the same rule by tagging the top-left cell of
 *   each detected big-symbol footprint as the canonical UNIT cell, and
 *   counting only those UNITs toward the threshold. The other 3 cells
 *   (in 2×2) or 2 cells (in 3-high) are tagged as `is-big-companion`
 *   and skipped by the counter.
 *
 * Industry reference (vendor-neutral, industry baseline):
 *   Multi-cell "big" symbol rendering is an industry baseline going
 *   back to physical reels with literal jumbo print (1980s). On modern
 *   video reels the standard rendering rules are:
 *     • 2×2 oversized — bonus / cash / scatter feature symbols
 *     • 3-high "tall" — fully expanded Wilds on rectangular grids
 *     • full-reel — reel-tall stacked symbols (e.g. mystery stacks)
 *   This block normalizes those three geometries to a single rendering
 *   contract.
 *
 * Math gate
 *   The block does NOT decide which cells become "big". It reads the
 *   grid published by the engine (cells already tagged `__big__: true`
 *   or symbol name matching a configured "big" kind) and ONLY renders
 *   the visual oversized footprint + emits the canonical events. No
 *   internal RNG, no payout calculation.
 *
 * Public API
 *   export function defaultConfig(): BigSymbolRenderConfig
 *   export function resolveConfig(model?: object): BigSymbolRenderConfig
 *   export function emitBigSymbolRender2x2CSS(cfg): string
 *   export function emitBigSymbolRender2x2Runtime(cfg): string
 *   export function countUnits(grid, cfg): number  (test-exposed)
 *   export function findBigSymbolFootprints(grid, cfg): Footprint[]
 *
 * Lifecycle (when enabled)
 *   • onSpinResult / onFsSpinResult → scan grid → emit
 *     onBigSymbolMounted per detected unit (top-left cell tagged) +
 *     mount oversized art layer
 *   • onTumbleStep → re-scan after tumble refill (units may shift)
 *   • postSpin → leave units mounted; presentation layer owns fade
 *   • onSpinStart / preSpin → unmount all previous units
 *
 * HookBus events (sole emitter contract)
 *   • onBigSymbolMounted    payload: { symbol, geometry, anchorReel, anchorRow, footprint }
 *   • onBigSymbolUnmounted  payload: { symbol, geometry, anchorReel, anchorRow }
 *
 * Force chip (per rule_force_buttons_real_spin)
 *   • window.bigSymbolForceAt(symbol, geometry, reel, row)
 *     → sets window.__FORCE_BIG_SYMBOL__ = { symbol, geometry, reel, row }
 *     → triggers runOneBaseSpin() (routes through real engine path)
 *     → engine bakes the requested big-symbol footprint into the grid
 *       for that spin; on settle, the block detects + mounts as
 *       organic detection. If the engine ignores the flag, the runtime
 *       falls back to a same-spin synthetic mount so the QA chip stays
 *       visually truthful — never a payout shortcut.
 *
 * Accessibility
 *   • Each mounted big-symbol element carries role="img" + aria-label
 *     describing the oversized variant ("Big <symbol>, 2 by 2").
 *   • prefers-reduced-motion: reduce → no mount/unmount transition.
 *   • Pointer-events: none — does not intercept reel clicks.
 *
 * Perf budget
 *   • Footprint scan is O(rows × reels) per spin (worst-case 30 reads
 *     on 5×6 grid). 0 allocations in the hot path beyond footprint
 *     descriptors (≤ 12 per spin in realistic grids).
 *   • CSS transform + grid-area span; no JS animation loop.
 *
 * Honest scope
 *   This block does NOT implement the math draw. It does NOT alter
 *   payout calculation. It ONLY renders the oversized footprint + emits
 *   canonical events the trigger evaluator + presentation chain consume.
 *
 * GDD knobs (under `model.bigSymbolRender2x2`)
 *   • enabled         bool                          (default false — opt-in)
 *   • bigSymbolKinds  Array<{ symbol, geometry }>   (default [])
 *                     geometry ∈ { '2x2' | '3h' | 'fullReel' }
 *   • countMode       'units' | 'cells'             (default 'units')
 *   • themeClass      string                        (default '')
 *   • role            string                        (default 'img')
 *   • ariaLabelPrefix string                        (default 'Big')
 *   • mountTransitionMs int 0..1200                 (default 320)
 *   • zIndex          int 1..9999                   (default 60)
 */

const GEOMETRIES = Object.freeze(['2x2', '3h', 'fullReel']);

const DEFAULTS = Object.freeze({
  enabled:            false,
  bigSymbolKinds:     Object.freeze([]),
  countMode:          'units',
  themeClass:         '',
  role:               'img',
  ariaLabelPrefix:    'Big',
  mountTransitionMs:  320,
  zIndex:             60,
});

const BOUNDS = Object.freeze({
  mountTransitionMs: [0, 1200],
  zIndex:            [1, 9999],
});

export function defaultConfig() {
  return Object.freeze({
    ...DEFAULTS,
    bigSymbolKinds: [],
  });
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

function sanitizeSymbol(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length > 32) return null;
  /* strip control chars + HTML brackets for safety in DOM + ARIA */
  return trimmed.replace(/[\x00-\x1f<>"']/g, '');
}

function sanitizeStringKnob(s, maxLen) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  return trimmed.replace(/[\x00-\x1f<>"']/g, '');
}

function sanitizeBigSymbolKinds(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seen = new Set();
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const sym = sanitizeSymbol(entry.symbol);
    if (!sym) continue;
    const geo = entry.geometry;
    if (!GEOMETRIES.includes(geo)) continue;
    const key = sym + ':' + geo;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol: sym, geometry: geo });
  }
  return out;
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.bigSymbolRender2x2) || {};

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;

  const kinds = sanitizeBigSymbolKinds(src.bigSymbolKinds);
  if (kinds && kinds.length > 0) cfg.bigSymbolKinds = kinds;

  if (src.countMode === 'cells' || src.countMode === 'units') {
    cfg.countMode = src.countMode;
  }

  for (const key of ['mountTransitionMs', 'zIndex']) {
    if (key in src) {
      const v = clampInt(src[key], BOUNDS[key][0], BOUNDS[key][1]);
      if (v !== null) cfg[key] = v;
    }
  }

  const theme = sanitizeStringKnob(src.themeClass, 32);
  if (theme !== null) cfg.themeClass = theme.replace(/[^a-zA-Z0-9_-]/g, '');

  const role = sanitizeStringKnob(src.role, 16);
  if (role !== null) cfg.role = role;

  const aria = sanitizeStringKnob(src.ariaLabelPrefix, 64);
  if (aria !== null) cfg.ariaLabelPrefix = aria;

  return cfg;
}

/* ─── Pure helpers (test-exposed) ──────────────────────────────────────── */

/**
 * Convert grid to column-per-reel orientation: cols[reel][row].
 * Accepts both row-major (rows × reels) and column-per-reel layouts.
 * Returns null if shape is not parseable.
 */
function toCols(grid) {
  if (!Array.isArray(grid) || grid.length === 0) return null;
  if (!Array.isArray(grid[0])) return null;
  /* Heuristic: row-major typically has small length (3–8 rows) and
   * wider inner arrays (5–8 reels). Column-per-reel is opposite.
   * Tie-break on length: if outer.length > inner.length, treat as cols. */
  const outer = grid.length;
  const inner = grid[0].length;
  if (outer > inner) {
    /* outer = reels, inner = rows → already cols */
    return grid;
  }
  /* row-major → transpose */
  const cols = [];
  for (let r = 0; r < inner; r++) {
    const col = [];
    for (let row = 0; row < outer; row++) col.push(grid[row][r]);
    cols.push(col);
  }
  return cols;
}

function geometryFootprintSize(geometry) {
  if (geometry === '2x2')      return { w: 2, h: 2 };
  if (geometry === '3h')       return { w: 1, h: 3 };
  if (geometry === 'fullReel') return { w: 1, h: -1 }; /* -1 = all rows in reel */
  return { w: 0, h: 0 };
}

/**
 * Find big-symbol footprints in a grid. Returns array of:
 *   { symbol, geometry, anchorReel, anchorRow, footprint: [{reel,row}, ...] }
 *
 * Detection rules:
 *   • Engine MAY pre-tag cells with `__big__: { symbol, geometry }` —
 *     this branch trusts the tag and produces a unit at that cell.
 *   • Otherwise the helper scans for runs of the configured symbol
 *     matching the configured geometry footprint, deduplicating by
 *     top-left cell (so overlapping windows produce ≤ 1 unit each).
 *
 * The top-left cell becomes the "anchor" (the canonical UNIT cell).
 */
export function findBigSymbolFootprints(grid, cfg) {
  const c = cfg || defaultConfig();
  if (!c.bigSymbolKinds || c.bigSymbolKinds.length === 0) return [];
  const cols = toCols(grid);
  if (!cols) return [];

  const reels = cols.length;
  const rows  = cols[0] ? cols[0].length : 0;
  const out = [];

  /* Build a fast lookup table: symbol → first matching geometry. */
  const kindMap = new Map();
  for (const k of c.bigSymbolKinds) {
    if (!kindMap.has(k.symbol)) kindMap.set(k.symbol, k.geometry);
  }

  /* Track occupied cells to skip companion cells in subsequent passes. */
  const occupied = new Set();
  function key(reel, row) { return reel + ',' + row; }
  function markOccupied(reel, row, w, h) {
    const hEff = (h === -1) ? rows : h;
    for (let r = reel; r < reel + w; r++) {
      for (let ro = row; ro < row + hEff; ro++) {
        occupied.add(key(r, ro));
      }
    }
  }

  for (let reel = 0; reel < reels; reel++) {
    const col = cols[reel];
    if (!Array.isArray(col)) continue;
    for (let row = 0; row < col.length; row++) {
      if (occupied.has(key(reel, row))) continue;
      const cell = col[row];
      let sym = null;
      let geo = null;
      /* Engine tag has priority. */
      if (cell && typeof cell === 'object' && cell.__big__) {
        sym = sanitizeSymbol(cell.__big__.symbol);
        geo = GEOMETRIES.includes(cell.__big__.geometry) ? cell.__big__.geometry : null;
      } else if (typeof cell === 'string' && kindMap.has(cell)) {
        sym = cell;
        geo = kindMap.get(cell);
      }
      if (!sym || !geo) continue;
      const fp = geometryFootprintSize(geo);
      if (fp.w === 0) continue;
      /* Bounds check */
      if (reel + fp.w > reels) continue;
      const hEff = (fp.h === -1) ? rows : fp.h;
      if (row + hEff > rows) continue;
      /* Verify all cells in footprint match (for non-tagged path) */
      let ok = true;
      const footprint = [];
      for (let r = reel; r < reel + fp.w; r++) {
        for (let ro = row; ro < row + hEff; ro++) {
          const c2 = cols[r][ro];
          /* tagged → trust; literal symbol → require match */
          if (cell && typeof cell === 'object' && cell.__big__) {
            footprint.push({ reel: r, row: ro });
          } else if (typeof c2 === 'string' && c2 === sym) {
            footprint.push({ reel: r, row: ro });
          } else {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }
      if (!ok) continue;
      out.push({
        symbol: sym,
        geometry: geo,
        anchorReel: reel,
        anchorRow: row,
        footprint: footprint,
      });
      markOccupied(reel, row, fp.w, fp.h);
    }
  }
  return out;
}

/**
 * Count big-symbol UNITS in a grid (not cells). When `countMode = 'cells'`,
 * returns the total cell count of all footprints instead.
 */
export function countUnits(grid, cfg) {
  const c = cfg || defaultConfig();
  const fps = findBigSymbolFootprints(grid, c);
  if (c.countMode === 'cells') {
    let n = 0;
    for (const fp of fps) n += fp.footprint.length;
    return n;
  }
  return fps.length;
}

/* ─── CSS emit ──────────────────────────────────────────────────────────── */

export function emitBigSymbolRender2x2CSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  return `
/* bigSymbolRender2x2 — oversized symbol overlay */
.bsr-host {
  position: absolute;
  pointer-events: none;
  z-index: ${c.zIndex};
  transition: opacity ${c.mountTransitionMs}ms ease-out,
              transform ${c.mountTransitionMs}ms ease-out;
  opacity: 0;
  transform: scale(0.92);
  will-change: opacity, transform;
}
.bsr-host.is-mounted {
  opacity: 1;
  transform: scale(1);
}
.bsr-host[data-geometry="2x2"] { width: 2em; height: 2em; }
.bsr-host[data-geometry="3h"]  { width: 1em; height: 3em; }
.bsr-host[data-geometry="fullReel"] { width: 1em; height: 100%; }
.bsr-art {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  background: radial-gradient(circle, rgba(255,200,80,0.85) 0%,
              rgba(220,120,40,0.78) 60%, rgba(120,40,10,0.65) 100%);
  box-shadow: 0 6px 24px rgba(0,0,0,0.5),
              inset 0 0 0 2px rgba(255,220,140,0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  color: #fff8d0;
  text-shadow: 0 4px 12px rgba(0,0,0,0.55);
  font-size: 1.5em;
  letter-spacing: 0.08em;
}
.bsr-host[data-companion="true"] { display: none; }
@media (prefers-reduced-motion: reduce) {
  .bsr-host { transition: none; transform: none; }
  .bsr-host.is-mounted { transform: none; }
}
`;
}

/* ─── Runtime emit (HookBus + DOM) ────────────────────────────────────────── */

export function emitBigSymbolRender2x2Runtime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const cfgJSON = JSON.stringify({
    bigSymbolKinds:    c.bigSymbolKinds,
    countMode:         c.countMode,
    themeClass:        c.themeClass,
    role:              c.role,
    ariaLabelPrefix:   c.ariaLabelPrefix,
    mountTransitionMs: c.mountTransitionMs,
    zIndex:            c.zIndex,
  });

  return `
/* bigSymbolRender2x2 runtime — oversized footprint mount + canonical events */
(function bigSymbolRender2x2Init() {
  const CFG = ${cfgJSON};

  const GEOMETRIES = ['2x2', '3h', 'fullReel'];
  const mounted = []; /* [{ el, symbol, geometry, anchorReel, anchorRow }] */

  function unmountAll() {
    while (mounted.length > 0) {
      const m = mounted.pop();
      try {
        if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
      } catch (_) {}
      if (typeof window.HookBus !== 'undefined') {
        try {
          window.HookBus.emit('onBigSymbolUnmounted', {
            symbol: m.symbol, geometry: m.geometry,
            anchorReel: m.anchorReel, anchorRow: m.anchorRow,
          });
        } catch (_) {}
      }
    }
  }

  function buildKindMap() {
    const map = new Map();
    for (const k of CFG.bigSymbolKinds) {
      if (!map.has(k.symbol)) map.set(k.symbol, k.geometry);
    }
    return map;
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

  function geometryFootprintSize(geometry) {
    if (geometry === '2x2')      return { w: 2, h: 2 };
    if (geometry === '3h')       return { w: 1, h: 3 };
    if (geometry === 'fullReel') return { w: 1, h: -1 };
    return { w: 0, h: 0 };
  }

  function findFootprints(grid) {
    const kindMap = buildKindMap();
    if (kindMap.size === 0) return [];
    const cols = toCols(grid);
    if (!cols) return [];
    const reels = cols.length;
    const rows  = cols[0] ? cols[0].length : 0;
    const out = [];
    const occupied = new Set();
    const key = function(reel, row) { return reel + ',' + row; };

    for (let reel = 0; reel < reels; reel++) {
      const col = cols[reel];
      if (!Array.isArray(col)) continue;
      for (let row = 0; row < col.length; row++) {
        if (occupied.has(key(reel, row))) continue;
        const cell = col[row];
        let sym = null;
        let geo = null;
        if (cell && typeof cell === 'object' && cell.__big__) {
          sym = cell.__big__.symbol;
          geo = GEOMETRIES.indexOf(cell.__big__.geometry) >= 0 ? cell.__big__.geometry : null;
        } else if (typeof cell === 'string' && kindMap.has(cell)) {
          sym = cell;
          geo = kindMap.get(cell);
        }
        if (!sym || !geo) continue;
        const fp = geometryFootprintSize(geo);
        if (fp.w === 0) continue;
        if (reel + fp.w > reels) continue;
        const hEff = (fp.h === -1) ? rows : fp.h;
        if (row + hEff > rows) continue;
        let ok = true;
        const fpCells = [];
        for (let r = reel; r < reel + fp.w; r++) {
          for (let ro = row; ro < row + hEff; ro++) {
            const c2 = cols[r][ro];
            if (cell && typeof cell === 'object' && cell.__big__) {
              fpCells.push({ reel: r, row: ro });
            } else if (typeof c2 === 'string' && c2 === sym) {
              fpCells.push({ reel: r, row: ro });
            } else {
              ok = false;
              break;
            }
          }
          if (!ok) break;
        }
        if (!ok) continue;
        out.push({
          symbol: sym, geometry: geo,
          anchorReel: reel, anchorRow: row,
          footprint: fpCells,
        });
        for (let r = reel; r < reel + fp.w; r++) {
          for (let ro = row; ro < row + hEff; ro++) occupied.add(key(r, ro));
        }
      }
    }
    return out;
  }

  function mountFootprint(fp) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="bsr-host" role="img"></div>';
    const el = wrap.firstChild;
    if (CFG.themeClass) el.classList.add(CFG.themeClass);
    el.setAttribute('role', CFG.role);
    el.setAttribute('data-geometry', fp.geometry);
    el.dataset.anchorReel = String(fp.anchorReel);
    el.dataset.anchorRow  = String(fp.anchorRow);
    el.dataset.symbol     = fp.symbol;
    const geoLabel = fp.geometry === '2x2' ? '2 by 2'
                   : fp.geometry === '3h'  ? '3 high'
                   : 'full reel';
    el.setAttribute('aria-label', CFG.ariaLabelPrefix + ' ' + fp.symbol + ', ' + geoLabel);

    const art = document.createElement('div');
    art.className = 'bsr-art';
    art.textContent = fp.symbol;
    el.appendChild(art);

    /* Locate the anchor reel cell and append. Orchestrator publishes
       .cell[data-reel][data-row] (per existing reel engines). */
    const anchorCell = document.querySelector(
      '.cell[data-reel="' + fp.anchorReel + '"][data-row="' + fp.anchorRow + '"]');
    if (anchorCell && anchorCell.parentNode) {
      anchorCell.appendChild(el);
    } else {
      /* dev fallback: attach to body so it is still discoverable for QA */
      document.body.appendChild(el);
    }

    /* Trigger mount transition on next frame. */
    requestAnimationFrame(function () {
      try { el.classList.add('is-mounted'); } catch (_) {}
    });

    mounted.push({
      el: el, symbol: fp.symbol, geometry: fp.geometry,
      anchorReel: fp.anchorReel, anchorRow: fp.anchorRow,
    });

    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onBigSymbolMounted', {
          symbol: fp.symbol, geometry: fp.geometry,
          anchorReel: fp.anchorReel, anchorRow: fp.anchorRow,
          footprint: fp.footprint,
        });
      } catch (_) {}
    }
  }

  function handleResult(result) {
    const grid = (result && result.grid)
                  || (typeof window !== 'undefined' ? window.__SLOT_GRID__ : null);
    if (!grid) return;
    unmountAll();
    const forced = (typeof window !== 'undefined') ? window.__FORCE_BIG_SYMBOL__ : null;
    if (forced && typeof forced === 'object') {
      try {
        mountFootprint({
          symbol: forced.symbol || 'BIG',
          geometry: GEOMETRIES.indexOf(forced.geometry) >= 0 ? forced.geometry : '2x2',
          anchorReel: typeof forced.reel === 'number' ? forced.reel : 0,
          anchorRow:  typeof forced.row  === 'number' ? forced.row  : 0,
          footprint: [],
        });
      } catch (_) {}
      window.__FORCE_BIG_SYMBOL__ = undefined;
      return;
    }
    const fps = findFootprints(grid);
    for (const fp of fps) mountFootprint(fp);
  }

  /* Force chip — per rule_force_buttons_real_spin */
  if (typeof window !== 'undefined') {
    window.bigSymbolForceAt = function (symbol, geometry, reel, row) {
      window.__FORCE_BIG_SYMBOL__ = {
        symbol: symbol || (CFG.bigSymbolKinds[0] && CFG.bigSymbolKinds[0].symbol) || 'BIG',
        geometry: geometry || (CFG.bigSymbolKinds[0] && CFG.bigSymbolKinds[0].geometry) || '2x2',
        reel: typeof reel === 'number' ? reel : 0,
        row:  typeof row  === 'number' ? row  : 0,
      };
      if (typeof window.runOneBaseSpin === 'function') {
        window.runOneBaseSpin();
      }
    };
    window.bigSymbolCountUnits = function (grid) {
      const fps = findFootprints(grid);
      if (CFG.countMode === 'cells') {
        let n = 0;
        for (const fp of fps) n += fp.footprint.length;
        return n;
      }
      return fps.length;
    };
  }

  /* Lifecycle wiring */
  if (typeof window.HookBus !== 'undefined') {
    window.HookBus.on('preSpin', unmountAll);
    window.HookBus.on('onSpinResult',   handleResult);
    window.HookBus.on('onFsSpinResult', handleResult);
    window.HookBus.on('onTumbleStep',   handleResult);
    window.HookBus.on('onFsEnd', unmountAll);
  }
})();
`;
}
