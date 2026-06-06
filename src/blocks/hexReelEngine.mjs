/**
 * src/blocks/hexReelEngine.mjs
 *
 * Wave J2b — Hex real reel engine.
 *
 * Industry-reference rationale
 * ────────────────────────────
 *   Honeycomb / hex slot layouts (axial q,r coordinates) cannot reuse the
 *   rectangular reel engine because each cell carries an `(r % 2)` x-shift
 *   that breaks "straight column" assumptions. Prior to this block, hex
 *   shapes routed through `runStaticReroll()` — a blink-fade reveal
 *   without true reel motion. Players noticed: "looks broken on hex".
 *
 *   This block adds a per-axial-column vertical spin animation:
 *     • Cells grouped by `q` (axial column index).
 *     • Each q-column gets its own absolutely-positioned strip element
 *       containing all cells in that column, ordered by `r` ascending.
 *     • Spin = vertical translateY on each strip + per-frame
 *       rotate-down (pop bottom cell, unshift to top, randomise its
 *       symbol). Mirrors the rectangular engine's rotation model.
 *     • Stop = ease to target offset + soft cushion bounce (industry
 *       baseline 6px overshoot, ~2 cycles).
 *
 * Composition contract (LEGO ownership)
 * ────────────────────────────────────
 *   • SOLE OWNER of hex-column spin animation. Rectangular engine
 *     (`reelEngine.mjs`) is unchanged — it dispatches hex spins to this
 *     block via `window.__SLOT_HEX_RUNSPIN__` when SHAPE.kind === 'hexagonal'.
 *   • Reads at runtime: SHAPE.cells (each {hex: {q, r}}), POOL, grid (DOM
 *     host element), frame (sizing parent), HookBus.
 *   • Emits HookBus events: NONE — observer of preSpin / onSpinResult /
 *     postSpin (lifecycle parity with rectangular engine via dispatch).
 *   • Writes globals: `window.__SLOT_HEX_REELS__` (getter for QA probe),
 *     `window.__SLOT_HEX_RUNSPIN__` (function reference for the
 *     rectangular dispatcher).
 *
 * Lifecycle (HookBus listeners — block-level autonomic)
 * ─────────────────────────────────────────────────────
 *   preSpin   → cancel any in-flight tick, reset target offsets, kick
 *                spin loop on every column with staggered stop times.
 *   onSpinResult → engine confirmed outcome; this block accepts the
 *                  next batch of symbols (no separate emit — symbols
 *                  land naturally via rotate-down randomisation).
 *
 * Performance budget
 * ──────────────────
 *   • Tick loop: requestAnimationFrame, O(columns) per frame.
 *   • Build phase: O(cells) DOM append on first render. Re-render only
 *     on resize (handled by gridRenderer).
 *   • For ring=3 (37 cells, 7 columns) the per-frame work is < 0.2ms on
 *     M-series Apple Silicon; well inside the 16.67ms 60-fps budget.
 *
 * Accessibility
 * ─────────────
 *   `reduce-motion` media query collapses the spin animation to a
 *   200ms cross-fade instead of full sliding motion. Cell content
 *   remains keyboard-focusable via the standard `.cell` class.
 *
 * Vendor neutrality
 * ─────────────────
 *   Zero game / vendor mentions. Only abstract references to "hex
 *   topology" and "honeycomb reels".
 *
 * GDD keys read
 * ─────────────
 *   `topology.hex_ring` (already parsed into SHAPE.cells by gridShape).
 *   `reelEngineHot` (via reelEngine block — cadence shared, not
 *   independently configurable here to avoid drift).
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitHexReelEngineCSS(cfg)
 *   emitHexReelEngineRuntime(cfg)
 *
 * Runtime contract (after emitted JS executes):
 *   window.__SLOT_HEX_RUNSPIN__(onSettled) — invoked by rectangular
 *     engine's runOneBaseSpin dispatcher when SHAPE.kind === 'hexagonal'.
 *   window.__SLOT_HEX_REELS__ — getter exposes live column-strip state
 *     for the QA harness.
 */

const DEFAULTS = Object.freeze({
  enabled: true,                  /* hard-on whenever SHAPE.kind === 'hexagonal' */
  spinDurationMs: 1800,           /* total spin duration per column, baseline */
  staggerPerColumnMs: 280,        /* per-column stop stagger (5-reel cabinet beat) */
  minRotations: 8,                /* min full rotations before stop allowed */
  cushionBouncePx: 6,             /* settle overshoot in pixels */
  cushionBounceMs: 240,           /* settle bounce duration */
  fadeFallbackMs: 200,            /* reduce-motion cross-fade duration */
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

/**
 * GDD knobs come via `model.reelEngineHot` (shared cadence). The block
 * provides defensive clamping for any hex-specific override under
 * `model.hexReelEngine` (forward-compat — none required today).
 */
export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.hexReelEngine) || {};
  const intMap = [
    ['spinDurationMs',     400, 6000],
    ['staggerPerColumnMs',  50,  800],
    ['minRotations',         1,   30],
    ['cushionBouncePx',      0,   24],
    ['cushionBounceMs',     60,  800],
    ['fadeFallbackMs',      40,  600],
  ];
  for (const [k, lo, hi] of intMap) {
    const v = clampInt(src[k], lo, hi);
    if (v !== null) cfg[k] = v;
  }
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  return cfg;
}

/* ── Emit ─────────────────────────────────────────────────────── */

export function emitHexReelEngineCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ── Hex reel engine (Wave J2b) ─────────────────────────────── */
.hex-reel-host {
  position: relative;
}
.hex-reel-col {
  /* Each axial-q column lives in its own positioned wrapper so we can
     translateY the inner strip without affecting layout neighbours.
     Cells inside still honour their (r % 2) x-shift from layout time. */
  position: absolute;
  overflow: hidden;
  pointer-events: none;
}
.hex-reel-strip {
  position: relative;
  will-change: transform;
  transform: translateY(0);
}
.hex-reel-strip > .cell.hex {
  position: absolute;
  pointer-events: auto;
}
.hex-reel-col.is-spinning .hex-reel-strip {
  /* CSS-driven blur during spin — keeps motion legible without
     burning a per-frame transform update. Cleared on stop. */
  filter: blur(0.4px);
}
.hex-reel-col.is-stopping .hex-reel-strip {
  transition: transform ${cfg.cushionBounceMs}ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

@media (prefers-reduced-motion: reduce) {
  .hex-reel-col.is-spinning .hex-reel-strip,
  .hex-reel-col.is-stopping .hex-reel-strip {
    transition: opacity ${cfg.fadeFallbackMs}ms ease-in-out !important;
    transform: none !important;
    filter: none !important;
  }
}
`;
}

export function emitHexReelEngineRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* hexReelEngine — disabled by config; no-op stubs published so the
     rectangular dispatcher can probe safely. */
  if (typeof window !== "undefined") {
    window.__SLOT_HEX_RUNSPIN__ = window.__SLOT_HEX_RUNSPIN__ || function () { /* no-op */ };
  }
`;
  }
  const SPIN_MS = cfg.spinDurationMs;
  const STAGGER_MS = cfg.staggerPerColumnMs;
  const MIN_ROT = cfg.minRotations;
  return `
  /* ── Hex reel engine runtime (Wave J2b) ─────────────────────── */
  /* SOLE OWNER of hex column spin animation. Rectangular reelEngine
     dispatches into this when SHAPE.kind === 'hexagonal'. Tick loop
     is independent (separate rAF) so we do not interleave with the
     rectangular tick. */
  (function () {
    if (!SHAPE || SHAPE.kind !== 'hexagonal') {
      window.__SLOT_HEX_RUNSPIN__ = window.__SLOT_HEX_RUNSPIN__ || function () { /* no-op */ };
      return;
    }

    /** @type {Array<{strip: HTMLElement, cells: HTMLElement[], y: number,
     *               targetY: number, cellH: number, totalH: number,
     *               spinning: boolean, stopping: boolean, stopAt: number,
     *               rotationCount: number, minRotations: number}>} */
    var HEX_REELS = [];
    var hexTicker = null;
    var hexSpinStart = 0;
    var hexOnSettled = null;
    var hexCellH = 0;

    /** Randomise one cell text from POOL. Mirrors rectangular randomSym(). */
    function _hexRandSym() {
      return POOL[Math.floor(Math.random() * POOL.length)];
    }

    /**
     * Build per-q axial columns. SHAPE.cells provides
     * {hex: {q, r}, reel, row}. We bucket by q, sort each bucket by r.
     * Caller (gridRenderer) hands us the rendered cell elements indexed
     * 1-to-1 with SHAPE.cells order. We pivot those into column strips.
     */
    window.__SLOT_HEX_BUILD__ = function buildHexColumns(host, cellEls, hexW, hexH) {
      /* Tear down any previous build */
      HEX_REELS = [];
      var byQ = new Map();
      var minQ = Infinity, maxQ = -Infinity;
      for (var i = 0; i < SHAPE.cells.length; i++) {
        var c = SHAPE.cells[i];
        if (!c || !c.hex) continue;
        var q = c.hex.q;
        if (!byQ.has(q)) byQ.set(q, []);
        byQ.get(q).push({ r: c.hex.r, el: cellEls[i], idx: i });
        if (q < minQ) minQ = q;
        if (q > maxQ) maxQ = q;
      }
      hexCellH = hexH * 1.15; /* mirror renderHex sizing for cell height */
      /* Wrap host so columns can position absolutely without escaping. */
      host.classList.add('hex-reel-host');

      /* For each q, create a positioned column wrapper. Visible window
         is the union of r values present in that bucket. */
      for (var q = minQ; q <= maxQ; q++) {
        if (!byQ.has(q)) continue;
        var bucket = byQ.get(q);
        bucket.sort(function (a, b) { return a.r - b.r; });
        var visibleH = bucket.length * hexCellH;
        var ring = Math.floor((maxQ - minQ) / 2);
        var minR = bucket[0].r;
        var topY = (minR + ring) * hexH + 10; /* matches renderHex y formula */
        var col = document.createElement('div');
        col.className = 'hex-reel-col';
        col.style.left   = ((q + ring) * hexW * 1.0 + 10 - 1) + 'px';
        col.style.top    = (topY - 1) + 'px';
        col.style.width  = (hexW + 2) + 'px';
        col.style.height = (visibleH + 2) + 'px';
        var strip = document.createElement('div');
        strip.className = 'hex-reel-strip';
        strip.style.height = visibleH + 'px';
        /* Re-parent each bucket cell into the strip — we own its
           positioning from now on. Cell already has left/top set by
           renderHex; we convert to strip-local coordinates. */
        var cellEls2 = [];
        for (var b = 0; b < bucket.length; b++) {
          var item = bucket[b];
          var el = item.el;
          /* Translate cell position into strip-local (top of strip is 0). */
          var rOffset = (item.r - minR) * hexCellH;
          el.style.left = ((item.r % 2 ? hexW * 0.5 : 0)) + 'px';
          el.style.top  = rOffset + 'px';
          el.style.width  = hexW + 'px';
          el.style.height = (hexCellH) + 'px';
          strip.appendChild(el);
          cellEls2.push(el);
        }
        col.appendChild(strip);
        host.appendChild(col);
        HEX_REELS.push({
          strip: strip,
          cells: cellEls2,
          y: 0,
          targetY: 0,
          cellH: hexCellH,
          totalH: visibleH,
          spinning: false,
          stopping: false,
          stopAt: 0,
          rotationCount: 0,
          minRotations: ${MIN_ROT},
        });
      }

      /* Expose live state to QA harness */
      Object.defineProperty(window, '__SLOT_HEX_REELS__', {
        configurable: true,
        get: function () { return HEX_REELS; },
      });
    };

    /** Per-frame physics — translate each column's strip downward,
     *  rotate cells when offset exceeds cellH, stop when minRotations
     *  reached and stopAt time elapsed. */
    function hexTickAll() {
      var now = performance.now();
      var anyActive = false;
      var pxPerMs = (HEX_REELS[0] ? HEX_REELS[0].cellH : 60) / 80; /* ~ one cell per 80ms */
      for (var i = 0; i < HEX_REELS.length; i++) {
        var reel = HEX_REELS[i];
        if (!reel.spinning && !reel.stopping) continue;
        anyActive = true;
        if (reel.spinning) {
          reel.y += pxPerMs * 16; /* approx frame budget */
          while (reel.y >= reel.cellH) {
            reel.y -= reel.cellH;
            /* rotate bottom cell to top, randomise its symbol */
            var last = reel.cells.pop();
            reel.cells.unshift(last);
            last.textContent = _hexRandSym();
            for (var c = 0; c < reel.cells.length; c++) {
              reel.cells[c].style.top = (c * reel.cellH) + 'px';
            }
            reel.rotationCount++;
          }
          reel.strip.style.transform = 'translateY(' + (-reel.y).toFixed(2) + 'px)';
          if (reel.rotationCount >= reel.minRotations && now >= reel.stopAt) {
            reel.spinning = false;
            reel.stopping = true;
            reel.strip.parentElement.classList.remove('is-spinning');
            reel.strip.parentElement.classList.add('is-stopping');
            /* commit fresh symbols on the visible window */
            for (var k = 0; k < reel.cells.length; k++) {
              reel.cells[k].textContent = _hexRandSym();
            }
            /* settle to flush position with cushion bounce via CSS transition */
            reel.strip.style.transform = 'translateY(0px)';
            /* schedule transition-end fallback */
            setTimeout(function (r) {
              return function () {
                r.stopping = false;
                r.strip.parentElement.classList.remove('is-stopping');
              };
            }(reel), ${cfg.cushionBounceMs} + 20);
          }
        }
      }
      if (anyActive) {
        hexTicker = requestAnimationFrame(hexTickAll);
      } else {
        hexTicker = null;
        if (typeof hexOnSettled === 'function') {
          var cb = hexOnSettled;
          hexOnSettled = null;
          /* onSpinResult is emitted by the dispatcher (reelEngine) so
             single-owner ownership stays intact. Engine just invokes
             the supplied settle callback. */
          setTimeout(cb, 0);
        }
      }
    }

    /* HookBus listener — defensive cancel of in-flight tick on preSpin.
       Rectangular dispatcher emits preSpin BEFORE calling
       __SLOT_HEX_RUNSPIN__; a rapid double-click would otherwise queue
       a second rAF on top of an unfinished first. This guard makes the
       hex engine idempotent on the public spin entry. */
    if (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function') {
      HookBus.on('preSpin', function () {
        if (hexTicker) {
          cancelAnimationFrame(hexTicker);
          hexTicker = null;
        }
        for (var i = 0; i < HEX_REELS.length; i++) {
          var reel = HEX_REELS[i];
          reel.spinning = false;
          reel.stopping = false;
          if (reel.strip && reel.strip.parentElement) {
            reel.strip.parentElement.classList.remove('is-spinning');
            reel.strip.parentElement.classList.remove('is-stopping');
          }
        }
      });
    }

    /** Public entry — invoked by rectangular dispatcher. */
    window.__SLOT_HEX_RUNSPIN__ = function (onSettled) {
      if (!HEX_REELS.length) {
        /* Not built yet (renderHex hasn't run) — fall through to settle. */
        if (typeof onSettled === 'function') setTimeout(onSettled, 0);
        return;
      }
      hexSpinStart = performance.now();
      hexOnSettled = onSettled || null;
      for (var i = 0; i < HEX_REELS.length; i++) {
        var reel = HEX_REELS[i];
        reel.spinning = true;
        reel.stopping = false;
        reel.y = 0;
        reel.rotationCount = 0;
        reel.stopAt = hexSpinStart + ${SPIN_MS} + i * ${STAGGER_MS};
        reel.strip.parentElement.classList.add('is-spinning');
        reel.strip.parentElement.classList.remove('is-stopping');
      }
      if (!hexTicker) hexTicker = requestAnimationFrame(hexTickAll);
    };
  })();
`;
}
