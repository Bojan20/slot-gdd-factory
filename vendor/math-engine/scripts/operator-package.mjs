#!/usr/bin/env node
//
// W152 Wave 44 — Operator Sales Package Builder.
//
// Single-button tool that produces a self-contained ZIP a Tier-1
// operator (or auditor) can open without any toolchain. Contains:
//
//   - SOURCE/                 git archive (tar.gz inside)
//   - REPORTS/                all acceptance / RNG / dossier outputs
//   - DOCS/                   commercial pitch + spec docs + glossary
//   - SCHEMAS/                USIF PAR Schema v1.0
//   - INDUSTRY_FIRST_DOSSIER.md   (top-level entry point)
//   - README.md               (this package's table-of-contents)
//   - MANIFEST.json           (file listing + sha256 of every artifact)
//
// Output:
//   reports/operator-package/
//     slot-math-engine-<short-sha>-operator-pkg.zip
//     slot-math-engine-<short-sha>-operator-pkg.MANIFEST.json
//
// Run:  npm run operator-package
//
// CLI:
//   --skip-acceptance   Skip running the 8 acceptance suites (use cached reports)
//   --tag NAME          Override the short-sha tag

import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'operator-package');

const argv = process.argv.slice(2);
const SKIP_ACCEPTANCE = argv.includes('--skip-acceptance');
const TAG_OVERRIDE = (() => { const i = argv.indexOf('--tag'); return i >= 0 ? argv[i + 1] : null; })();

// ─── Acceptance suites to refresh ──────────────────────────────────────────

const ACCEPTANCE_SUITES = [
  // Wave 33 — runs vitest (already covered by suite); skip dedicated run
  // Wave 34 — mutation-summary (regenerates SUMMARY.json from cached Stryker)
  { id: 'mutation-summary', cmd: 'node scripts/mutation-summary.mjs', wave: 34, optional: true },
  // Wave 35
  { id: 'usif-par-validate', cmd: 'node scripts/usif-par-validate.mjs', wave: 35 },
  // Wave 36 — needs build first (irSimulator dist)
  { id: 'jurisdiction-auto-gate', cmd: 'node scripts/jurisdiction-auto-gate-acceptance.mjs', wave: 36 },
  // Wave 33 — metamorphic
  { id: 'metamorphic-rtp', cmd: 'node scripts/metamorphic-rtp-invariants.mjs', wave: 33 },
  // Wave 37 — diff fuzz
  { id: 'diff-fuzz-cross-lang', cmd: 'node scripts/diff-fuzz-cross-language.mjs --variants 5 --spins 1000', wave: 37, lite: true },
  // Wave 39 — SP 800-90B
  { id: 'sp80090b-assess', cmd: 'node scripts/sp80090b-assess.mjs', wave: 39 },
  // Wave 40 — PAR commitment
  { id: 'par-commitment-acceptance', cmd: 'node scripts/par-commitment-acceptance.mjs', wave: 40 },
  // Wave 43 — ENT
  { id: 'ent-assess', cmd: 'node scripts/ent-assess.mjs', wave: 43 },
  // Wave 61 — closed-form portfolio runner (12 closed-form solvers landed W49-60)
  { id: 'closed-form-portfolio', cmd: 'node scripts/closed-form-portfolio.mjs', wave: 61 },
];

// ─── Files to package ──────────────────────────────────────────────────────

const PACKAGE_FILES = [
  // TOP — entry points
  { kind: 'top', src: 'reports/dossier/INDUSTRY_FIRST_DOSSIER.md', dst: 'INDUSTRY_FIRST_DOSSIER.md' },
  { kind: 'top', src: 'docs/COMMERCIAL_PITCH.md', dst: 'COMMERCIAL_PITCH.md' },
  // DOCS
  { kind: 'docs', src: 'docs/USIF_PAR_SCHEMA_v1.md' },
  { kind: 'docs', src: 'docs/HSM_SEED_ARCHITECTURE.md' },
  { kind: 'docs', src: 'docs/SP_800_90B_ASSESSMENT.md' },
  { kind: 'docs', src: 'docs/PAR_COMMITMENT_SPEC.md' },
  { kind: 'docs', src: 'docs/architecture.md' },
  { kind: 'docs', src: 'docs/rng.md' },
  { kind: 'docs', src: 'docs/precision.md' },
  { kind: 'docs', src: 'docs/glossary.md' },
  { kind: 'docs', src: 'docs/compliance.md' },
  { kind: 'docs', src: 'docs/IR_SPEC.md' },
  { kind: 'docs', src: 'docs/MATH_QUICK_REFERENCE.md' },
  { kind: 'docs', src: 'docs/IP_REVIEW.md' },
  // SCHEMAS
  { kind: 'schemas', src: 'schemas/usif-par-v1.0.json' },
  // REPORTS — dossier
  { kind: 'reports/dossier', src: 'reports/dossier/INDUSTRY_FIRST_DOSSIER.json' },
  // REPORTS — acceptance (Wave 33-43)
  { kind: 'reports/acceptance', src: 'reports/acceptance/METAMORPHIC_RTP.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/METAMORPHIC_RTP.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/JURISDICTION_AUTO_GATE.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/JURISDICTION_AUTO_GATE.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/DIFF_FUZZ_CROSS_LANG.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/DIFF_FUZZ_CROSS_LANG.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PAR_COMMITMENT.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PAR_COMMITMENT.md' },
  // REPORTS — RNG
  { kind: 'reports/rng', src: 'reports/rng/SP_800_90B_ASSESSMENT.json' },
  { kind: 'reports/rng', src: 'reports/rng/SP_800_90B_ASSESSMENT.md' },
  { kind: 'reports/rng', src: 'reports/rng/ENT_ASSESSMENT.json' },
  { kind: 'reports/rng', src: 'reports/rng/ENT_ASSESSMENT.md' },
  // REPORTS — usif-par + mutation
  { kind: 'reports/usif-par', src: 'reports/usif-par/VALIDATION_REPORT.json' },
  { kind: 'reports/usif-par', src: 'reports/usif-par/VALIDATION_REPORT.md' },
  { kind: 'reports/mutation', src: 'reports/mutation/SUMMARY.json' },
  { kind: 'reports/mutation', src: 'reports/mutation/SUMMARY.md' },
  { kind: 'reports/mutation', src: 'reports/mutation/baseline.json' },
  // REPORTS — Wave 49-61 closed-form portfolio (W152)
  { kind: 'reports/dossier', src: 'reports/dossier/CLOSED_FORM_PORTFOLIO.json' },
  { kind: 'reports/dossier', src: 'reports/dossier/CLOSED_FORM_PORTFOLIO.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/HNW_LADDER.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/HNW_LADDER.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/CHARGE_METER.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/CHARGE_METER.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/SUPERMETER.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/SUPERMETER.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/STICKY_CASH_REVEAL.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/STICKY_CASH_REVEAL.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/WALKING_WILD_RESPIN.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/WALKING_WILD_RESPIN.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MEGACLUSTER_STACK_WAYS.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MEGACLUSTER_STACK_WAYS.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/ENTROPY_HEALTH_MONITOR.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/ENTROPY_HEALTH_MONITOR.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/DEMO_MODE.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/DEMO_MODE.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/CRASH_MULTIPLIER.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/CRASH_MULTIPLIER.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PARALLEL_SCREENS.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PARALLEL_SCREENS.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/CLASS_II_BINGO.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/CLASS_II_BINGO.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/STICKY_CASH_COLLECTOR.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/STICKY_CASH_COLLECTOR.md' },
  // REPORTS — Wave 71/72/75 progressive jackpot family (W152 Wave 77)
  { kind: 'reports/acceptance', src: 'reports/acceptance/MUST_HIT_BY_JACKPOT.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MUST_HIT_BY_JACKPOT.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PSEUDO_MUST_HIT_LEVEL.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PSEUDO_MUST_HIT_LEVEL.md' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MULTI_TIER_WAP_WHEEL.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MULTI_TIER_WAP_WHEEL.md' },
  // REPORTS — Wave 81/82 Bonus Buy Variance Analyzer (W152 Wave 82)
  { kind: 'reports/acceptance', src: 'reports/acceptance/BONUS_BUY_VARIANCE.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/BONUS_BUY_VARIANCE.md' },
  // REPORTS — Wave 84 Free Spins Retrigger Compound (W152 Wave 85)
  { kind: 'reports/acceptance', src: 'reports/acceptance/FREE_SPINS_RETRIGGER.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/FREE_SPINS_RETRIGGER.md' },
  // REPORTS — Wave 86 Cascade Multiplier Pyramid (W152 Wave 87)
  { kind: 'reports/acceptance', src: 'reports/acceptance/CASCADE_MULTIPLIER_PYRAMID.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/CASCADE_MULTIPLIER_PYRAMID.md' },
  // REPORTS — Wave 89 Persistent Multiplier Accumulator (W152 Wave 90)
  { kind: 'reports/acceptance', src: 'reports/acceptance/PERSISTENT_MULTIPLIER.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PERSISTENT_MULTIPLIER.md' },
  // REPORTS — Wave 91 Coin Accumulator + Mystery (W152 Wave 92)
  { kind: 'reports/acceptance', src: 'reports/acceptance/COIN_ACCUMULATOR_MYSTERY.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/COIN_ACCUMULATOR_MYSTERY.md' },
  // REPORTS — Wave 93 Multiplicative Wild Stack (W152 Wave 94)
  { kind: 'reports/acceptance', src: 'reports/acceptance/MULTIPLICATIVE_WILD_STACK.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MULTIPLICATIVE_WILD_STACK.md' },
  // REPORTS — Wave 95 Ante Bet Trade-Off (W152 Wave 96)
  { kind: 'reports/acceptance', src: 'reports/acceptance/ANTE_BET_TRADEOFF.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/ANTE_BET_TRADEOFF.md' },
  // REPORTS — Wave 97 FS Lookback Multiplier (W152 Wave 98)
  { kind: 'reports/acceptance', src: 'reports/acceptance/FREE_SPINS_LOOKBACK_MULTIPLIER.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/FREE_SPINS_LOOKBACK_MULTIPLIER.md' },
  // REPORTS — Wave 101 Symbol Upgrade Chain Markov (W152 Wave 103)
  { kind: 'reports/acceptance', src: 'reports/acceptance/SYMBOL_UPGRADE_CHAIN.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/SYMBOL_UPGRADE_CHAIN.md' },
  // REPORTS — Wave 102 Cluster Compound Variance (W152 Wave 104)
  { kind: 'reports/acceptance', src: 'reports/acceptance/CLUSTER_COMPOUND_VARIANCE.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/CLUSTER_COMPOUND_VARIANCE.md' },
  // REPORTS — Wave 105 Bonus Wheel + Respin (W152 Wave 106)
  { kind: 'reports/acceptance', src: 'reports/acceptance/BONUS_WHEEL_RESPIN.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/BONUS_WHEEL_RESPIN.md' },
  // REPORTS — Wave 107 Pick Bonus N-Stage Tree (W152 Wave 108)
  { kind: 'reports/acceptance', src: 'reports/acceptance/PICK_BONUS_N_STAGE.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PICK_BONUS_N_STAGE.md' },
  // REPORTS — Wave 110 Bonus Trigger Wait Time Analyzer (W152 Wave 111)
  { kind: 'reports/acceptance', src: 'reports/acceptance/BONUS_TRIGGER_WAIT_TIME.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/BONUS_TRIGGER_WAIT_TIME.md' },
  // REPORTS — Wave 112 Variable Reel Height Ways (W152 Wave 113)
  { kind: 'reports/acceptance', src: 'reports/acceptance/VARIABLE_REEL_HEIGHT_WAYS.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/VARIABLE_REEL_HEIGHT_WAYS.md' },
  // REPORTS — Wave 114 Sticky Wild Countdown Multiplier (W152 Wave 115)
  { kind: 'reports/acceptance', src: 'reports/acceptance/STICKY_WILD_COUNTDOWN_MULT.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/STICKY_WILD_COUNTDOWN_MULT.md' },
  // REPORTS — Wave 116 Mystery Symbol Reveal Aggregator (W152 Wave 117)
  { kind: 'reports/acceptance', src: 'reports/acceptance/MYSTERY_SYMBOL_REVEAL.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MYSTERY_SYMBOL_REVEAL.md' },
  // REPORTS — Wave 118 Bonus Collect-N Trigger Tracker (W152 Wave 119)
  { kind: 'reports/acceptance', src: 'reports/acceptance/BONUS_COLLECT_N.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/BONUS_COLLECT_N.md' },
  // REPORTS — Wave 121 Cascade Multiplier Chain Lockstep Conditional (W152 Wave 122)
  { kind: 'reports/acceptance', src: 'reports/acceptance/CASCADE_MULTIPLIER_CHAIN.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/CASCADE_MULTIPLIER_CHAIN.md' },
  // REPORTS — Wave 123 Mega Symbol Multi-Cell Expansion (W152 Wave 124)
  { kind: 'reports/acceptance', src: 'reports/acceptance/MEGA_SYMBOL_EXPANSION.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MEGA_SYMBOL_EXPANSION.md' },
  // REPORTS — Wave 125 Bi-Directional Line Pay Aggregator (W152 Wave 126)
  { kind: 'reports/acceptance', src: 'reports/acceptance/BIDIRECTIONAL_LINE_PAY.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/BIDIRECTIONAL_LINE_PAY.md' },
  // REPORTS — Wave 127 Anticipation/Tease Reel (W152 Wave 128)
  { kind: 'reports/acceptance', src: 'reports/acceptance/ANTICIPATION_REEL_TEASE.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/ANTICIPATION_REEL_TEASE.md' },
  // REPORTS — Wave 130 Free Spins Buy + Tier Escalation Trade-Off (W152 Wave 131)
  { kind: 'reports/acceptance', src: 'reports/acceptance/FS_BUY_TIER_TRADEOFF.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/FS_BUY_TIER_TRADEOFF.md' },
  // REPORTS — Wave 132 Multi-Level Wild Tier Markov (W152 Wave 133)
  { kind: 'reports/acceptance', src: 'reports/acceptance/MULTI_LEVEL_WILD_MARKOV.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MULTI_LEVEL_WILD_MARKOV.md' },
  // REPORTS — Wave 134 Hold-and-Win Multi-Tier Value-Based Jackpot (W152 Wave 135)
  { kind: 'reports/acceptance', src: 'reports/acceptance/HOLD_WIN_VALUE_JACKPOT.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/HOLD_WIN_VALUE_JACKPOT.md' },
  // REPORTS — Wave 136 Locked/Held Reels During FS (W152 Wave 137)
  { kind: 'reports/acceptance', src: 'reports/acceptance/LOCKED_REELS_FS.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/LOCKED_REELS_FS.md' },
  // REPORTS — Wave 138 Tumble Multiplier with Cap (W152 Wave 139)
  { kind: 'reports/acceptance', src: 'reports/acceptance/TUMBLE_MULTIPLIER_CAP.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/TUMBLE_MULTIPLIER_CAP.md' },
  // REPORTS — Wave 140 Adjacent Pays Aggregator (W152 Wave 141)
  { kind: 'reports/acceptance', src: 'reports/acceptance/ADJACENT_PAYS_AGGREGATOR.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/ADJACENT_PAYS_AGGREGATOR.md' },
  // REPORTS — Wave 142 Symbol Multiplier on Reel-Stop (W152 Wave 143)
  { kind: 'reports/acceptance', src: 'reports/acceptance/SYMBOL_MULT_REEL_STOP.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/SYMBOL_MULT_REEL_STOP.md' },
  // REPORTS — Wave 144 Trail/Board Bonus Progression Tracker (W152 Wave 145)
  { kind: 'reports/acceptance', src: 'reports/acceptance/TRAIL_BONUS_TRACKER.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/TRAIL_BONUS_TRACKER.md' },
  // REPORTS — Wave 146 Cascade Meter Charge-Up Trigger (W152 Wave 147)
  { kind: 'reports/acceptance', src: 'reports/acceptance/CASCADE_METER_CHARGE_UP.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/CASCADE_METER_CHARGE_UP.md' },
  // REPORTS — Wave 148 Max Win Cap Truncation Analyzer (W152 Wave 149)
  { kind: 'reports/acceptance', src: 'reports/acceptance/MAX_WIN_CAP_TRUNCATION.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MAX_WIN_CAP_TRUNCATION.md' },
  // REPORTS — Wave 150 Voltage/XP Meter Multi-Tier (W152 Wave 151)
  { kind: 'reports/acceptance', src: 'reports/acceptance/VOLTAGE_METER_MULTI_TIER.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/VOLTAGE_METER_MULTI_TIER.md' },
  // REPORTS — Wave 152 Bonus Trigger Award Stratification (W152 Wave 153)
  { kind: 'reports/acceptance', src: 'reports/acceptance/BONUS_TRIGGER_AWARD_STRATIFICATION.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/BONUS_TRIGGER_AWARD_STRATIFICATION.md' },
  // REPORTS — Wave 154 Free Bet Wagering Requirement Aggregator (W152 Wave 155)
  { kind: 'reports/acceptance', src: 'reports/acceptance/FREE_BET_WAGERING_REQUIREMENT.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/FREE_BET_WAGERING_REQUIREMENT.md' },
  // REPORTS — Wave 157 Session Bankroll Drawdown Analyzer (W152 Wave 158, 50. solver MILESTONE, INDUSTRY-FIRST UKGC LCCP 3.4.3)
  { kind: 'reports/acceptance', src: 'reports/acceptance/SESSION_BANKROLL_DRAWDOWN.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/SESSION_BANKROLL_DRAWDOWN.md' },
  // REPORTS — Wave 159 Hit Frequency Distribution Decomposition Analyzer (W152 Wave 160, 51. solver, INDUSTRY-STANDARD UKGC RTS 14 / eCOGRA)
  { kind: 'reports/acceptance', src: 'reports/acceptance/HIT_FREQUENCY_DISTRIBUTION.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/HIT_FREQUENCY_DISTRIBUTION.md' },
  // REPORTS — Wave 161 Max Drop From Starting Bankroll During Session Analyzer (W152 Wave 162, 52. solver, INDUSTRY-FIRST UKGC LCCP 3.4.3 / MGA PPD §17 — completes responsible-gambling triad)
  { kind: 'reports/acceptance', src: 'reports/acceptance/RUNNING_MAX_DRAWDOWN.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/RUNNING_MAX_DRAWDOWN.md' },
  // REPORTS — Wave 163 Martingale Wager Progression Bust Time Analyzer (W152 Wave 164, 53. solver, INDUSTRY-FIRST chase-pattern UKGC LCCP 3.4.3 / MGA PPD §18 / AU NCPF Schedule 4)
  { kind: 'reports/acceptance', src: 'reports/acceptance/MARTINGALE_BUST_TIME.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MARTINGALE_BUST_TIME.md' },
  // REPORTS — Wave 165 Reverse Martingale (Paroli) Streak Cash-Out (W152 Wave 166, 54. solver, INDUSTRY-FIRST let-it-ride DUAL W163 NHS #2)
  { kind: 'reports/acceptance', src: 'reports/acceptance/PAROLI_STREAK_CASH_OUT.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PAROLI_STREAK_CASH_OUT.md' },
  // REPORTS — Wave 167 AWP Cycle Convergence (W152 Wave 168, 55. solver, INDUSTRY-FIRST UK Class III B3 UKGC LCCP)
  { kind: 'reports/acceptance', src: 'reports/acceptance/AWP_CYCLE_CONVERGENCE.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/AWP_CYCLE_CONVERGENCE.md' },
  // REPORTS — Wave 169 Drop-and-Stick Wild Expansion (W152 Wave 170, 56. solver, per-cell sticky Vendor D Witchcraft / Pragmatic / Hacksaw)
  { kind: 'reports/acceptance', src: 'reports/acceptance/DROP_STICK_WILD_EXPANSION.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/DROP_STICK_WILD_EXPANSION.md' },
  // REPORTS — Wave 171 Tumbling Cascade Chain Length (W152 Wave 172, 57. solver, Wald identity Sweet Bonanza / Gonzo / Reactoonz / Big Bass tumble)
  { kind: 'reports/acceptance', src: 'reports/acceptance/TUMBLING_CASCADE_CHAIN_LENGTH.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/TUMBLING_CASCADE_CHAIN_LENGTH.md' },
  // REPORTS — Wave 173 Pick-and-Click Pooper Bonus (W152 Wave 174, 58. solver, Negative Hypergeometric Vendor C 5 Dragons / Vendor H Quick Hit / Vendor D Gonzo / Vendor A WoF)
  { kind: 'reports/acceptance', src: 'reports/acceptance/PICK_CLICK_POOPER_BONUS.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PICK_CLICK_POOPER_BONUS.md' },
  // REPORTS — Wave 175 Skill-Stop Near-Miss Rate (W152 Wave 176, 59. solver, INDUSTRY-FIRST anti-near-miss regulatory inflation detector UKGC RTS 12 / JP Pachislot 風営法 / AU NCPF / AGCO)
  { kind: 'reports/acceptance', src: 'reports/acceptance/SKILL_STOP_NEAR_MISS.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/SKILL_STOP_NEAR_MISS.md' },
  // REPORTS — 🎯 Wave 177 Avalanche Reactor Wave Aggregator (W152 Wave 178, 60. solver MILESTONE, doubly-compound Wald Reactoonz Quantum Leap / ELK Reactor / BTG Megaways / Tombstone Rip / Sweet Bonanza ante-bet)
  { kind: 'reports/acceptance', src: 'reports/acceptance/AVALANCHE_REACTOR_WAVE_AGGREGATOR.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/AVALANCHE_REACTOR_WAVE_AGGREGATOR.md' },
  // REPORTS — Wave 179 Sticky Multiplier FS Trail Aggregator (W152 Wave 180, 61. solver compound Binomial trail quadratic-in-N BTG Bonanza Megaways / Sweet Bonanza FS mult-coin / White Rabbit / Wanted Dead bounty / Money Cart 4 EXTRA SHIFT / Big Bad Wolf)
  { kind: 'reports/acceptance', src: 'reports/acceptance/STICKY_MULTIPLIER_FS_TRAIL.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/STICKY_MULTIPLIER_FS_TRAIL.md' },
  // REPORTS — Wave 181 Reel-Bound Mystery Progressive (W152 Wave 181, 62. solver Vendor B M5 GAP CLOSURE Quick Hit family Platinum/Black Gold/Pro/Wild/Blitz/Cash Wheel/Triple Cash Wheel/Smokin 7s)
  { kind: 'reports/acceptance', src: 'reports/acceptance/REEL_BOUND_MYSTERY_PROGRESSIVE.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/REEL_BOUND_MYSTERY_PROGRESSIVE.md' },
  // REPORTS — Wave 182 Dynamic Grid-Expansion H&S (Vendor B M3 GAP CLOSURE — Ultimate Fire Link family 7+ variants + Pattern-LIL Eureka Reel Blast)
  { kind: 'reports/acceptance', src: 'reports/acceptance/DYNAMIC_GRID_EXPANSION_HOLD_SPIN.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/DYNAMIC_GRID_EXPANSION_HOLD_SPIN.md' },
  // REPORTS — Wave 183 Multi-State Frame Upgrade Markov (Vendor B M2 GAP CLOSURE — Huff N' Puff family 8 titles original/More/Even More/Lots of/Xtra/Hard Hat/Grand/Money Mansion)
  { kind: 'reports/acceptance', src: 'reports/acceptance/MULTI_STATE_FRAME_UPGRADE_MARKOV.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/MULTI_STATE_FRAME_UPGRADE_MARKOV.md' },
  // REPORTS — Wave 184 Colossal Reels Wild-Transfer (Vendor B M7 GAP CLOSURE — Spartacus family + 50+ WMS land-based titles)
  { kind: 'reports/acceptance', src: 'reports/acceptance/COLOSSAL_REELS_WILD_TRANSFER.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/COLOSSAL_REELS_WILD_TRANSFER.md' },
  // REPORTS — Wave 185 Per-Reel Bag × Row-Multiplier Coupled (Vendor B M1 GAP CLOSURE — Dragon Spin CrossLink Water)
  { kind: 'reports/acceptance', src: 'reports/acceptance/PER_REEL_BAG_ROW_MULTIPLIER_COUPLED.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PER_REEL_BAG_ROW_MULTIPLIER_COUPLED.md' },
  // REPORTS — Wave 186 Big Bet Paid-Package Multi-Spin (UK-CRITICAL Vendor B M9 GAP CLOSURE — Barcrest UK family)
  { kind: 'reports/acceptance', src: 'reports/acceptance/BIG_BET_PAID_PACKAGE_MULTI_SPIN.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/BIG_BET_PAID_PACKAGE_MULTI_SPIN.md' },
  // REPORTS — Wave 187 Deterministic Explosion Multiplier-Drop (Vendor B M4 P1 GAP CLOSURE — Dancing Drums Explosion + Revolution)
  { kind: 'reports/acceptance', src: 'reports/acceptance/DETERMINISTIC_EXPLOSION_MULTIPLIER_DROP.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/DETERMINISTIC_EXPLOSION_MULTIPLIER_DROP.md' },
  // REPORTS — Wave 188 Player-Elects Feature Composition (Vendor B M11 P1 GAP CLOSURE — RR Pick n Mix + MJ KOP + KISS + 5 Treasures)
  { kind: 'reports/acceptance', src: 'reports/acceptance/PLAYER_ELECTS_FEATURE_COMPOSITION.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/PLAYER_ELECTS_FEATURE_COMPOSITION.md' },
  // REPORTS — Wave 189 Random Feature-Injection During FS (Vendor B M12 P1 GAP CLOSURE — Wizard of Oz Munchkinland + WMS sub-feature library)
  { kind: 'reports/acceptance', src: 'reports/acceptance/RANDOM_FEATURE_INJECTION_DURING_FS.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/RANDOM_FEATURE_INJECTION_DURING_FS.md' },
  // REPORTS — Wave 190 Nested Mini-Slot Inside Bonus (Vendor B M14 P1 GAP CLOSURE — LOTR Two Towers + Return of the King + Star Trek)
  { kind: 'reports/acceptance', src: 'reports/acceptance/NESTED_MINI_SLOT_INSIDE_BONUS.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/NESTED_MINI_SLOT_INSIDE_BONUS.md' },
  // REPORTS — Wave 100 Centenary Retrospective (W152 milestone)
  { kind: 'reports/dossier', src: 'reports/dossier/CENTENARY_RETROSPECTIVE_W33_100.md' },
  // REPORTS — Wave 63/68 exact-enumeration ground-truth
  { kind: 'reports/acceptance', src: 'reports/acceptance/EXACT_ENUMERATION.json' },
  { kind: 'reports/acceptance', src: 'reports/acceptance/EXACT_ENUMERATION.md' },
  // DOCS — Wave 67 industry pattern catalog v2
  { kind: 'docs', src: 'docs/INDUSTRY_PATTERN_CATALOG.md' },

  // REPORTS — W7.x futuristic close-out (2026-05-29 batch)
  // Marked `optional` so the package builds even if a wave hasn't been
  // re-run since checkout; binary artefacts (sqlite / html) skip the
  // text-based content hash and use the file SHA-256 directly.
  { kind: 'reports/acceptance', src: 'reports/acceptance/MATH_GENOME.json', optional: true },
  { kind: 'reports/acceptance', src: 'reports/acceptance/ANOMALY_SELF_PLAY.json', optional: true },
  { kind: 'reports/acceptance', src: 'reports/acceptance/GDD_ASSET_MANIFEST.json', optional: true },
  { kind: 'reports/acceptance', src: 'reports/acceptance/UNIFIED_AUDIT.json', optional: true },
  { kind: 'reports/acceptance', src: 'reports/acceptance/QMC_CONVERGENCE.json', optional: true },
  { kind: 'reports/acceptance', src: 'reports/acceptance/FAULT_INJECTION.json', optional: true },
  { kind: 'reports/dashboards', src: 'reports/dashboards/live-par-compiler.html', optional: true, binary: true },
  { kind: 'reports/dashboards', src: 'reports/dashboards/par-verification.html', optional: true, binary: true },
  { kind: 'reports/vendor-graph', src: 'reports/vendor-graph/vendor.sqlite', optional: true, binary: true },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function sha256File(path) {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

function shortSha() {
  try {
    return execSync('git rev-parse --short=12 HEAD', { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
  } catch { return 'unknown'; }
}

function gitDirtyMarker() {
  try {
    const out = execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
    return out.length > 0 ? '-DIRTY' : '';
  } catch { return ''; }
}

function ensureBuilt() {
  if (!existsSync(join(REPO_ROOT, 'dist', 'engine', 'irSimulator.js'))) {
    console.log('  → npm run build (dist/ missing)');
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' });
  }
}

function runAcceptance() {
  console.log('Refreshing acceptance suites…');
  ensureBuilt();
  for (const s of ACCEPTANCE_SUITES) {
    process.stdout.write(`  ${s.id.padEnd(28)} `);
    const t0 = Date.now();
    const res = spawnSync('bash', ['-c', s.cmd], { cwd: REPO_ROOT, encoding: 'utf-8' });
    const wallMs = Date.now() - t0;
    if (res.status !== 0 && !s.optional) {
      console.log(`❌ exit ${res.status} (${wallMs}ms) — STOPPING`);
      console.error('STDERR:', (res.stderr || '').slice(0, 500));
      process.exit(2);
    }
    if (res.status !== 0 && s.optional) {
      console.log(`⏭ skipped (optional, exit ${res.status}, ${wallMs}ms)`);
    } else {
      console.log(`✅ (${wallMs}ms)${s.lite ? ' [lite]' : ''}`);
    }
  }
}

// ─── Build ZIP ─────────────────────────────────────────────────────────────

async function buildZip(tag) {
  const zipName = `slot-math-engine-${tag}-operator-pkg.zip`;
  const zipPath = join(OUT_DIR, zipName);
  const manifestName = `slot-math-engine-${tag}-operator-pkg.MANIFEST.json`;
  const manifestPath = join(OUT_DIR, manifestName);

  // Use a temp staging dir with the layout we want, then zip from there
  const stage = join(tmpdir(), `slot-math-pkg-${tag}-${Date.now()}`);
  const stageInner = join(stage, `slot-math-engine-${tag}-operator-pkg`);
  mkdirSync(stageInner, { recursive: true });

  console.log();
  console.log(`Staging package at ${stageInner}`);

  const manifestEntries = [];
  let copied = 0, skipped = 0;

  for (const f of PACKAGE_FILES) {
    const srcAbs = join(REPO_ROOT, f.src);
    if (!existsSync(srcAbs)) {
      console.log(`  ⏭ ${f.src} (not present)`);
      skipped++;
      continue;
    }
    const dstRel = f.kind === 'top' ? f.dst : join(f.kind, basename(f.src));
    const dstAbs = join(stageInner, dstRel);
    mkdirSync(dirname(dstAbs), { recursive: true });
    copyFileSync(srcAbs, dstAbs);
    manifestEntries.push({
      path: dstRel,
      sourceRepoPath: f.src,
      sha256: sha256File(srcAbs),
      sizeBytes: statSync(srcAbs).size,
    });
    copied++;
  }

  // git archive source/
  const sourceArchive = join(stageInner, 'SOURCE', `slot-math-engine-source-${tag}.tar.gz`);
  mkdirSync(dirname(sourceArchive), { recursive: true });
  console.log(`  → git archive → ${basename(sourceArchive)}`);
  execSync(`git archive --format=tar.gz HEAD -o "${sourceArchive}"`, { cwd: REPO_ROOT });
  manifestEntries.push({
    path: relativeInPkg(sourceArchive, stageInner),
    sourceRepoPath: '(git archive HEAD)',
    sha256: sha256File(sourceArchive),
    sizeBytes: statSync(sourceArchive).size,
  });
  copied++;

  // README.md
  const readmePath = join(stageInner, 'README.md');
  writeFileSync(readmePath, renderReadme(tag, manifestEntries));
  manifestEntries.push({
    path: 'README.md',
    sourceRepoPath: '(generated)',
    sha256: sha256File(readmePath),
    sizeBytes: statSync(readmePath).size,
  });
  copied++;

  // W210 — pre-built lab bundles (GLI, BMM, eCOGRA, NMi) + cert pipeline snapshot.
  try {
    const { rehearseAll } = await import('./lab-submission-rehearsal.mjs');
    const labOutDir = join(stageInner, 'CERT_LAB_BUNDLES');
    mkdirSync(labOutDir, { recursive: true });
    const rows = await rehearseAll({ output: labOutDir, root: REPO_ROOT });
    for (const r of rows) {
      const labBundle = join(labOutDir, r.lab, r.bundle);
      if (existsSync(labBundle)) {
        manifestEntries.push({
          path: relativeInPkg(labBundle, stageInner),
          sourceRepoPath: '(generated by lab-submission-rehearsal.mjs)',
          sha256: sha256File(labBundle),
          sizeBytes: statSync(labBundle).size,
        });
        copied++;
      }
    }
    const snapshot = {
      generatedAtUtc: new Date().toISOString(),
      labs: rows.map((r) => ({
        lab: r.lab,
        jurisdiction: r.jurisdiction,
        bundle: r.bundle,
        bytes: r.bytes,
        files: r.files,
        sha256: r.sha256,
        signaturePrefix: r.signature,
        sigOk: r.sigOk,
      })),
    };
    const snapPath = join(stageInner, 'CERT_LAB_BUNDLES', 'CERT_PIPELINE_SNAPSHOT.json');
    writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
    manifestEntries.push({
      path: relativeInPkg(snapPath, stageInner),
      sourceRepoPath: '(generated cert-pipeline snapshot)',
      sha256: sha256File(snapPath),
      sizeBytes: statSync(snapPath).size,
    });
    copied++;
    console.log(`  → CERT_LAB_BUNDLES/ — ${rows.length} lab bundles + pipeline snapshot`);
  } catch (e) {
    console.log(`  ⏭ CERT_LAB_BUNDLES/ skipped (${e.message ?? e})`);
  }

  // MANIFEST.json
  const manifestObj = {
    schema: 'operator-package-manifest/v2',
    operatorPackageVersion: 5,
    generatedAtUtc: new Date().toISOString(),
    package: zipName,
    repoSha: tag,
    entryCount: manifestEntries.length,
    entries: manifestEntries.sort((a, b) => a.path.localeCompare(b.path)),
  };
  const manifestInPkg = join(stageInner, 'MANIFEST.json');
  writeFileSync(manifestInPkg, JSON.stringify(manifestObj, null, 2));
  writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2)); // also outside

  // Build ZIP
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(zipPath)) rmSync(zipPath);
  console.log(`  → zip ${zipName}`);
  execSync(`cd "${stage}" && zip -qr "${zipPath}" "slot-math-engine-${tag}-operator-pkg"`, { stdio: 'inherit' });

  const zipSize = statSync(zipPath).size;
  console.log();
  console.log(`✅ ${zipName} (${(zipSize / 1024).toFixed(1)} KB)`);
  console.log(`   ${copied} files packaged, ${skipped} skipped (missing)`);
  console.log(`   manifest: ${manifestName}`);
  console.log(`   path: ${zipPath}`);

  // Cleanup stage
  rmSync(stage, { recursive: true, force: true });

  return { zipPath, manifestPath, copied, skipped };
}

function relativeInPkg(absolute, stageInner) {
  return absolute.slice(stageInner.length + 1);
}

function renderReadme(tag, entries) {
  const out = [];
  out.push(`# Slot Math Engine — Operator Package`);
  out.push('');
  out.push(`> Generated from repo SHA \`${tag}\``);
  out.push('');
  out.push('## Quick Start');
  out.push('');
  out.push('1. **Read** `INDUSTRY_FIRST_DOSSIER.md` first — top-level summary of 9 industry-first acceptance proofs.');
  out.push('2. **Read** `COMMERCIAL_PITCH.md` — 3-minute pitch for Tier-1 sales.');
  out.push('3. **Drill into** `reports/` — every claim in the dossier links to a JSON+MD report.');
  out.push('4. **Inspect** `SOURCE/slot-math-engine-source-*.tar.gz` — full source code as of generation.');
  out.push('5. **Validate** `SCHEMAS/usif-par-v1.0.json` — open standard for PAR sheet emission.');
  out.push('');
  out.push('## Package Layout');
  out.push('');
  out.push('```');
  const grouped = new Map();
  for (const e of entries) {
    const dir = e.path.includes('/') ? e.path.split('/')[0] : '(top-level)';
    if (!grouped.has(dir)) grouped.set(dir, []);
    grouped.get(dir).push(e.path);
  }
  for (const [dir, paths] of [...grouped.entries()].sort()) {
    out.push(`${dir}/`);
    for (const p of paths.sort()) out.push(`  ${p}`);
  }
  out.push('```');
  out.push('');
  out.push('## Verification');
  out.push('');
  out.push('Every file has a SHA-256 in `MANIFEST.json`. Recompute and compare to verify integrity:');
  out.push('');
  out.push('```bash');
  out.push('# Linux/macOS');
  out.push('cd slot-math-engine-' + tag + '-operator-pkg');
  out.push('jq -r \'.entries[] | .sha256 + "  " + .path\' MANIFEST.json | shasum -a 256 -c');
  out.push('```');
  out.push('');
  out.push('## Re-running suites locally');
  out.push('');
  out.push('Untar the source archive, install, build, run any suite:');
  out.push('');
  out.push('```bash');
  out.push('tar xzf SOURCE/slot-math-engine-source-' + tag + '.tar.gz');
  out.push('cd slot-math-engine-source-' + tag);
  out.push('npm ci && npm run build');
  out.push('npm run metamorphic-rtp                # Wave 33 — Metamorphic RTP suite');
  out.push('npm run mutation-gate                  # Wave 34 — Mutation regression gate');
  out.push('npm run usif-par-validate              # Wave 35 — PAR schema');
  out.push('npm run jurisdiction-auto-gate         # Wave 36 — Jurisdiction matrix');
  out.push('npm run diff-fuzz-cross-lang           # Wave 37 — Cross-language fuzz');
  out.push('npm run sp80090b-assess                # Wave 39 — SP 800-90B entropy');
  out.push('npm run par-commitment-acceptance      # Wave 40 — PAR commitment');
  out.push('npm run ent-assess                     # Wave 43 — ENT battery');
  out.push('npm run industry-first-dossier         # Wave 41 — refresh dossier');
  out.push('npm run sales-demo                     # Wave 30/42 — 8-step live demo (~2.2s)');
  out.push('```');
  out.push('');
  out.push('## Support');
  out.push('');
  out.push('Questions / lab submissions / commercial conversations: contact the operator who shared this package.');
  return out.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const tag = TAG_OVERRIDE ?? (shortSha() + gitDirtyMarker());
  console.log(`Operator Package Builder — repo SHA \`${tag}\``);
  console.log();

  if (!SKIP_ACCEPTANCE) {
    runAcceptance();
    // Always refresh dossier after suites
    console.log();
    process.stdout.write('  industry-first-dossier      ');
    const t0 = Date.now();
    const res = spawnSync('bash', ['-c', 'node scripts/industry-first-dossier.mjs'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    const wallMs = Date.now() - t0;
    if (res.status !== 0) {
      console.log(`❌ exit ${res.status} (${wallMs}ms)`);
      console.error(res.stderr.slice(0, 500));
      process.exit(2);
    }
    console.log(`✅ (${wallMs}ms)`);
  } else {
    console.log('Skipping acceptance refresh (--skip-acceptance) — using cached reports');
  }

  await buildZip(tag);
}

main().catch((e) => { console.error(e); process.exit(2); });
