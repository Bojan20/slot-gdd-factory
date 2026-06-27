/**
 * W152 Wave 19 — IR-native Ways-to-Win Evaluator (Faza 15.B.1).
 *
 * Variable-reel-height ways-to-win evaluation. Where the legacy
 * `allWaysEvaluator.ts` operated on the legacy GameConfig with fixed
 * reel/row geometry, this evaluator consumes an IR `Topology` of either
 * `rectangular` or `variable_rows` kind and emits ways count + per-line
 * winning combinations.
 *
 * Algorithm:
 *   * For each starting symbol on reel 0, walk reels 1..N-1.
 *   * On each reel, count matching symbols (including wild substitution).
 *   * Total ways for that symbol = product of per-reel match counts.
 *   * Win amount = paytable[symbol][matchLength] × ways.
 *
 * Bounds:
 *   * Up to 200 000 ways on a 6×7 grid (=7^6 = 117 649 — within bound).
 *   * Hard cap `MAX_WAYS_PER_SYMBOL = 200_000` to refuse pathological
 *     configs that would explode memory.
 *
 * Naming: `waysToWinIR` is engine-generic. Vendor-specific
 * implementations exist under different proprietary names (see
 * `docs/glossary.md` RESERVED TERMS).
 *
 * Closed-form RTP contribution:
 *   * If reel strips are uniform (every symbol has the same global
 *     count across all reels), the per-symbol RTP contribution
 *     simplifies to `Σ ways(s, k) × payout(s, k) × P(s)^k × (1-P(s))^(N-k)`.
 *   * Useful for the analytical solver — `closedFormWaysContribution`
 *     exposed for the report layer.
 */

import type { SlotGameIR, SymbolKey } from '../ir/types.js';

/** Hard cap per evaluation. Throws if exceeded. */
export const MAX_WAYS_PER_SYMBOL = 200_000;

export interface WaysWindow {
  /** symbols[reelIndex] = column of symbols visible on that reel. */
  symbols: ReadonlyArray<ReadonlyArray<SymbolKey>>;
}

export interface WaysWin {
  symbolId: SymbolKey;
  /** Count of consecutive reels (from leftmost) that contributed. */
  matchLength: number;
  /** Total ways across the contributing reels. */
  ways: number;
  /** Multiplier of the bet (= paytable × ways). */
  payoutX: number;
}

export interface WaysEvaluationResult {
  wins: WaysWin[];
  /** Sum of all win payoutX values. */
  totalPayoutX: number;
  /** Total ways evaluated (Σ across symbols). Useful for diagnostic. */
  totalWaysEvaluated: number;
}

/**
 * Evaluate a window of visible symbols against the IR's paytable using
 * the ways-to-win contract.
 *
 * Pure: no RNG, no side effects. Same input → same result.
 *
 * Throws on:
 *   * empty window
 *   * symbol not present in IR `symbols[]`
 *   * ways for any symbol > MAX_WAYS_PER_SYMBOL
 */
export function evaluateWaysToWin(ir: SlotGameIR, window: WaysWindow): WaysEvaluationResult {
  if (window.symbols.length === 0) {
    throw new Error('evaluateWaysToWin: empty window');
  }
  const numReels = window.symbols.length;
  // Build symbol → kind map for wild detection.
  const symbolKindById = new Map<SymbolKey, string>();
  const wildSubstitutes = new Map<SymbolKey, ReadonlyArray<SymbolKey> | '*'>();
  for (const s of ir.symbols) {
    symbolKindById.set(s.id, s.kind);
    if (s.kind === 'wild' && s.substitutes !== undefined) {
      wildSubstitutes.set(s.id, s.substitutes);
    }
  }
  // Walk every starting symbol on reel 0.
  const wins: WaysWin[] = [];
  let totalPayoutX = 0;
  let totalWaysEvaluated = 0;
  // Distinct paying symbols seen on reel 0 — wilds substitute, not pay
  // standalone (engine-generic ways convention).
  const seenStartingSymbols = new Set<SymbolKey>();
  for (const sym of window.symbols[0]) {
    if (symbolKindById.get(sym) === 'wild') continue;
    if (seenStartingSymbols.has(sym)) continue;
    seenStartingSymbols.add(sym);
    if (!symbolKindById.has(sym)) {
      throw new Error(`evaluateWaysToWin: symbol '${sym}' not present in IR.symbols`);
    }
    // For each reel, count how many cells match (symbol or substituting wild).
    let ways = 1;
    let matchLength = 0;
    for (let reel = 0; reel < numReels; reel++) {
      let matchOnReel = 0;
      for (const cellSym of window.symbols[reel]) {
        const kind = symbolKindById.get(cellSym);
        if (cellSym === sym) {
          matchOnReel += 1;
        } else if (kind === 'wild') {
          const subs = wildSubstitutes.get(cellSym);
          if (subs === '*' || (Array.isArray(subs) && subs.includes(sym))) {
            matchOnReel += 1;
          }
        }
      }
      if (matchOnReel === 0) break;
      ways *= matchOnReel;
      if (ways > MAX_WAYS_PER_SYMBOL) {
        throw new RangeError(
          `evaluateWaysToWin: ways (${ways}) exceeds MAX_WAYS_PER_SYMBOL (${MAX_WAYS_PER_SYMBOL}) for symbol '${sym}'`,
        );
      }
      matchLength = reel + 1;
    }
    if (matchLength === 0) continue;
    totalWaysEvaluated += ways;
    const paytableEntry = ir.paytable[sym];
    if (paytableEntry === undefined) continue;
    const payoutPerLine = paytableEntry[String(matchLength)];
    if (payoutPerLine === undefined || payoutPerLine === 0) continue;
    const payoutX = payoutPerLine * ways;
    wins.push({ symbolId: sym, matchLength, ways, payoutX });
    totalPayoutX += payoutX;
  }
  return { wins, totalPayoutX, totalWaysEvaluated };
}

/**
 * Closed-form RTP contribution under uniform-strip assumption.
 *
 * For symbol `s` with per-reel probability `p_s = count(s) / stripLen`,
 * contribution to RTP from a `k`-of-a-kind hit is approximately:
 *
 *   waysScore(N, k, s) ≈ payout(s, k) × C(N-1, k-1) × p_s^k × (1 - p_s)^(N-k)
 *
 * This is the textbook ways-to-win analytical fold (Harrigan & Dixon
 * 2009, §4.2).
 *
 * NOT exact for non-uniform strips — caller should fall back to MC.
 */
export function closedFormWaysContribution(
  ir: SlotGameIR,
  symbolId: SymbolKey,
  perReelProbability: number,
  numReels: number,
): number {
  if (perReelProbability < 0 || perReelProbability > 1) {
    throw new RangeError(`closedFormWaysContribution: perReelProbability out of [0, 1]`);
  }
  if (!Number.isInteger(numReels) || numReels < 1) {
    throw new RangeError(`closedFormWaysContribution: numReels must be positive integer`);
  }
  const paytable = ir.paytable[symbolId];
  if (paytable === undefined) return 0;
  let contribution = 0;
  for (const kStr of Object.keys(paytable)) {
    const k = Number(kStr);
    if (!Number.isInteger(k) || k < 1 || k > numReels) continue;
    const payout = paytable[kStr];
    if (payout === 0) continue;
    // C(N-1, k-1)
    const c = binomial(numReels - 1, k - 1);
    const probHit = Math.pow(perReelProbability, k);
    const probMiss = Math.pow(1 - perReelProbability, numReels - k);
    contribution += payout * c * probHit * probMiss;
  }
  return contribution;
}

/** Binomial coefficient using stable iterative product. */
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}
