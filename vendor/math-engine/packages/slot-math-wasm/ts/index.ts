/**
 * W244 wave 77 — TypeScript wrapper za slot-math-wasm pkg.
 *
 * Re-exports wasm-bindgen generated functions sa strongly-typed signatures,
 * grupisanim u categorical namespaces (RTP / Compliance / Helpers).
 *
 * Usage (after `wasm-pack build --target bundler --release`):
 *
 *   import { rtp, compliance } from 'slot-math-wasm/ts';
 *   await rtp.init();
 *   const r = rtp.bothWays(0.96, 0.7);  // 1.632
 *   const ok = compliance.ukgcRts13c(95, 100, 0.965, 0.5);  // false
 */

// @ts-expect-error -- pkg/ generated at build time, may not exist for TS tooling
import init, * as wasm from '../pkg/slot_math_wasm.js';

let wasmReady: Promise<void> | null = null;

/**
 * Initialize the wasm module. Idempotent — multiple calls share the same
 * underlying init promise. Must complete before any kernel call.
 */
export async function initWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = init().then(() => undefined);
  }
  return wasmReady;
}

// ── RTP kernels ───────────────────────────────────────────────────────────

export const rtp = {
  init: initWasm,

  /** RTP = ltr_only_rtp × (1 + line_pay_share). */
  bothWays(ltrOnlyRtp: number, linePayShare: number): number {
    return wasm.both_ways_rtp(ltrOnlyRtp, linePayShare);
  },

  /** Wald-identity single-tier charge meter RTP. */
  chargeMeterTier(
    expectedChargePerSpin: number,
    tierThreshold: number,
    tierAwardXBet: number,
  ): number {
    return wasm.charge_meter_tier_rtp(
      expectedChargePerSpin, tierThreshold, tierAwardXBet,
    );
  },

  /** buy_rtp = E[bonus_pay] / buy_cost. */
  buyFeature(bonusAvgPayXBet: number, buyCostXBet: number): number {
    return wasm.buy_feature_rtp(bonusAvgPayXBet, buyCostXBet);
  },

  /** Σ_k binomial_pmf_ge(n, p, k_min[k]) · pay[k]. */
  payAnywhere(
    nCells: number,
    pPerCell: number,
    payTableKeys: Uint32Array,
    payTableValues: Float64Array,
  ): number {
    return wasm.pay_anywhere_expected_pay(
      nCells, pPerCell, payTableKeys, payTableValues,
    );
  },

  /** Wheel: trigger_p × E[terminal] / (1 - p_again). */
  wheel(
    triggerP: number,
    expectedTerminalAwardXBet: number,
    pAgain: number,
  ): number {
    return wasm.wheel_rtp(triggerP, expectedTerminalAwardXBet, pAgain);
  },
};

// ── Compliance gates ─────────────────────────────────────────────────────

export const compliance = {
  /** UKGC RTS 13C: |buy_rtp - base_rtp| ≤ tolerance_pp. */
  ukgcRts13c(
    bonusAvgPayXBet: number,
    buyCostXBet: number,
    baseGameRtp: number,
    tolerancePp: number,
  ): boolean {
    return wasm.buy_feature_ukgc_rts13c_pass(
      bonusAvgPayXBet, buyCostXBet, baseGameRtp, tolerancePp,
    );
  },

  /** MGA RG 2021/02: buy_rtp ≤ ceiling_rtp. */
  mgaRg202102(
    bonusAvgPayXBet: number,
    buyCostXBet: number,
    ceilingRtp: number,
  ): boolean {
    return wasm.buy_feature_mga_pass(
      bonusAvgPayXBet, buyCostXBet, ceilingRtp,
    );
  },
};

// ── Helpers / utilities ──────────────────────────────────────────────────

export const helpers = {
  /** P[X ≥ k_min | X ~ Binomial(n, p)]. */
  binomialPmfGe(n: number, p: number, kMin: number): number {
    return wasm.binomialPmfGe(n, p, kMin);
  },

  /** Megaways-style total ways: Π_r n_r. */
  waysTotal(perReelSymbols: Uint32Array): bigint {
    return wasm.ways_total(perReelSymbols);
  },

  /** Pareto-distributed Crash: P[X < m] = 1 - (1 - house_edge) / m. */
  crashProbabilityBelow(houseEdge: number, m: number): number {
    return wasm.crash_probability_below(houseEdge, m);
  },
};

// Default export — convenient single-import
export default { rtp, compliance, helpers, initWasm };
