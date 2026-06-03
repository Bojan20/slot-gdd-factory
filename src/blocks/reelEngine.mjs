/**
 * Slot GDD Factory · reelEngine BLOCK (hot-path)
 *
 * The complete reel spin engine — column builder + tick loop + spin
 * orchestrator + static-reroll fallback for non-uniform grids. This is the
 * hottest path in the runtime; emitter bakes every magic number as a literal
 * so the browser bundle never pays config-object dereference cost.
 *
 * Emitted runtime symbols (all at the build's enclosing scope):
 *   RECT_REELS / RECT_SIDE                  shared reel-array state
 *   spinTicker / spinStartTime / allReelsActive   tick-loop state
 *   FORCE_TRIGGER                           dev-FS planted-scatter flag
 *   randomSym()                             POOL roll
 *   rotateStripDown(reel)                   bottom→top cell rotation
 *   commitStopSymbols(reel, reelIdx)        settle outcome + force-trigger
 *   buildReelColumns(host, cols, rowsCountOrArray, side, extraCellClass)
 *   startSpinAll(onSettled)                 windup + tick loop entry
 *   onTickAll()                             per-frame physics
 *   runOneBaseSpin()                        BASE click dispatcher
 *   runStaticReroll(onSettled)              non-uniform grid reveal
 *
 * Runtime dependencies (must exist in enclosing scope):
 *   POOL, SHAPE, REELS, ROWS, FREESPINS, FSM, UNIFORM_REEL_KINDS,
 *   grid, makeCell, symAt, SPIN_PROFILE, maybeArmAnticipation,
 *   handlePostSpin, cancelWinSymCycle.
 *
 * GDD-driven configuration (consumed from `model.reelEngineHot`):
 *   minRotations          number — minimum full rotations per reel (default 8)
 *   settleBreathMs        number ms — pause after settle before onSettled  (default 80)
 *   stripBufferCells      number — total buffer cells per strip (top+bottom) (default 2)
 *   staticPreRollMs       number ms — pre-roll before swap (static path)  (default 220)
 *   staticBlurSwapMs      number ms — blur clear delay (static path)      (default 220)
 *   staticStaggerMs       number ms — per-column stagger (static path)    (default 200)
 *   staticHoldMs          number ms — anticipation hold (static path)     (default 400)
 *   staticSettleMs        number ms — final settle pause (static path)    (default 80)
 *   staticFallbackMs      number ms — empty-grid onSettled timeout        (default 60)
 *   snapThreshold         number — px distance below which strip snaps    (default 0.6)
 *   minStepPx             number — min step px during ease toward target  (default 0.5)
 *   accelMinFactor        number — accel ramp start factor (0..1)         (default 0.3)
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitReelEngineRuntime(cfg) → runtime JS string
 */

const DEFAULTS = Object.freeze({
  minRotations: 8,
  settleBreathMs: 80,
  stripBufferCells: 2,
  staticPreRollMs: 220,
  staticBlurSwapMs: 220,
  staticStaggerMs: 200,
  staticHoldMs: 400,
  staticSettleMs: 80,
  staticFallbackMs: 60,
  snapThreshold: 0.6,
  minStepPx: 0.5,
  accelMinFactor: 0.3,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}
function clampFloat(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.reelEngineHot) || {};
  const intMap = [
    ['minRotations',      1,   30],
    ['settleBreathMs',    0, 1000],
    ['stripBufferCells',  1,    8],
    ['staticPreRollMs',   0, 2000],
    ['staticBlurSwapMs',  0, 2000],
    ['staticStaggerMs',   0, 1000],
    ['staticHoldMs',      0, 2000],
    ['staticSettleMs',    0, 1000],
    ['staticFallbackMs',  0,  500],
  ];
  for (const [k, lo, hi] of intMap) {
    if (k in src) {
      const v = clampInt(src[k], lo, hi);
      if (v !== null) cfg[k] = v;
    }
  }
  const floatMap = [
    ['snapThreshold',  0.01, 5],
    ['minStepPx',      0.01, 5],
    ['accelMinFactor', 0,    1],
  ];
  for (const [k, lo, hi] of floatMap) {
    if (k in src) {
      const v = clampFloat(src[k], lo, hi);
      if (v !== null) cfg[k] = v;
    }
  }
  return cfg;
}

export function emitReelEngineRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ reelEngineHot: cfg });
  return `
  /* ── reelEngine BLOCK (hot-path) — emitted by src/blocks/reelEngine.mjs ──
     GDD knobs baked at build time:
       minRotations       = ${c.minRotations}
       settleBreathMs     = ${c.settleBreathMs}
       stripBufferCells   = ${c.stripBufferCells}
       staticPreRollMs    = ${c.staticPreRollMs}
       staticBlurSwapMs   = ${c.staticBlurSwapMs}
       staticStaggerMs    = ${c.staticStaggerMs}
       staticHoldMs       = ${c.staticHoldMs}
       staticSettleMs     = ${c.staticSettleMs}
       staticFallbackMs   = ${c.staticFallbackMs}
       snapThreshold      = ${c.snapThreshold}
       minStepPx          = ${c.minStepPx}
       accelMinFactor     = ${c.accelMinFactor} */

  /* Shared reel-array state — exposed for the QA harness via window getter. */
  let RECT_REELS = null;
  let RECT_SIDE = 0;

  /* Tick-loop state. */
  let spinTicker = null;
  let spinStartTime = 0;
  let allReelsActive = false;

  /* Force-trigger flag — when set before a spin, the stop-symbol commit
     guarantees N scatters across the first N reels, mirroring "you spun
     into a feature". The DEV FS button uses this. */
  let FORCE_TRIGGER = null;   /* { scatterCount: 3 } | null */

  function randomSym() { return POOL[Math.floor(Math.random() * POOL.length)]; }

  function rotateStripDown(reel) {
    /* Pop bottom cell DOM node, unshift to top, randomize its symbol —
       mirrors WoO's reel.cells.pop() / unshift() rotation. */
    const last = reel.cells.pop();
    reel.cells.unshift(last);
    last.textContent = randomSym();
    for (let i = 0; i < reel.cells.length; i++) {
      reel.strip.appendChild(reel.cells[i]);
    }
    reel.rotationCount++;
  }

  function commitStopSymbols(reel, reelIdx) {
    /* On stop: ensure the next visibleRows cells (indexes 1..visibleRows)
       get a fresh, settled outcome. Top/bottom buffers kept for the bounce. */
    const vis = reel.visibleRows || ROWS;
    for (let i = 1; i <= vis; i++) {
      reel.cells[i].textContent = randomSym();
    }
    /* Force-trigger plant: scatter on centre row of first N reels. */
    if (FORCE_TRIGGER && reelIdx < FORCE_TRIGGER.scatterCount) {
      const trig = (FREESPINS.triggerSymbol || "S");
      const midRow = Math.max(1, Math.ceil(vis / 2));
      reel.cells[midRow].textContent = trig;
    }
  }

  function buildReelColumns(host, cols, rowsCountOrArray, side, extraCellClass, anchor) {
    /* Shared reel-strip column builder for every uniform-reel shape.
       rowsCountOrArray:
         number  — uniform: every reel has the same row count
         array   — per-reel (variable_reel/diamond/pyramid): column c has
                   rowsArray[c] visible rows.
       anchor (optional):
         'center' (default) — diamond / variable_reel hourglass silhouette
         'bottom'           — pyramid (rows anchored to bottom of host)
         'top'              — inverse-pyramid silhouette (future) */
    RECT_REELS = [];
    RECT_SIDE = side;
    const align = anchor === 'bottom' ? 'bottom'
                : anchor === 'top'    ? 'top'
                :                       'center';
    const rowsArray = Array.isArray(rowsCountOrArray)
      ? rowsCountOrArray
      : Array.from({ length: cols }, () => rowsCountOrArray);
    const maxRows = rowsArray.reduce((m, r) => Math.max(m, r), 0);
    let symIdx = 0;
    for (let c = 0; c < cols; c++) {
      const visibleRows = rowsArray[c];
      const reelH = visibleRows * side + (visibleRows - 1) * 6;
      const rowOffset = align === 'bottom' ? (maxRows - visibleRows)
                      : align === 'top'    ? 0
                      :                      Math.floor((maxRows - visibleRows) / 2);
      const col = document.createElement("div");
      col.className = "reelCol";
      col.style.width = side + "px";
      col.style.height = reelH + "px";
      col.style.gridColumn = (c + 1) + " / " + (c + 2);
      col.style.gridRow = (rowOffset + 1) + " / span " + visibleRows;

      const strip = document.createElement("div");
      strip.className = "reelStrip";
      const stripCells = visibleRows + ${c.stripBufferCells};
      const cellRefs = [];
      for (let r = 0; r < stripCells; r++) {
        const cell = makeCell(symAt(symIdx++), extraCellClass);
        cell.style.width = side + "px";
        cell.style.height = side + "px";
        cell.style.fontSize = (side * 0.32) + "px";
        cell.style.flex = "0 0 auto";
        strip.appendChild(cell);
        cellRefs.push(cell);
      }
      const cellStep = side + 6;
      strip.style.transform = "translateY(" + (-cellStep) + "px)";
      col.appendChild(strip);
      host.appendChild(col);
      RECT_REELS.push({
        col, strip, side, cellStep,
        cells: cellRefs,
        visibleRows,
        offsetPx: 0,
        spinning: false,
        stopping: false,
        stopRequested: false,
        stopRequestTime: 0,
        targetY: -cellStep,
        rotationCount: 0,
        minRotations: ${c.minRotations},
        stopDelayMs: 0,
      });
    }
  }

  function startSpinAll(onSettled) {
    if (!RECT_REELS || allReelsActive) return;
    allReelsActive = true;
    spinStartTime = performance.now();
    const spinBtn = document.getElementById("spinBtn");
    const statusEl = document.getElementById("status");
    spinBtn.classList.add("is-spinning");
    if (!statusEl.textContent.startsWith("FS")) {
      statusEl.textContent = "SPINNING";
    }

    RECT_REELS.forEach((reel, idx) => {
      reel.spinning = true;
      reel.stopping = false;
      reel.stopRequested = false;
      reel.rotationCount = 0;
      reel.offsetPx = 0;
      reel.anticipating = false;
      if (reel.glowTimerId) { clearTimeout(reel.glowTimerId); reel.glowTimerId = null; }
      reel.col.classList.remove("reelCol--anticipating");
      reel.scheduledStopAt = performance.now() +
        SPIN_PROFILE.windupMs + SPIN_PROFILE.accelMs +
        SPIN_PROFILE.steadyMs + idx * SPIN_PROFILE.staggerMs;
      reel.cells.forEach(c => c.classList.add("is-blurring"));

      const initialDelay = reel.scheduledStopAt - performance.now();
      reel.stopTimerId = setTimeout(() => {
        reel.stopRequested = true;
        reel.stopRequestTime = performance.now();
      }, Math.max(0, initialDelay));
    });

    if (!spinTicker) {
      const tick = () => {
        const stillActive = onTickAll();
        if (stillActive) {
          spinTicker = requestAnimationFrame(tick);
        } else {
          spinTicker = null;
          allReelsActive = false;
          spinBtn.classList.remove("is-spinning");
          if (!statusEl.textContent.startsWith("FS")) {
            statusEl.textContent = "PRESS SPIN";
          }
          if (typeof onSettled === "function") {
            setTimeout(onSettled, ${c.settleBreathMs});
          }
        }
      };
      spinTicker = requestAnimationFrame(tick);
    }
  }

  function onTickAll() {
    const baseSpeed = Math.max(20, RECT_SIDE * 0.25);
    let anyActive = false;
    const now = performance.now();

    for (const reel of RECT_REELS) {
      if (reel.spinning) {
        anyActive = true;
        const reelElapsed = now - spinStartTime;

        let speedPxPerFrame = baseSpeed;
        if (reelElapsed < SPIN_PROFILE.accelMs) {
          const p = Math.max(0, reelElapsed / SPIN_PROFILE.accelMs);
          speedPxPerFrame = baseSpeed * (${c.accelMinFactor} + ${(1 - c.accelMinFactor).toFixed(4)} * p);
        }

        reel.offsetPx += speedPxPerFrame;

        while (reel.offsetPx >= reel.cellStep) {
          reel.offsetPx -= reel.cellStep;
          rotateStripDown(reel);

          if (reel.stopRequested) {
            const stopElapsed = now - reel.stopRequestTime;
            if (reel.rotationCount >= reel.minRotations && stopElapsed >= reel.stopDelayMs) {
              reel.spinning = false;
              reel.stopping = true;
              reel.stopStartMs = now;
              const reelIdx = RECT_REELS.indexOf(reel);
              commitStopSymbols(reel, reelIdx);
              reel.col.classList.remove("reelCol--anticipating");
              reel.targetY = -reel.cellStep;
              maybeArmAnticipation();
            }
          }
        }

        const rawY = reel.offsetPx - reel.cellStep;
        reel.strip.style.transform = "translateY(" + Math.round(rawY) + "px)";
      } else if (reel.stopping) {
        anyActive = true;
        const easingSpeed = SPIN_PROFILE.decelEasingSpeed || 0.18;
        const snapThreshold = ${c.snapThreshold};
        const currentY = parseFloat(reel.strip.style.transform.replace(/[^\\-0-9.]/g, "")) || 0;
        const delta = reel.targetY - currentY;

        if (Math.abs(delta) <= snapThreshold) {
          reel.strip.style.transform = "translateY(" + reel.targetY + "px)";
          reel.stopping = false;
          reel.stopped = true;
          reel.cells.forEach(c => c.classList.remove("is-blurring"));

          if (SPIN_PROFILE.bouncePx > 0) {
            reel.bouncing = true;
            reel.bounceT = 0;
            reel.bounceIteration = 0;
            reel.bouncePhase = 'drop';
            reel.bounceBaseY = reel.targetY;
            reel.bouncePx = SPIN_PROFILE.bouncePx;
          }
        } else {
          let step = delta * easingSpeed;
          if (Math.abs(step) < ${c.minStepPx} && Math.abs(delta) > snapThreshold) {
            step = delta > 0 ? 1 : -1;
          }
          reel.strip.style.transform = "translateY(" + Math.round(currentY + step) + "px)";
        }
      } else if (reel.bouncing) {
        anyActive = true;
        reel.bounceT++;
        const t = reel.bounceT;
        const iter = reel.bounceIteration;
        const baseY = reel.bounceBaseY;
        const currentAmp = reel.bouncePx * Math.pow(SPIN_PROFILE.bounceDecay, iter);

        if (currentAmp < ${c.minStepPx} || iter >= SPIN_PROFILE.bounceCount) {
          reel.strip.style.transform = "translateY(" + baseY + "px)";
          reel.bouncing = false;
        } else {
          const dropFrames = Math.max(4, Math.round(6 - iter * 1.0));
          const returnFrames = Math.max(5, Math.round(9 - iter * 1.5));
          let offset = 0;
          if (reel.bouncePhase === 'drop') {
            const dp = Math.min(1, t / dropFrames);
            const eased = 1 - Math.pow(1 - dp, SPIN_PROFILE.bounceElasticity);
            offset = currentAmp * eased;
            if (t >= dropFrames) { reel.bouncePhase = 'return'; reel.bounceT = 0; }
          } else {
            const rp = Math.min(1, t / returnFrames);
            const eased = rp < 0.5 ? 2 * rp * rp : 1 - Math.pow(-2 * rp + 2, 2) / 2;
            offset = currentAmp * (1 - eased);
            if (t >= returnFrames) {
              reel.bounceIteration = iter + 1;
              reel.bouncePhase = 'drop';
              reel.bounceT = 0;
            }
          }
          reel.strip.style.transform = "translateY(" + Math.round(baseY + offset) + "px)";
        }
      }
    }
    return anyActive;
  }

  function runOneBaseSpin() {
    cancelWinSymCycle();
    if (UNIFORM_REEL_KINDS.has(SHAPE.kind) && RECT_REELS) {
      startSpinAll(() => handlePostSpin(false));
    } else {
      runStaticReroll(() => handlePostSpin(false));
    }
  }

  function runStaticReroll(onSettled) {
    /* SVG-based kinds (wheel/crash) keep their symbols inside <text> nodes
       rather than .cell divs. Selector covers both so wheel scatter detection
       works on top of the same reroll path. */
    const cellsAll = grid.querySelectorAll(".cell, text");
    if (cellsAll.length === 0) {
      if (typeof onSettled === "function") setTimeout(onSettled, ${c.staticFallbackMs});
      return;
    }

    const COL_KINDS = new Set([
      'cluster', 'megaclusters', 'lock_respin', 'expanding', 'infinity',
    ]);
    const isColumnGrid = COL_KINDS.has(SHAPE.kind) && REELS > 0;

    const trig = (FREESPINS.triggerSymbol || "S");
    const forceN = FORCE_TRIGGER ? FORCE_TRIGGER.scatterCount : 0;

    if (!isColumnGrid) {
      /* Legacy two-phase blink for SVG and irregular HTML grids. */
      cellsAll.forEach(c => c.classList.add("is-blurring"));
      setTimeout(() => {
        cellsAll.forEach((c, i) => {
          c.textContent = (i < forceN) ? trig : (randomSym() || "?");
        });
        setTimeout(() => {
          cellsAll.forEach(c => c.classList.remove("is-blurring"));
          if (typeof onSettled === "function") onSettled();
        }, ${c.staticBlurSwapMs});
      }, ${c.staticPreRollMs});
      return;
    }

    /* Sequential column reveal for cell-grid shapes. */
    const htmlCells = Array.from(grid.querySelectorAll(".cell"));
    const cols = REELS;
    const colCells = Array.from({ length: cols }, () => []);
    htmlCells.forEach((c, i) => colCells[i % cols].push(c));

    const resolved = htmlCells.map((_, i) =>
      (i < forceN) ? trig : (randomSym() || "?")
    );
    const upperTrig = trig.toUpperCase();

    htmlCells.forEach(c => c.classList.add("is-blurring"));

    const threshold = (FREESPINS.triggerCounts && FREESPINS.triggerCounts[0]) ||
                      (FREESPINS.awards && FREESPINS.awards[0] && FREESPINS.awards[0].count) || 3;
    const topRung = (FREESPINS.awards || []).reduce(
      (m, a) => Math.max(m, a.count), threshold);
    const countMode = (FREESPINS.countMode === 'any') ? 'any' : 'perReel';

    const STAGGER = ${c.staticStaggerMs};
    const HOLD_BASE = ${c.staticHoldMs};
    let scattersSoFar = 0;
    let anticipationArmed = false;
    let elapsed = ${c.staticPreRollMs};

    function revealColumn(c) {
      for (const cell of colCells[c]) {
        const i = htmlCells.indexOf(cell);
        cell.textContent = resolved[i];
        cell.classList.remove("is-blurring");
        cell.classList.remove("cell--anticipating");
      }
      const hitsInCol = colCells[c].reduce(
        (n, cell) => n + ((cell.textContent || "").toUpperCase() === upperTrig ? 1 : 0), 0);
      scattersSoFar += (countMode === 'any') ? hitsInCol : (hitsInCol > 0 ? 1 : 0);

      const remaining = cols - (c + 1);
      const gate = Math.max(1, threshold - 1);
      const stillNeedsTrigger = scattersSoFar + remaining >= threshold;
      const armNow = scattersSoFar >= gate && stillNeedsTrigger && scattersSoFar < topRung;
      if (armNow) {
        anticipationArmed = true;
        for (let nc = c + 1; nc < cols; nc++) {
          for (const cell of colCells[nc]) cell.classList.add("cell--anticipating");
        }
      } else if (anticipationArmed && !armNow) {
        anticipationArmed = false;
        for (let nc = c + 1; nc < cols; nc++) {
          for (const cell of colCells[nc]) cell.classList.remove("cell--anticipating");
        }
      }
    }

    /* Pre-compute cumulative scatter count after each column lands. */
    const cumulativeAfter = new Array(cols).fill(0);
    {
      let acc = 0;
      for (let c = 0; c < cols; c++) {
        let hits = 0;
        for (let ri = 0; ri < colCells[c].length; ri++) {
          const i = c + ri * cols;
          if ((resolved[i] || "").toUpperCase() === upperTrig) hits++;
        }
        acc += (countMode === 'any') ? hits : (hits > 0 ? 1 : 0);
        cumulativeAfter[c] = acc;
      }
    }

    const gate = Math.max(1, threshold - 1);
    let cursor = elapsed;
    for (let c = 0; c < cols; c++) {
      const colIdx = c;
      const fireAt = cursor;
      setTimeout(() => revealColumn(colIdx), fireAt);
      cursor += STAGGER;
      if (c < cols - 1) {
        const cumNow = cumulativeAfter[c];
        const futureRemaining = cols - (c + 1);
        const armed = cumNow >= gate &&
                      (cumNow + futureRemaining >= threshold) &&
                       cumNow < topRung;
        if (armed) cursor += HOLD_BASE;
      }
    }

    setTimeout(() => {
      if (typeof onSettled === "function") onSettled();
    }, cursor + ${c.staticSettleMs});
    return;
  }
`;
}
