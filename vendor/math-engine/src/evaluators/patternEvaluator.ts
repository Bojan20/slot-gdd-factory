/**
 * W152 Faza 2.4 — Pattern Evaluator (TypeScript).
 *
 * Mirrors `rust-sim/src/evaluator.rs::evaluate_pattern` exactly:
 * each rule lists `(row, reel)` positions, the rule pays
 * `pay_multiplier × total_bet` if every position holds the same
 * symbol with wild substitution. Scatters / bonus symbols in any
 * position void the rule. Wild-only matches do NOT pay (matches the
 * line evaluator's convention).
 *
 * The signature mirrors the simulator's `evaluate_spin` numerical
 * shape: `total_bet_mc` is millicredits, payouts are returned in
 * millicredits so they can be summed across evaluation modes by
 * downstream consumers without unit gymnastics.
 */

import type { TSPatternRuleConfig } from '../ir/adapter.js';

export interface PatternEvalInput {
  /** Grid as `grid[reel][row] = symbolId`. */
  grid: string[][];
  rules: TSPatternRuleConfig[];
  /** Total bet in millicredits (1 credit = 1000 mc). */
  totalBetMc: number;
  /** Set of symbol IDs that count as wild (substitute non-special). */
  wildSymbols: Set<string>;
  /** Set of symbol IDs that count as special (scatter / bonus). */
  specialSymbols: Set<string>;
}

export interface PatternWin {
  ruleId: string;
  ruleIndex: number;
  symbolId: string;
  count: number;
  /** Payout in millicredits. */
  payoutMc: number;
}

export interface PatternEvalResult {
  wins: PatternWin[];
  /** Sum of `wins[].payoutMc`. */
  totalWinMc: number;
}

/**
 * Evaluate all pattern rules against the grid.
 *
 * Numerical convention (must match Rust):
 *   payoutMc = round(payMultiplier × 1000) × totalBetMc / 1000
 *
 * That keeps the multiplier scaling inside i64 in Rust without f64
 * drift and lets TS reproduce the same integer rounding using
 * `Math.round` + integer division.
 */
export function evaluatePattern(input: PatternEvalInput): PatternEvalResult {
  const { grid, rules, totalBetMc, wildSymbols, specialSymbols } = input;
  const wins: PatternWin[] = [];
  let totalWinMc = 0;
  const numReels = grid.length;

  rules.forEach((rule, ruleIdx) => {
    if (rule.positions.length === 0) {
      // Sentinel for "all" expansion; not handled here (caller must
      // have expanded already).
      return;
    }

    let candidate: string | null = null;
    let allWild = true;
    let boundsOk = true;

    for (const [row, reel] of rule.positions) {
      if (reel < 0 || reel >= numReels) {
        boundsOk = false;
        break;
      }
      const reelStrip = grid[reel];
      if (!reelStrip || row < 0 || row >= reelStrip.length) {
        boundsOk = false;
        break;
      }
      const sym = reelStrip[row];
      if (specialSymbols.has(sym)) {
        // Scatter / bonus in a pattern slot voids the rule.
        boundsOk = false;
        break;
      }
      if (!wildSymbols.has(sym)) {
        allWild = false;
        if (candidate === null) {
          candidate = sym;
        } else if (candidate !== sym) {
          boundsOk = false;
          break;
        }
      }
    }

    if (!boundsOk || allWild || candidate === null) {
      return;
    }

    // Double-check: every position must be wild or candidate.
    const matchesAll = rule.positions.every(([row, reel]) => {
      const s = grid[reel][row];
      return wildSymbols.has(s) || s === candidate;
    });
    if (!matchesAll) {
      return;
    }

    const payMc = Math.round(rule.payMultiplier * 1000);
    if (payMc <= 0) {
      return;
    }
    // saturating_mul + integer division to mirror Rust's i64 math.
    const win = Math.floor((payMc * totalBetMc) / 1000);
    if (win <= 0) {
      return;
    }
    totalWinMc += win;
    wins.push({
      ruleId: rule.id,
      ruleIndex: ruleIdx,
      symbolId: candidate,
      count: rule.positions.length,
      payoutMc: win,
    });
  });

  return { wins, totalWinMc };
}
