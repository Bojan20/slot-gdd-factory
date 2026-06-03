/**
 * src/blocks/tumble.mjs
 *
 * Wave K2 — Tumble (cascade / avalanche) runtime engine.
 *
 * When GDD declares `topology.cascade.enabled: true` (Sugar Rush /
 * Gates of Olympus / Reactoonz style), the spin lifecycle becomes:
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

export function defaultConfig() {
  return {
    enabled: false,
    removeMs: 280,    // fade-out duration for winning symbols
    gravityMs: 320,   // drop animation per row of fall
    refillMs: 260,    // new-symbol drop-in
    chainPauseMs: 180,// breath between tumbles
    maxChain: 16,     // safety cap on consecutive tumble iterations
    preserveOrbs: true, // multiplier orbs stay on screen across tumbles
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.tumble || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.removeMs))     cfg.removeMs    = clampInt(m.removeMs, 50, 2000);
  if (Number.isFinite(m.gravityMs))    cfg.gravityMs   = clampInt(m.gravityMs, 50, 2000);
  if (Number.isFinite(m.refillMs))     cfg.refillMs    = clampInt(m.refillMs, 50, 2000);
  if (Number.isFinite(m.chainPauseMs)) cfg.chainPauseMs= clampInt(m.chainPauseMs, 0, 2000);
  if (Number.isFinite(m.maxChain))     cfg.maxChain    = clampInt(m.maxChain, 1, 64);
  if (m.preserveOrbs != null) cfg.preserveOrbs = !!m.preserveOrbs;

  // Auto-enable when GDD topology declares cascade
  if (model.topology && model.topology.cascade && model.topology.cascade.enabled) {
    cfg.enabled = true;
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
.cell.is-dropping {
  animation: tumbleDrop ${cfg.gravityMs}ms cubic-bezier(.34,1.2,.6,1) forwards;
}
.cell.is-refilling {
  animation: tumbleDrop ${cfg.refillMs}ms cubic-bezier(.34,1.05,.6,1) forwards;
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-removing  { animation: none; opacity: 0; }
  .cell.is-dropping  { animation: none; }
  .cell.is-refilling { animation: none; }
}
`;
}

export function emitTumbleRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `/* tumble: disabled (single-spin slot, no cascade) */
function runTumbleChain(_detectFn) { return Promise.resolve({ chain: 0, totalWinX: 0, events: [] }); }
`;
  }
  return `/* ─── tumble (cascade) runtime engine ─────────────────────────── */
const TUMBLE_REMOVE_MS   = ${cfg.removeMs};
const TUMBLE_GRAVITY_MS  = ${cfg.gravityMs};
const TUMBLE_REFILL_MS   = ${cfg.refillMs};
const TUMBLE_CHAIN_PAUSE = ${cfg.chainPauseMs};
const TUMBLE_MAX_CHAIN   = ${cfg.maxChain};
const TUMBLE_PRESERVE_ORBS = ${cfg.preserveOrbs};

function _tumbleSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* Run a full tumble chain.
   detectFn must be a synchronous function returning an array of win events
   shaped like { symbol, tier, cells:[...DOMcells], payX }.
   Each tumble iteration:
     1. detect → bail if no wins
     2. flash + remove winning cells (TUMBLE_REMOVE_MS)
     3. gravity — drop survivors into empties (TUMBLE_GRAVITY_MS)
     4. refill — randomize empties from RECT_REELS strip (TUMBLE_REFILL_MS)
     5. pause (TUMBLE_CHAIN_PAUSE) then loop.
   Returns final chain stats: { chain, totalWinX, events[] (flat) }. */
async function runTumbleChain(detectFn) {
  let chain = 0;
  let totalWinX = 0;
  const allEvents = [];

  while (chain < TUMBLE_MAX_CHAIN) {
    const events = (typeof detectFn === 'function') ? (detectFn() || []) : [];
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

    for (const c of removeCells) c.classList.add('is-removing');
    await _tumbleSleep(TUMBLE_REMOVE_MS);

    // 3 + 4. gravity + refill via reel-strip rotation
    _tumbleApplyGravity(removeCells);
    await _tumbleSleep(TUMBLE_GRAVITY_MS);

    _tumbleRefillEmpties(removeCells);
    await _tumbleSleep(TUMBLE_REFILL_MS);

    // 5. breath
    await _tumbleSleep(TUMBLE_CHAIN_PAUSE);
  }

  return { chain, totalWinX, events: allEvents };
}

/* Gravity — for each reel column with removed cells, drop the surviving
   visible symbols down into the empties. Multiplier orbs are preserved
   in place when TUMBLE_PRESERVE_ORBS is true (GoO rule). */
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
      cell.classList.remove('is-removing');
      cell.textContent = newVisible[row] || '';
      if (newVisible[row]) cell.classList.add('is-dropping');
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
      const sym = (strip.length > 0)
        ? String(strip[Math.floor(Math.random() * strip.length)]).toUpperCase()
        : 'A';
      reel.visible[row] = sym;
      const cell = (typeof reel.cellAt === 'function') ? reel.cellAt(row) : (reel.cells && reel.cells[row]);
      if (cell) {
        cell.classList.remove('is-dropping');
        cell.textContent = sym;
        cell.classList.add('is-refilling');
      }
    }
  }
  // Clear refill animation after a frame so subsequent tumbles can re-trigger
  setTimeout(() => {
    document.querySelectorAll('.cell.is-refilling, .cell.is-dropping').forEach(c => {
      c.classList.remove('is-refilling');
      c.classList.remove('is-dropping');
    });
  }, TUMBLE_REFILL_MS + 20);
}

if (typeof window !== "undefined") {
  window.runTumbleChain = runTumbleChain;
  window.TUMBLE_MAX_CHAIN = TUMBLE_MAX_CHAIN;
}
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
