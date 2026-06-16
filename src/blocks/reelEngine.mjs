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

const MAX_MIN_ROTATIONS = 30;
const MAX_SETTLE_MS = 1000;
const MAX_STRIP_BUFFER_CELLS = 8;
const MAX_STATIC_MS = 2000;
const MAX_STAGGER_MS = 1000;
const MAX_FALLBACK_MS = 500;
const MAX_FLOAT_PX = 5;
const MIN_FLOAT_PX = 0.01;

const RANGES = Object.freeze({
  minRotations:     [1, MAX_MIN_ROTATIONS],
  settleBreathMs:   [0, MAX_SETTLE_MS],
  stripBufferCells: [1, MAX_STRIP_BUFFER_CELLS],
  staticPreRollMs:  [0, MAX_STATIC_MS],
  staticBlurSwapMs: [0, MAX_STATIC_MS],
  staticStaggerMs:  [0, MAX_STAGGER_MS],
  staticHoldMs:     [0, MAX_STATIC_MS],
  staticSettleMs:   [0, MAX_STAGGER_MS],
  staticFallbackMs: [0, MAX_FALLBACK_MS],
  snapThreshold:    [MIN_FLOAT_PX, MAX_FLOAT_PX],
  minStepPx:        [MIN_FLOAT_PX, MAX_FLOAT_PX],
  accelMinFactor:   [0, 1],
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
    ['minRotations',      ...RANGES.minRotations],
    ['settleBreathMs',    ...RANGES.settleBreathMs],
    ['stripBufferCells',  ...RANGES.stripBufferCells],
    ['staticPreRollMs',   ...RANGES.staticPreRollMs],
    ['staticBlurSwapMs',  ...RANGES.staticBlurSwapMs],
    ['staticStaggerMs',   ...RANGES.staticStaggerMs],
    ['staticHoldMs',      ...RANGES.staticHoldMs],
    ['staticSettleMs',    ...RANGES.staticSettleMs],
    ['staticFallbackMs',  ...RANGES.staticFallbackMs],
  ];
  for (const [k, lo, hi] of intMap) {
    if (k in src) {
      const v = clampInt(src[k], lo, hi);
      if (v !== null) cfg[k] = v;
    }
  }
  const floatMap = [
    ['snapThreshold',  ...RANGES.snapThreshold],
    ['minStepPx',      ...RANGES.minStepPx],
    ['accelMinFactor', ...RANGES.accelMinFactor],
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
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
    for (const k of Object.keys(cfg)) {
      if (!(k in DEFAULTS)) console.warn('[reelEngine] unknown cfg key:', k);
    }
  }
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
  let staticRerollInFlight = false;

  /* Force-trigger flag — when set before a spin, the stop-symbol commit
     guarantees N scatters across the first N reels, mirroring "you spun
     into a feature". The DEV FS button uses this. */
  let FORCE_TRIGGER = null;   /* { scatterCount: 3 } | null */

  /* 2026-06-09 — Boki bug: "posle par spinova izgube neki simboli tj celije
     iz reel frame-a". Root cause: if POOL is somehow empty (or returns falsy)
     and the rotation/commit writes that to textContent, the cell is left with
     empty text — visually invisible. Guarantee a printable glyph on every
     write. The '?' fallback is the same one the constructor (makeCell) uses
     so the visual contract holds across the whole grid lifecycle. */
  function randomSym() {
    if (!Array.isArray(POOL) || POOL.length === 0) return '?';
    const s = POOL[Math.floor(Math.random() * POOL.length)];
    return (s == null || s === '') ? '?' : s;
  }

  function rotateStripDown(reel) {
    /* Pop bottom cell DOM node, unshift to top, randomize its symbol —
       mirrors the industry-standard reel.cells.pop() / unshift() rotation.

       2026-06-10 (Boki H&W rule): if a cell carries .is-locked-bonus (a
       hold-and-win locked orb), it must STAY pinned to its visible row
       across every respin tick. Industry reference (WoO hnwController.ts
       L735): "querySelectorAll('.hnw-cell:not(.has-orb)')" — only non-orb
       cells participate in the per-cell spin.

       2026-06-16 (Boki bug fix: "ta celija gde se nalzi taj orb…
       je sticky i ne pomenra se dok se sve ostale celije pomeraju"):
       previous implementation walked bottom-up to skip locked cells on
       the splice, BUT still unshifted the popped cell to array[0]. That
       displaces ANY locked cell sitting between the popped index and the
       top by one slot DOWN each tick — the orb visibly drifts. Correct
       fix: rotate only the NON-LOCKED sub-list while preserving the
       original indices of locked cells verbatim. */
    const cells = reel.cells;
    const lockedIdx = [];
    const nonLockedCells = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c && c.classList && c.classList.contains('is-locked-bonus')) {
        lockedIdx.push(i);
      } else {
        nonLockedCells.push(c);
      }
    }
    if (nonLockedCells.length === 0) {
      /* Every cell is locked — no rotation possible; counter still advances
       * so the outer settle loop can terminate. */
      reel.rotationCount++;
      return;
    }
    /* Rotate the non-locked sub-list: pop bottom, unshift to top, randomize
     * the symbol of the recycled cell. Visually this is the same rotation
     * the player already sees on a normal reel — the difference is locked
     * cells DO NOT participate, so they stay where they were. */
    const last = nonLockedCells.pop();
    nonLockedCells.unshift(last);
    var _sym = randomSym();
    /* Belt+brace — if randomSym ever returned falsy past the guard, keep the
       previous glyph instead of erasing the cell. Better stale than empty. */
    last.textContent = _sym || last.textContent || '?';

    /* Reassemble the cells array: locked cells at their original index;
     * non-locked cells fill the remaining slots in rotated order. */
    const next = new Array(cells.length);
    for (let k = 0; k < lockedIdx.length; k++) {
      next[lockedIdx[k]] = cells[lockedIdx[k]];
    }
    let nlPtr = 0;
    for (let i = 0; i < next.length; i++) {
      if (next[i] === undefined) next[i] = nonLockedCells[nlPtr++];
    }
    reel.cells = next;

    /* Re-append in current order so visual DOM matches the rotated array.
       Locked cells stay where they are; non-locked cells shuffle around them. */
    for (let i = 0; i < reel.cells.length; i++) {
      reel.strip.appendChild(reel.cells[i]);
    }
    reel.rotationCount++;
  }

  function commitStopSymbols(reel, reelIdx) {
    /* On stop: ensure the next visibleRows cells (indexes 1..visibleRows)
       get a fresh, settled outcome. Top/bottom buffers kept for the bounce. */
    const vis = reel.visibleRows || ROWS;
    /* 2026-06-09 — Boki bug fix: WoO GDD explicitly says "Max 1 Scatter
       po rilu po spinu" (industry-standard scatter-stacking prevention).
       The countMode='perReel' parser path correctly counts scatters
       across distinct reels, but at the RANDOM-FILL layer the engine
       previously allowed multiple scatter symbols inside the same reel
       window — a small but real natural-deal probability when scatter
       weight=1 in the POOL. That violates the GDD invariant and inflates
       perceived FS rate. When the model declares perReel mode, enforce
       max-one-scatter-per-reel as a deterministic post-process: keep
       the FIRST scatter in the visible window, replace any subsequent
       scatter with a non-trigger symbol re-roll. */
    const _trig = String(FREESPINS.triggerSymbol || 'S').toUpperCase();
    const _enforcePerReel = (FREESPINS.countMode === 'perReel');
    let _scattersThisReel = 0;
    for (let i = 1; i <= vis; i++) {
      /* 2026-06-10 (Boki H&W rule): skip overwrite for locked orbs. The
       * lock-and-spin pattern (industry-standard Hold & Spin / coin
       * collection round) requires the captured orb to STAY on its cell
       * across every respin. Without this guard the random fill obliterates
       * the orb symbol on every settle and only hwApplyLocks restores it
       * after, causing the visible "orb travels with the reel" bug. */
      if (reel.cells[i] && reel.cells[i].classList && reel.cells[i].classList.contains('is-locked-bonus')) {
        continue;
      }
      var _sym = randomSym();
      reel.cells[i].textContent = _sym || reel.cells[i].textContent || '?';
      if (_enforcePerReel && String(_sym || '').toUpperCase() === _trig) {
        if (_scattersThisReel >= 1) {
          /* Re-roll until we get a non-trigger. Hard cap at 8 attempts
             so a degenerate pool (e.g. pool = [S]) cannot infinite-loop —
             after cap, drop a literal '?' which can never be a scatter. */
          let attempts = 0;
          while (attempts < 8 && String(reel.cells[i].textContent || '').toUpperCase() === _trig) {
            reel.cells[i].textContent = randomSym() || '?';
            attempts++;
          }
          if (String(reel.cells[i].textContent || '').toUpperCase() === _trig) {
            reel.cells[i].textContent = '?';
          }
        } else {
          _scattersThisReel++;
        }
      }
    }
    /* Force-trigger plant: scatter on centre row of first N reels. */
    if (FORCE_TRIGGER && FORCE_TRIGGER.scatterCount && reelIdx < FORCE_TRIGGER.scatterCount) {
      const trig = (FREESPINS.triggerSymbol || "S");
      const midRow = Math.max(1, Math.ceil(vis / 2));
      reel.cells[midRow].textContent = trig;
    }
    /* 2026-06-11 (Boki: "svaki fors u svakom gridu mora da radi tako da
     * pritisnes force, odradi se spin, dobije se ishod") — force-plant
     * BONUS symbols for the Hold & Win trigger pile. The H&W chip sets
     * FORCE_TRIGGER.bonusCount + bonusSymbol, the spin runs normally, and
     * the postSpin hwMaybeEnter() path lights up because the grid lands
     * with bonusCount instances of the bonus symbol. Plant one bonus on
     * every reel up to bonusCount: top row first, then center row when
     * bonusCount exceeds the reel count. */
    if (FORCE_TRIGGER && FORCE_TRIGGER.bonusCount && FORCE_TRIGGER.bonusSymbol) {
      const bonusSym = String(FORCE_TRIGGER.bonusSymbol);
      const reelsCount = (typeof REELS !== 'undefined' && REELS) || 5;
      const bonusPerReel = Math.ceil(FORCE_TRIGGER.bonusCount / reelsCount);
      for (let pp = 0; pp < bonusPerReel; pp++) {
        const flatIdx = reelIdx + (pp * reelsCount);
        if (flatIdx >= FORCE_TRIGGER.bonusCount) break;
        /* Spread vertically: top row, then bottom, then middle, then any. */
        const slot = (pp === 0) ? 1 : Math.min(vis, pp + 1);
        if (reel.cells[slot]) reel.cells[slot].textContent = bonusSym;
      }
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

    /* 2026-06-09 — Boki bug: "turbo ne radi". Live turbo multiplier
       (0.35 default) was published by turboMode block but no engine path
       read it. We read it once per spin and compress the per-reel schedule
       window proportionally. Speed-up multiplier shortens the wait before
       a reel is allowed to stop; pixel-per-frame speed is also scaled. */
    const _turboMult = (typeof window !== 'undefined' && typeof window.__SLOT_TURBO_SPEED_MULT__ === 'number')
      ? Math.max(0.1, Math.min(1, window.__SLOT_TURBO_SPEED_MULT__))
      : 1.0;
    /* Min rotations also drops when turbo is on — fewer full strips per
       reel so settle lands faster. Floor at 3 to keep visible motion. */
    const _minRot = (_turboMult < 1)
      ? Math.max(3, Math.round(${c.minRotations} * _turboMult))
      : ${c.minRotations};

    RECT_REELS.forEach((reel, idx) => {
      reel.spinning = true;
      reel.stopping = false;
      reel.stopRequested = false;
      reel.rotationCount = 0;
      reel.offsetPx = 0;
      reel.anticipating = false;
      reel.minRotations = _minRot;
      reel._turboMult = _turboMult;
      if (reel.glowTimerId) { clearTimeout(reel.glowTimerId); reel.glowTimerId = null; }
      reel.col.classList.remove("reelCol--anticipating");
      reel.scheduledStopAt = performance.now() +
        (SPIN_PROFILE.windupMs + SPIN_PROFILE.accelMs +
         SPIN_PROFILE.steadyMs + idx * SPIN_PROFILE.staggerMs) * _turboMult;
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
          /* Wave S: reelEngine owns onSpinResult emission — it's the block that
             knows the precise moment when every reel has stopped. Blocks that
             annotate the settled grid (orb chips, mystery reveal, sticky wild
             glow, wild reel spawn, lightning strikes) listen here BEFORE the
             postSpin pipeline (handlePostSpin) starts. */
          const duringFs = typeof FSM !== 'undefined' && FSM && FSM.phase === 'FS_ACTIVE';
          if (typeof HookBus !== 'undefined') {
            HookBus.emit('onSpinResult', { duringFs });
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
    /* 2026-06-09 — Boki bug: my earlier fix shortened the schedule window
       but left base pixel speed unchanged → reels stopped EARLIER without
       traveling proportionally faster, so the whole spin felt the same or
       even longer (the deceleration tail dominated). Real fix: scale base
       pixel speed inversely with the active turbo multiplier so the reels
       actually MOVE faster on screen during a turbo spin. */
    var _liveTurboMult = (typeof window !== 'undefined' && typeof window.__SLOT_TURBO_SPEED_MULT__ === 'number')
      ? Math.max(0.1, Math.min(1, window.__SLOT_TURBO_SPEED_MULT__))
      : 1.0;
    var _speedScale = (_liveTurboMult > 0) ? (1 / _liveTurboMult) : 1.0;
    const baseSpeed = Math.max(20, RECT_SIDE * 0.25) * _speedScale;
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

  /* Wave S LEGO conformance — reelEngine registers preSpin to reset per-reel
     stop/glow timers and the FORCE_TRIGGER one-shot flag. Without this, a
     rapid click during anticipation hold can leave a stale stopTimerId that
     fires after the new spin started (and instantly stops a fresh reel). */
  if (typeof HookBus !== 'undefined') {
    HookBus.on('preSpin', () => {
      if (Array.isArray(RECT_REELS)) {
        for (const reel of RECT_REELS) {
          if (reel.stopTimerId) { clearTimeout(reel.stopTimerId); reel.stopTimerId = null; }
          if (reel.glowTimerId) { clearTimeout(reel.glowTimerId); reel.glowTimerId = null; }
          reel.stopRequested = false;
        }
      }
    }, { priority: 20 });

    /* Wave V5 — react to slam-stop request. Industry-standard fast-stop
       pattern: collapse all reels to landed strip immediately.
       Pre-response phase (server result still pending) is impossible in
       this template because the engine bakes the symbol strip at preSpin
       time (placeholder math), so EVERY slam is effectively post-response.
       We still honor the payload.phase contract for future server-coupled
       PAR phase work. */
    HookBus.on('onSlamRequested', () => {
      if (!Array.isArray(RECT_REELS) || RECT_REELS.length === 0) {
        /* SVG / non-rectangular kinds — emit immediately so UI proceeds. */
        HookBus.emit('onSlamComplete', { duration: 0 });
        return;
      }
      if (!allReelsActive) {
        /* Slam arrived after spin already settled. Defensive synthetic
           Complete so listeners (e.g. forceSkip) don't hang. */
        HookBus.emit('onSlamComplete', { duration: 0 });
        return;
      }
      const slamStart = performance.now();
      const reelIdxOf = function (r) { return RECT_REELS.indexOf(r); };
      for (const reel of RECT_REELS) {
        if (reel.stopTimerId) { clearTimeout(reel.stopTimerId); reel.stopTimerId = null; }
        if (reel.glowTimerId) { clearTimeout(reel.glowTimerId); reel.glowTimerId = null; }
        /* Direct collapse: bypass the rotateStripDown while-loop because
           early in a spin offsetPx may not yet reach cellStep (accel
           ramp is gentle). Hard-transition reel into stopping state and
           commit symbols immediately. The existing snap path then drives
           the visual to its landed strip and bouncing animation. */
        if (reel.spinning) {
          reel.spinning = false;
          reel.stopping = true;
          reel.stopStartMs = slamStart;
          reel.stopRequested = true;
          reel.stopRequestTime = slamStart;
          reel.targetY = -reel.cellStep;
          reel.col.classList.remove('reelCol--anticipating');
          commitStopSymbols(reel, reelIdxOf(reel));
        }
      }
      /* onSlamComplete emit strategy: tickerloop emits onSpinResult when
         every reel has visually settled. Subscribe once and re-emit as
         onSlamComplete with elapsed duration. Race-free because the rAF
         tick + emit are synchronous; if subscribe lands after engine
         already fired, fallback timer below covers it. */
      var _slamFired = false;
      var _fallbackId = null;
      var _disposer = HookBus.once('onSpinResult', function () {
        if (_slamFired) return;
        _slamFired = true;
        if (_fallbackId) { clearTimeout(_fallbackId); _fallbackId = null; }
        HookBus.emit('onSlamComplete', { duration: Math.round(performance.now() - slamStart) });
      });
      /* Hard fallback — worst-case bounce path is well under 800ms even
         on the largest rectangular grids (6×5 cluster). 1500ms is a
         very generous safety net. */
      _fallbackId = setTimeout(function () {
        if (_slamFired) return;
        _slamFired = true;
        if (typeof _disposer === 'function') _disposer();
        HookBus.emit('onSlamComplete', { duration: Math.round(performance.now() - slamStart) });
      }, 1500);
    });
  }

  /* W48 BUGFIX — H&W per-cell respin mode (Boki 2026-06-16, second pass).
   * Industry-standard hold-and-spin renders the respin as per-cell CSS
   * animations on non-orb cells, with NO strip transform. Locked orb
   * cells are literally untouched for the entire respin window.
   *
   * The previous fix (rotateStripDown pinned-index) only fixed the array
   * order — the parent strip kept translating, so visually the orb
   * still drifted with the spin. This dedicated path bypasses strip
   * transform entirely: per-cell CSS classes + symbol swap + stagger
   * stop. Branch is taken only when window.HW_STATE.active === true. */
  function runHnwPerCellRespin(onSettled) {
    const turboMult = (typeof window !== 'undefined' && typeof window.__SLOT_TURBO_SPEED_MULT__ === 'number')
      ? Math.max(0.1, Math.min(1, window.__SLOT_TURBO_SPEED_MULT__))
      : 1.0;
    const BASE_MS     = Math.round(900 * turboMult);
    const STAGGER_MS  = Math.round(60  * turboMult);
    const STOPPING_MS = 160;
    const LANDED_MS   = 340;

    const trig = (FREESPINS.triggerSymbol || 'S');
    const forceN = FORCE_TRIGGER ? FORCE_TRIGGER.scatterCount : 0;

    /* Neutralise strip transforms so locked cells never visually move
     * with the parent strip. Done once at entry; restored implicitly by
     * the next base spin via startSpinAll. */
    if (RECT_REELS) {
      RECT_REELS.forEach(reel => {
        try { reel.strip.style.transform = ''; } catch (_) {}
        reel.spinning = false;
        reel.stopping = false;
      });
    }

    /* Collect all .cell nodes, partition by lock state. */
    const allCells = Array.from(grid.querySelectorAll('.cell'));
    const nonLocked = allCells.filter(c => !c.classList.contains('is-locked-bonus'));

    if (nonLocked.length === 0) {
      /* Every cell is locked — full grid round; nothing to spin. Honour
       * the lifecycle contract so listeners (postSpin pipeline, H&W
       * harvester) still fire as if the respin completed. */
      if (typeof HookBus !== 'undefined') {
        HookBus.emit('onSpinResult', { duringFs: false, hwRespin: true });
      }
      if (typeof onSettled === 'function') setTimeout(onSettled, 200);
      return;
    }

    /* Pre-determine the new symbol for each non-locked cell. Scatters
     * forced by FORCE_TRIGGER are placed first to honour parity with the
     * normal base spin path. */
    const newSyms = nonLocked.map((_, i) =>
      (i < forceN) ? trig : (randomSym() || '?'),
    );

    /* Add per-cell spinning class. Locked cells are NEVER touched —
     * the .hnw-cell-spinning selector also has explicit suppression in
     * the holdAndWin CSS to defend against rogue tagging. */
    nonLocked.forEach(c => {
      c.classList.remove('hnw-cell-stopped', 'hnw-cell-stopping');
      c.classList.add('hnw-cell-spinning');
    });

    /* Stagger stop window: each cell goes spinning → stopping → stopped
     * with the new symbol revealed in between. STAGGER_MS apart so the
     * stop cascade is readable, not synchronised. */
    setTimeout(() => {
      nonLocked.forEach((cell, i) => {
        setTimeout(() => {
          cell.classList.remove('hnw-cell-spinning');
          cell.classList.add('hnw-cell-stopping');
          setTimeout(() => {
            cell.classList.remove('hnw-cell-stopping');
            cell.classList.add('hnw-cell-stopped');
            cell.textContent = newSyms[i];
            setTimeout(() => cell.classList.remove('hnw-cell-stopped'), LANDED_MS);
          }, STOPPING_MS);
        }, i * STAGGER_MS);
      });

      const tailMs = (nonLocked.length * STAGGER_MS) + STOPPING_MS + LANDED_MS + 80;
      setTimeout(() => {
        if (typeof HookBus !== 'undefined') {
          HookBus.emit('onSpinResult', { duringFs: false, hwRespin: true });
        }
        if (typeof onSettled === 'function') onSettled();
      }, tailMs);
    }, BASE_MS);
  }

  function runOneBaseSpin() {
    /* Wave T4 guard — rapid double/triple click on #spinBtn was racing:
       click 2 emitted preSpin while click 1's reels were mid-spin, the
       reelEngine preSpin listener (priority 20) clears every reel.stopTimerId,
       but the FOLLOW-UP startSpinAll bails out on allReelsActive=true and
       NEVER re-arms a new stopTimerId. Result: reels spin forever, cells
       stuck in is-blurring. Idempotent guard at the public entry point keeps
       LEGO ownership intact (engine still owns its own re-entry safety). */
    const inFlight = (UNIFORM_REEL_KINDS.has(SHAPE.kind) && RECT_REELS)
      ? !!allReelsActive
      : !!staticRerollInFlight;
    if (inFlight) return;
    cancelWinSymCycle();

    /* W48 BUGFIX — H&W per-cell respin branch. When H&W is RUNNING, the
     * player must see orb cells stay statically anchored while other
     * cells spin individually. Branch BEFORE preSpin so feature blocks
     * can read window.HW_STATE.active to coordinate their preSpin hooks. */
    const hwActive = (typeof window !== 'undefined' &&
                      window.HW_STATE && window.HW_STATE.active === true);

    /* HookBus: preSpin → blocks that arm per-spin state (anticipation,
       wild placement) run BEFORE the engine kicks. */
    if (typeof HookBus !== 'undefined') {
      HookBus.emit('preSpin', { duringFs: false, hwRespin: hwActive });
    }
    if (hwActive && UNIFORM_REEL_KINDS.has(SHAPE.kind) && RECT_REELS) {
      runHnwPerCellRespin(() => handlePostSpin(false));
      return;
    }
    if (UNIFORM_REEL_KINDS.has(SHAPE.kind) && RECT_REELS) {
      startSpinAll(() => handlePostSpin(false));
    } else {
      /* Non-rectangular path — reelEngine remains the SOLE OWNER of
         onSpinResult emission (LEGO gate single-owner invariant). It
         wraps the supplied onSettled callback so the engine block
         (hex / wheel / crash / slingo / plinko / static-reroll) does
         not need to know about lifecycle ownership. */
      const _wrappedSettled = () => {
        const duringFs = typeof FSM !== 'undefined' && FSM && FSM.phase === 'FS_ACTIVE';
        if (typeof HookBus !== 'undefined') {
          HookBus.emit('onSpinResult', { duringFs });
        }
        handlePostSpin(false);
      };
      if (SHAPE.kind === 'hexagonal' && typeof window.__SLOT_HEX_RUNSPIN__ === 'function') {
        /* Wave J2b — hex topology owns per-axial-column spin via the
           dedicated hexReelEngine block. */
        window.__SLOT_HEX_RUNSPIN__(_wrappedSettled);
      } else if (
        /* Wave J3 — SVG-kind registry. Each SVG topology
           (wheel / radial / crash / slingo / plinko) registers an
           entry in window.__SLOT_KIND_RUNSPIN__[kind]. New topologies
           land as block-level additions; dispatcher stays closed. */
        window.__SLOT_KIND_RUNSPIN__
        && typeof window.__SLOT_KIND_RUNSPIN__[SHAPE.kind] === 'function'
      ) {
        window.__SLOT_KIND_RUNSPIN__[SHAPE.kind](_wrappedSettled);
      } else {
        /* runStaticReroll emits onSpinResult itself (line 549) — use the
           raw onSettled to avoid double-emit. Path still routes through
           handlePostSpin via the inner callback. */
        runStaticReroll(() => handlePostSpin(false));
      }
    }
  }

  function runStaticReroll(onSettled) {
    /* SVG-based kinds (wheel/crash) keep their symbols inside <text> nodes
       rather than .cell divs. Selector covers both so wheel scatter detection
       works on top of the same reroll path. */
    staticRerollInFlight = true;
    const _settled = (cb) => { staticRerollInFlight = false; if (typeof cb === 'function') cb(); };
    const cellsAll = grid.querySelectorAll(".cell, text");
    /* Wave S: same onSpinResult contract as startSpinAll — even if the grid
       is empty (SVG/wheel boundary), emit so listeners can reset state. */
    function _emitSettleResult() {
      const duringFs = typeof FSM !== 'undefined' && FSM && FSM.phase === 'FS_ACTIVE';
      if (typeof HookBus !== 'undefined') {
        HookBus.emit('onSpinResult', { duringFs });
      }
    }
    if (cellsAll.length === 0) {
      _emitSettleResult();
      if (typeof onSettled === "function") setTimeout(() => _settled(onSettled), ${c.staticFallbackMs});
      else staticRerollInFlight = false;
      return;
    }

    const COL_KINDS = new Set([
      'cluster', 'megaclusters', 'lock_respin', 'expanding', 'infinity',
    ]);
    const isColumnGrid = COL_KINDS.has(SHAPE.kind) && REELS > 0;

    const trig = (FREESPINS.triggerSymbol || "S");
    const forceN = FORCE_TRIGGER ? FORCE_TRIGGER.scatterCount : 0;

    if (!isColumnGrid) {
      /* Turbo gate — static-reroll path is used by dual_colossal and other
         irregular grids. Compress per-spin so turbo chip ACTUALLY speeds up
         these kinds (Boki bug: turbo on dual had no observable effect). */
      var _stm = (typeof window.__SLOT_TURBO_SPEED_MULT__ === 'number' && window.__SLOT_TURBO_SPEED_MULT__ > 0)
        ? window.__SLOT_TURBO_SPEED_MULT__ : 1.0;
      var _preMs  = Math.max(20, Math.round(${c.staticPreRollMs}  * _stm));
      var _swapMs = Math.max(20, Math.round(${c.staticBlurSwapMs} * _stm));
      /* Legacy two-phase blink for SVG and irregular HTML grids. */
      cellsAll.forEach(c => c.classList.add("is-blurring"));
      setTimeout(() => {
        cellsAll.forEach((c, i) => {
          c.textContent = (i < forceN) ? trig : (randomSym() || "?");
        });
        setTimeout(() => {
          cellsAll.forEach(c => c.classList.remove("is-blurring"));
          /* Wave S: onSpinResult fires the moment the grid is settled. */
          _emitSettleResult();
          _settled(onSettled);
        }, _swapMs);
      }, _preMs);
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
      /* Wave S: emit onSpinResult once every column has revealed. */
      _emitSettleResult();
      _settled(onSettled);
    }, cursor + ${c.staticSettleMs});
    return;
  }
`;
}
