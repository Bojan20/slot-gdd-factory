// Universal Slot Sim — IR-driven, game-agnostic Monte-Carlo engine.
//
// PHILOSOPHY
// ----------
// Game-specific code lives in IR JSON, not Rust. Engine consumes:
//
//   {
//     "topology":   { kind, rows, reels, ... },
//     "evaluation": { kind: lines | ways | cluster | megaways, ... },
//     "symbols":    [ { id, role: lp|hp|wild|scatter|bonus|cash } ],
//     "reels":      [ { mode: weighted, weights: [...] } * 5 ],
//     "paytable":   [ { combo, pays, scope } ],
//     "features":   [ { kind: hold_and_win | pick_bonus | free_spins | progressive, ... } ],
//     "bet_table":  { lines, multipliers, total_bets },
//   }
//
// Engine pipeline per spin:
//   1. Sample reel set (if per-spin reel-set selection enabled)
//   2. Spin each reel → visible grid
//   3. Evaluate (paylines / ways / cluster / megaways)
//   4. Trigger features (in order: scatter → wild expand → free spins → hold-and-win → bonus → progressive)
//   5. Sum payout in total-bet units, contribute to histogram + RTP buckets
//
// Outputs unified `SimStats` regardless of which features fire.
// Verification step compares `SimStats` ↔ PAR ground-truth (per-SWID config).

pub mod ir;
pub mod rng;
pub mod reels;
pub mod evaluate;
pub mod features;
pub mod sim;
pub mod stats;

// W4.8c — Megaways evaluator (Skeleton Key family).
pub mod megaways_eval;
// W4.10c — Ways + cascade evaluator (Fortune Coin family).
pub mod ways_eval;

// W7.2 — Quasi-Monte Carlo (Halton/Sobol/Lattice) for tail variance reduction
// + bonus-buy EV convergence acceleration. See module docs for rationale.
pub mod qmc;
