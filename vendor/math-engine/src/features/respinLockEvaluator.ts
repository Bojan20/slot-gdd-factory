/**
 * W152 Wave 20 — Respin Lock Evaluator (Faza 15.C.2).
 *
 * ⚠️ IP RIZIK NOTICE — vidi `docs/IP_REVIEW.md` § "15.C.2 respinLockEvaluator"
 *
 * Implementacija sticky-symbol respin mehanike sa fixed respin counter
 * reset-na-nove-locks (industry-generic, Cabot & Hannum 2002 § "Hold &
 * Spin family"). Generic feature postoji u industriji od pre 1995.
 *
 * KRITIČNO: ovo nije H&W Markov persistent (`src/features/persistentHWGrid.ts`
 * Faza 15.A.14). Razlike koje obezbeđuju clean-room separation:
 *
 *   1. **Lock semantics**: ovde lock je TRIGGERED-BY-CELL (specifični
 *      symbol kind aktivira lock na grid coordinate). U H&W Markov
 *      persistent, lock je TRIGGERED-BY-FEATURE-STATE (multi-class
 *      grid cells: cash / mult / collector / inert).
 *
 *   2. **Respin counter**: ovde counter resetuje SAMO na NOVI lock
 *      tokom respin-a. U H&W Markov persistent, counter prati
 *      Markov-chain transitions across cell classes (drugačiji state).
 *
 *   3. **Termination**: ovde feature ends kad counter dođe na 0 ILI
 *      grid je full-locked. U H&W Markov persistent, terminacija je
 *      vezana za Markov absorption state.
 *
 *   4. **Payout model**: ovde payout = sum of locked-cell payouts (fixed
 *      payouts od config-time). U H&W Markov persistent, payouts su
 *      class-bilinear closed-form sum.
 *
 * Modul je deterministički — nema RNG-a, caller dovodi cell-generator
 * closure. Replay-safe.
 *
 * Naming: `respinLockEvaluator` engine-generic (per glossary RESERVED
 * TERMS). Implementacija pokriva mehaniku iz akademske literature —
 * Cabot & Hannum 2002, Harrigan & Dixon 2009 §6, NJ DGE 13:69D-1.2(g)(7).
 */

export interface RespinCell {
  /** Symbol id at this cell (free-form string). */
  symbol: string;
  /** True if locked (won't re-roll on respin). */
  locked: boolean;
  /** Optional fixed payout multiplier when locked. */
  payoutX?: number;
}

export type RespinGrid = RespinCell[][]; // grid[reel][row]

export interface RespinLockConfig {
  /** Initial respin budget (default 3). */
  initialRespins?: number;
  /** Symbol kind that triggers a lock when landing on an unlocked cell. */
  triggerSymbol: string;
  /** Reset counter back to `initialRespins` on each NEW lock. Default true. */
  resetCounterOnNewLock?: boolean;
  /** Max total respins (RG safeguard, default 100). Throws if exceeded. */
  maxTotalRespins?: number;
}

export interface RespinPass {
  /** 1-based pass index. */
  passIndex: number;
  /** Number of NEW cells locked in this pass. */
  newLocksThisPass: number;
  /** Total locked cells AFTER this pass. */
  totalLockedAfterPass: number;
  /** Respins remaining AFTER this pass. */
  respinsRemaining: number;
}

export interface RespinResult {
  passes: RespinPass[];
  finalGrid: RespinGrid;
  /** Sum of payoutX across all locked cells in finalGrid. */
  totalPayoutX: number;
  /** True if the grid is fully locked at termination. */
  fullyLocked: boolean;
  /** Reason termination triggered: counter exhausted / full lock / cap. */
  terminationReason: 'counter_zero' | 'full_lock' | 'safeguard_cap';
}

export interface RespinPassContext {
  grid: RespinGrid;
  /**
   * Caller-provided cell generator. Returns the symbol that should land
   * at (reel, row) on this respin. Locked cells are NEVER regenerated.
   */
  generateCell: (reel: number, row: number) => string;
}

/** Deep-copy grid. Pure helper. */
function copyGrid(grid: RespinGrid): RespinGrid {
  return grid.map((reel) => reel.map((c) => ({ ...c })));
}

/**
 * Apply ONE respin pass. Returns the new grid + pass metadata.
 *
 * Locked cells stay verbatim. Unlocked cells regenerate via
 * `generateCell`. If a regenerated cell matches `triggerSymbol`, it
 * becomes locked AND stamped with `payoutX` looked up from `payoutTable`
 * (defaults to 0 if not present).
 */
export function applyRespinPass(
  ctx: RespinPassContext,
  config: RespinLockConfig,
  payoutTable: Record<string, number>,
): { newGrid: RespinGrid; newLockCount: number } {
  const newGrid = copyGrid(ctx.grid);
  let newLockCount = 0;
  for (let r = 0; r < newGrid.length; r++) {
    for (let c = 0; c < newGrid[r].length; c++) {
      const cell = newGrid[r][c];
      if (cell.locked) continue;
      const newSymbol = ctx.generateCell(r, c);
      cell.symbol = newSymbol;
      if (newSymbol === config.triggerSymbol) {
        cell.locked = true;
        cell.payoutX = payoutTable[newSymbol] ?? 0;
        newLockCount += 1;
      }
    }
  }
  return { newGrid, newLockCount };
}

/**
 * Run the full respin loop. Caller dovodi:
 *   * `initialGrid` — start state (typically the base-spin output that
 *     triggered the feature).
 *   * `payoutTable` — symbol → payoutX for locked cells.
 *   * `nextCellGenerator(passIndex)` — closure that returns a per-pass
 *     `generateCell` function. Caller manages RNG inside the closure.
 *
 * Pure deterministic given the closures — replay-safe.
 *
 * Throws on `maxTotalRespins` overflow (engine-bug safeguard, not a
 * normal terminus).
 */
export function runRespinLockLoop(
  initialGrid: RespinGrid,
  config: RespinLockConfig,
  payoutTable: Record<string, number>,
  nextCellGenerator: (passIndex: number) => (reel: number, row: number) => string,
): RespinResult {
  const initialRespins = config.initialRespins ?? 3;
  const resetOnLock = config.resetCounterOnNewLock ?? true;
  const cap = config.maxTotalRespins ?? 100;

  if (!Number.isInteger(initialRespins) || initialRespins <= 0) {
    throw new RangeError(`runRespinLockLoop: initialRespins must be positive integer`);
  }

  let grid = copyGrid(initialGrid);
  let respinsRemaining = initialRespins;
  let totalPasses = 0;
  const passes: RespinPass[] = [];

  let terminationReason: RespinResult['terminationReason'] = 'counter_zero';

  while (respinsRemaining > 0) {
    if (totalPasses >= cap) {
      terminationReason = 'safeguard_cap';
      break;
    }
    if (isFullyLocked(grid)) {
      terminationReason = 'full_lock';
      break;
    }
    totalPasses += 1;
    const passCtx: RespinPassContext = {
      grid,
      generateCell: nextCellGenerator(totalPasses),
    };
    const { newGrid, newLockCount } = applyRespinPass(passCtx, config, payoutTable);
    grid = newGrid;

    respinsRemaining -= 1;
    if (newLockCount > 0 && resetOnLock) {
      respinsRemaining = initialRespins;
    }
    passes.push({
      passIndex: totalPasses,
      newLocksThisPass: newLockCount,
      totalLockedAfterPass: countLocked(grid),
      respinsRemaining,
    });

    // Check full-lock terminus mid-loop.
    if (isFullyLocked(grid)) {
      terminationReason = 'full_lock';
      break;
    }
  }

  const totalPayoutX = grid.reduce(
    (s, reel) => s + reel.reduce((rs, c) => rs + (c.locked ? (c.payoutX ?? 0) : 0), 0),
    0,
  );

  return {
    passes,
    finalGrid: grid,
    totalPayoutX,
    fullyLocked: isFullyLocked(grid),
    terminationReason,
  };
}

function countLocked(grid: RespinGrid): number {
  let count = 0;
  for (const reel of grid) {
    for (const c of reel) if (c.locked) count += 1;
  }
  return count;
}

function isFullyLocked(grid: RespinGrid): boolean {
  for (const reel of grid) {
    for (const c of reel) if (!c.locked) return false;
  }
  return true;
}

/** Test-only convenience: build an N×M unlocked grid filled with one symbol. */
export function buildEmptyGrid(reels: number, rows: number, fill = 'A'): RespinGrid {
  return Array.from({ length: reels }, () =>
    Array.from({ length: rows }, () => ({ symbol: fill, locked: false })),
  );
}
