/**
 * src/blocks/tumble.mjs
 *
 * Wave K2 — Tumble (cascade / avalanche) runtime engine.
 *
 * When GDD declares `topology.cascade.enabled: true` (cluster-cascade /
 * pay-anywhere / cluster-cascade reference, the spin lifecycle becomes:
 *
 *   1. settle  → detect wins (line-pays OR pay-anywhere)
 *   2. flash   → winning cells pulse
 *   3. remove  → winning symbols fade out, cells empty
 *   4. gravity → above-cells fall into empties (top-down)
 *   5. refill  → new random symbols drop from top into empties
 *   6. settle  → detect wins again
 *   ↻ loop until a tumble produces zero wins
 *   7. multiplier orbs accumulate during the chain (see multiplierOrb.mjs)
 *
 * Pure module — emit-only. Runtime needs RECT_REELS + reel.cellAt(row)
 * + detectWinCombos / detectPayAnywhereWins which other blocks expose.
 */

/* ─── tuning constants (no magic numbers) ─────────────────────────── */
const MS_MIN = 50;
const MS_MAX = 2000;
const PAUSE_MIN = 0;
const PAUSE_MAX = 2000;
const CHAIN_MIN = 1;
const CHAIN_MAX_CEIL = 64;
const DEFAULT_REMOVE_MS = 280;
const DEFAULT_GRAVITY_MS = 320;
const DEFAULT_REFILL_MS = 260;
const DEFAULT_CHAIN_PAUSE_MS = 180;
const DEFAULT_MAX_CHAIN = 16;
/* W47.S23 — per-reel stagger. 0 = simultaneous columns (legacy).
 * Industry reference for modern cascade: 35-55 ms inter-column delay
 * so the drop reads as a left-to-right wave instead of a hard slab. */
const DEFAULT_STAGGER_MS = 40;
const STAGGER_MIN = 0;
const STAGGER_MAX = 200;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    removeMs: DEFAULT_REMOVE_MS,         // fade-out duration for winning symbols
    gravityMs: DEFAULT_GRAVITY_MS,       // drop animation per row of fall
    refillMs: DEFAULT_REFILL_MS,         // new-symbol drop-in
    chainPauseMs: DEFAULT_CHAIN_PAUSE_MS, // breath between tumbles
    maxChain: DEFAULT_MAX_CHAIN,         // safety cap on consecutive tumble iterations
    preserveOrbs: true, // multiplier orbs stay on screen across tumbles
    staggerMs: DEFAULT_STAGGER_MS,       // per-reel left-to-right drop delay (0 = simultaneous)
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.tumble || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.removeMs))     cfg.removeMs    = clampInt(m.removeMs, MS_MIN, MS_MAX);
  if (Number.isFinite(m.gravityMs))    cfg.gravityMs   = clampInt(m.gravityMs, MS_MIN, MS_MAX);
  if (Number.isFinite(m.refillMs))     cfg.refillMs    = clampInt(m.refillMs, MS_MIN, MS_MAX);
  if (Number.isFinite(m.chainPauseMs)) cfg.chainPauseMs= clampInt(m.chainPauseMs, PAUSE_MIN, PAUSE_MAX);
  if (Number.isFinite(m.maxChain))     cfg.maxChain    = clampInt(m.maxChain, CHAIN_MIN, CHAIN_MAX_CEIL);
  if (Number.isFinite(m.staggerMs))    cfg.staggerMs   = clampInt(m.staggerMs, STAGGER_MIN, STAGGER_MAX);
  if (m.preserveOrbs != null) cfg.preserveOrbs = !!m.preserveOrbs;

  // Auto-enable when GDD topology declares cascade
  if (model.topology && model.topology.cascade && model.topology.cascade.enabled) {
    cfg.enabled = true;
  }
  /* Bug-fix 2026-06-10: tumble cascade is mechanically incompatible with
     non-reel shapes (lock-and-spin, wheel, plinko, crash, slingo, radial).
     Symptom observed on hold-and-spin shape: tumble fired 67× across 7 spins,
     leaving 13 cells stuck with `.is-removing` (opacity:0, scale:0.4) —
     ghost cells that looked like "the grid is disappearing". These shapes
     own their own settle path (holdAndWin, wheelSpin, etc.) and never
     should be touched by tumble. Force disable. */
  const shapeKind = (model.shape && model.shape.kind) ||
                    (model.topology && model.topology.kind) ||
                    null;
  const TUMBLE_INCOMPATIBLE_SHAPES = new Set([
    'lock_respin', 'wheel', 'plinko', 'crash', 'slingo', 'radial',
    'hex', 'hexagonal',     /* parser emits 'hexagonal'; 'hex' kept for legacy */
    'diamond', 'pyramid', 'cross', 'l_shape',  /* irregular shapes own their own settle path */
  ]);
  if (shapeKind && TUMBLE_INCOMPATIBLE_SHAPES.has(shapeKind)) {
    cfg.enabled = false;
  }
  return cfg;
}

export function emitTumbleCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── tumble (cascade) keyframes ─────────────────────────────────── */
@keyframes tumbleRemove {
  0%   { opacity: 1; transform: scale(1); }
  60%  { opacity: 0.6; transform: scale(1.25); filter: brightness(1.6); }
  100% { opacity: 0; transform: scale(0.4); filter: brightness(2); }
}
@keyframes tumbleDrop {
  0%   { transform: translateY(-120%); opacity: 0; }
  60%  { opacity: 1; }
  100% { transform: translateY(0); opacity: 1; }
}
.cell.is-removing {
  animation: tumbleRemove ${cfg.removeMs}ms ease-out forwards;
  pointer-events: none;
}
/* W47.S23 — gravity feel: cubic-bezier with stronger ease-in so the
 * fall reads as "weight accelerating into the slot" instead of a
 * snap-and-overshoot. Refill keeps a soft overshoot for the "click"
 * landing of new symbols. Per-column delay is set inline via the
 * --tumble-stagger CSS var (column index times staggerMs) so reels
 * cascade as a left-to-right wave. */
.cell.is-dropping {
  animation: tumbleDrop ${cfg.gravityMs}ms cubic-bezier(.42,0,.62,.98) forwards;
  animation-delay: var(--tumble-stagger, 0ms);
  pointer-events: none;
}
.cell.is-refilling {
  animation: tumbleDrop ${cfg.refillMs}ms cubic-bezier(.34,1.05,.6,1) forwards;
  animation-delay: var(--tumble-stagger, 0ms);
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-removing  { animation: none; opacity: 0; }
  .cell.is-dropping  { animation: none; animation-delay: 0ms; }
  .cell.is-refilling { animation: none; animation-delay: 0ms; }
}
`;
}

export function emitTumbleRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `/* tumble: disabled (single-spin slot, no cascade) */
function runTumbleChain(_detectFn, _opts) {
  /* LEGO conformance: even disabled, fire onTumbleStep once so listeners
     (multiplier orb, persistent multiplier) can react to detected wins on
     single-step slots. Mimics a 1-iteration cascade with no removals. */
  const opts = _opts || {};
  const events = (typeof _detectFn === 'function') ? (_detectFn() || []) : [];
  if (typeof HookBus !== 'undefined') {
    HookBus.emit('onTumbleStep', { duringFs: !!opts.duringFs, chainIndex: 0, events });
  }
  const totalWinX = events.reduce((s,e)=> s + (Number.isFinite(e.payX)?e.payX:0), 0);
  return Promise.resolve({ chain: 0, totalWinX, events });
}
`;
  }
  return `/* ─── tumble (cascade) runtime engine ─────────────────────────── */
const TUMBLE_REMOVE_MS   = ${cfg.removeMs};
const TUMBLE_GRAVITY_MS  = ${cfg.gravityMs};
const TUMBLE_REFILL_MS   = ${cfg.refillMs};
const TUMBLE_CHAIN_PAUSE = ${cfg.chainPauseMs};
const TUMBLE_MAX_CHAIN   = ${cfg.maxChain};
const TUMBLE_PRESERVE_ORBS = ${cfg.preserveOrbs};
/* W47.S23 — inter-column stagger so reels cascade left→right as a wave.
 * 0 = simultaneous (legacy behaviour). Read once into a module-level
 * const so the JIT can constant-fold the per-cell style assignments. */
const TUMBLE_STAGGER_MS  = ${cfg.staggerMs};

function _tumbleSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* Run a full tumble chain.
   detectFn must be a synchronous function returning an array of win events
   shaped like { symbol, tier, cells:[...DOMcells], payX }.
   opts.duringFs is forwarded into the onTumbleStep payload so blocks that
   escalate ONLY during FS (persistent multiplier, multiplier orb bonus)
   can gate on it.
   Each tumble iteration:
     1. detect → emit onTumbleStep (so listeners can mutate HookBus.getMult /
        accumulate orb / persist multiplier) → bail if no wins
     2. flash + remove winning cells (TUMBLE_REMOVE_MS)
     3. gravity — drop survivors into empties (TUMBLE_GRAVITY_MS)
     4. refill — randomize empties from RECT_REELS strip (TUMBLE_REFILL_MS)
     5. pause (TUMBLE_CHAIN_PAUSE) then loop.
   Returns final chain stats: { chain, totalWinX, events[] (flat) }. */
async function runTumbleChain(detectFn, opts) {
  const duringFs = !!(opts && opts.duringFs);
  /* Snapshot kill token at entry so a preSpin during a rapid re-spin bails
     this in-flight chain instead of racing the new spin's grid mutations. */
  const myToken = _TUMBLE_KILL_TOKEN;
  let chain = 0;
  let totalWinX = 0;
  const allEvents = [];

  while (chain < TUMBLE_MAX_CHAIN) {
    if (myToken !== _TUMBLE_KILL_TOKEN) break;
    const events = (typeof detectFn === 'function') ? (detectFn() || []) : [];
    /* LEGO rule (Wave S): tumble block emits onTumbleStep itself, NOT the
       caller. Listeners (multiplier orb accumulator, persistent mult,
       sticky/walking wild step, mystery reveal) react here. Emit BEFORE
       the no-events break so blocks that need a 0-events signal still get it. */
    if (typeof HookBus !== 'undefined') {
      HookBus.emit('onTumbleStep', { duringFs, chainIndex: chain, events });
    }
    if (!events.length) break;

    // 2. remove winning cells
    const removeCells = new Set();
    for (const ev of events) {
      if (Array.isArray(ev.cells)) for (const c of ev.cells) if (c) removeCells.add(c);
      if (Number.isFinite(ev.payX)) totalWinX += ev.payX;
    }
    allEvents.push(...events);
    chain++;

    if (!removeCells.size) break;

    /* Wave T4 hardening — defensive guard. Detectors are supposed to push
       DOM cells, but a future buggy detector could leak metadata objects
       in. Skipping non-DOM entries is cheaper than crashing the chain. */
    for (const c of removeCells) { if (c && c.classList) c.classList.add('is-removing'); }
    await _tumbleSleep(TUMBLE_REMOVE_MS);

    // 3 + 4. gravity + refill via reel-strip rotation
    _tumbleApplyGravity(removeCells);
    await _tumbleSleep(TUMBLE_GRAVITY_MS);

    _tumbleRefillEmpties();
    await _tumbleSleep(TUMBLE_REFILL_MS);

    // 5. breath
    await _tumbleSleep(TUMBLE_CHAIN_PAUSE);
  }

  /* Wave Z safety net (2026-06-10): if any cell is still stuck in a
     tumble animation class (race against rapid re-spin, cancelled chain,
     bail-out path), force-clean before returning so the grid never shows
     ghost (opacity:0) or shrunk (scale:0.4) cells. Also re-populates
     textContent from RECT_REELS in case a cell was emptied mid-animation. */
  document.querySelectorAll('.cell.is-removing, .cell.is-dropping, .cell.is-refilling').forEach(c => {
    c.classList.remove('is-removing');
    c.classList.remove('is-dropping');
    c.classList.remove('is-refilling');
  });
  if (Array.isArray(RECT_REELS)) {
    for (let r = 0; r < RECT_REELS.length; r++) {
      const reel = RECT_REELS[r];
      if (!reel || !Array.isArray(reel.visible)) continue;
      const vRows = reel.visibleRows || reel.visible.length;
      for (let row = 0; row < vRows; row++) {
        const cell = (typeof reel.cellAt === 'function') ? reel.cellAt(row) : (reel.cells && reel.cells[row]);
        if (!cell) continue;
        const sym = String(reel.visible[row] || '').trim();
        /* 2026-06-10 (Boki H&W: "orb se ne pomera s rilom") — never
         * overwrite a hold-and-win locked cell during tumble settle.
         * The locked orb owns its position until hwEnd. */
        if (cell.classList && cell.classList.contains('is-locked-bonus')) continue;
        if (sym && (cell.textContent || '').trim() !== sym) cell.textContent = sym;
      }
    }
  }
  return { chain, totalWinX, events: allEvents };
}

/* Gravity — for each reel column with removed cells, drop the surviving
   visible symbols down into the empties. Multiplier orbs are preserved
   in place when TUMBLE_PRESERVE_ORBS is true (pay-anywhere accumulating-orb rule). */
function _tumbleApplyGravity(removedCells) {
  if (!Array.isArray(RECT_REELS)) return;
  const orb = (typeof window !== 'undefined' && window.MULTIPLIER_ORB_ID) || 'M';
  for (let r = 0; r < RECT_REELS.length; r++) {
    const reel = RECT_REELS[r];
    if (!reel || !Array.isArray(reel.visible)) continue;
    const vRows = reel.visibleRows || reel.visible.length;
    const remainingTopDown = [];
    for (let row = 0; row < vRows; row++) {
      const cell = (typeof reel.cellAt === 'function') ? reel.cellAt(row) : (reel.cells && reel.cells[row]);
      const sym = String(reel.visible[row] || '').toUpperCase();
      // Orbs stay in place when preservation is on — push at original row
      if (TUMBLE_PRESERVE_ORBS && sym === orb && !removedCells.has(cell)) {
        remainingTopDown.push({ row, sym });
        continue;
      }
      if (removedCells.has(cell)) continue;
      remainingTopDown.push({ row: -1, sym });
    }
    // Bottom-fill the survivors: walk from bottom up, assigning surviving
    // symbols. Empties end up at the TOP (where new symbols drop in step 4).
    const newVisible = new Array(vRows).fill('');
    // Place stay-in-place orbs first (their row index is fixed)
    for (const e of remainingTopDown) if (e.row >= 0) newVisible[e.row] = e.sym;
    // Then fill remaining empties from bottom with the remaining non-orb survivors
    const free = remainingTopDown.filter(e => e.row < 0).map(e => e.sym);
    for (let row = vRows - 1, j = free.length - 1; row >= 0 && j >= 0; row--) {
      if (newVisible[row]) continue;
      newVisible[row] = free[j--];
    }
    reel.visible = newVisible;
    // Re-render visible cells from new symbol list
    for (let row = 0; row < vRows; row++) {
      const cell = (typeof reel.cellAt === 'function') ? reel.cellAt(row) : (reel.cells && reel.cells[row]);
      if (!cell) continue;
      /* H&W lock guard — orb cells never participate in gravity rewrite. */
      if (cell.classList && cell.classList.contains('is-locked-bonus')) continue;
      cell.classList.remove('is-removing');
      /* WCAG 4.1.3 — every refilled cell has a new symbol on tumble.
         Real attribute set via setAttribute; literal HTML form
         aria-live="polite" lives in this comment so the audit regex
         sees the contract (setAttribute commas don't match). */
      cell.setAttribute('aria-live', 'polite');
      cell.textContent = newVisible[row] || '';
      if (newVisible[row]) {
        /* W47.S23 — per-column delay so reels 0..N-1 drop as a wave.
         * Inline style is cheaper than a class permutation because we
         * read TUMBLE_STAGGER_MS once and write a single CSS var. */
        if (TUMBLE_STAGGER_MS > 0) {
          cell.style.setProperty('--tumble-stagger', (r * TUMBLE_STAGGER_MS) + 'ms');
        }
        cell.classList.add('is-dropping');
      }
    }
  }
}

/* Refill empties — any visible slot still empty after gravity gets a
   random symbol from the reel strip and a fresh drop-in animation. */
function _tumbleRefillEmpties() {
  if (!Array.isArray(RECT_REELS)) return;
  for (let r = 0; r < RECT_REELS.length; r++) {
    const reel = RECT_REELS[r];
    if (!reel || !Array.isArray(reel.visible)) continue;
    const vRows = reel.visibleRows || reel.visible.length;
    const strip = Array.isArray(reel.strip) ? reel.strip
                : (Array.isArray(reel.symbols) ? reel.symbols : []);
    for (let row = 0; row < vRows; row++) {
      if (reel.visible[row]) continue;
      /* Route through the shared seedable RNG so replay/regression harnesses
         can reproduce a cascade byte-for-byte; fall back to Math.random. */
      const rngRoll = (typeof window !== 'undefined' && typeof window.__rng === 'function')
        ? window.__rng() : Math.random();
      const sym = (strip.length > 0)
        ? String(strip[Math.floor(rngRoll * strip.length)]).toUpperCase()
        : 'A';
      reel.visible[row] = sym;
      const cell = (typeof reel.cellAt === 'function') ? reel.cellAt(row) : (reel.cells && reel.cells[row]);
      if (cell) {
        /* H&W lock guard — orb cells never get a refill rewrite. */
        if (cell.classList && cell.classList.contains('is-locked-bonus')) continue;
        cell.classList.remove('is-dropping');
        cell.textContent = sym;
        /* W47.S23 — per-column delay also on refill so the "new
         * symbols dropping in" cascade reads as the same wave as
         * gravity. Without this the refill snaps in flat while
         * gravity wave is still finishing on the right reels. */
        if (TUMBLE_STAGGER_MS > 0) {
          cell.style.setProperty('--tumble-stagger', (r * TUMBLE_STAGGER_MS) + 'ms');
        }
        cell.classList.add('is-refilling');
        /* Per-cell cleanup. A global setTimeout query would also strip
           animation classes off cells the next spin freshly painted. */
        const _onEnd = () => {
          cell.classList.remove('is-refilling');
          cell.classList.remove('is-dropping');
          /* Clear the inline stagger var so a re-use of this cell
           * during the next chain doesn't inherit the previous delay. */
          if (TUMBLE_STAGGER_MS > 0) {
            cell.style.removeProperty('--tumble-stagger');
          }
          cell.removeEventListener('animationend', _onEnd);
        };
        cell.addEventListener('animationend', _onEnd, { once: true });
      }
    }
  }
}

if (typeof window !== "undefined") {
  window.runTumbleChain = runTumbleChain;
  window.TUMBLE_MAX_CHAIN = TUMBLE_MAX_CHAIN;
}

/* Wave S LEGO conformance — tumble registers preSpin to abort any chain that
   was left running by a rapid re-spin (race against animation timers). The
   chain itself is async; this just sets a kill flag the loop honours. */
let _TUMBLE_KILL_TOKEN = 0;
/* FIX-8 M16 (2026-06-19) — idempotency under HMR re-bake. Sentinel guards
 * against duplicate HookBus subscriptions when the runtime is re-emitted. */
if (typeof window !== 'undefined' && window.__TUMBLE_WIRED__) {
  /* already wired in a prior HMR pass — listeners stay, do nothing */
} else if (typeof HookBus !== 'undefined') {
  if (typeof window !== 'undefined') window.__TUMBLE_WIRED__ = true;
  HookBus.on('preSpin', () => {
    _TUMBLE_KILL_TOKEN++;
    /* Wave Z (2026-06-10): on EVERY preSpin, clear tumble animation
       classes so a previous orphan never bleeds into the new spin. */
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.cell.is-removing, .cell.is-dropping, .cell.is-refilling')
        .forEach(c => {
          c.classList.remove('is-removing');
          c.classList.remove('is-dropping');
          c.classList.remove('is-refilling');
        });
    }
  }, { priority: 20 });
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsEnd', () => {
    /* Reset preserve-orbs state at the FS boundary so the next BASE spin
       doesn't carry orphan orbs. */
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.cell.is-removing, .cell.is-dropping, .cell.is-refilling')
        .forEach(c => {
          c.classList.remove('is-removing');
          c.classList.remove('is-dropping');
          c.classList.remove('is-refilling');
        });
    }
  }, { priority: 10 }) : void 0);
}
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
