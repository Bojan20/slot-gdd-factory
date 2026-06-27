# SLOT MATH ENGINE TEMPLATE

**Production-Grade Slot Math Simulator**

A professional Monte Carlo simulation engine for slot game mathematics. Designed as a reusable template for any slot game theme.

---

## 🎯 Sales / Regulator Entry Points

Open these first if you are evaluating the engine for an operator pilot, certification handoff, or commercial partnership:

| Surface | What it shows | Path |
|---|---|---|
| **Sales One-Pager** (executive, print-friendly) | One screen: real-market PAR parity Δ pp + portfolio + Merkle commitment + 94/94 QA. | [`reports/dashboards/sales-one-pager.html`](reports/dashboards/sales-one-pager.html) |
| **Operator Portal** (landing) | Navigates to every shippable dashboard + 9 top reports. | [`reports/dashboards/index.html`](reports/dashboards/index.html) |
| **Real-Market Portfolio** | 5 source games × 13 SWIDs × 5 mechanic anchors with per-game RTP / hit-freq / feature shares. | [`reports/dashboards/real-market-portfolio.html`](reports/dashboards/real-market-portfolio.html) |
| **MC Parity Dashboard** | Closed-form + Monte Carlo parity vs a real-market released-game PAR (book-expanding-bonusbuy template). | [`reports/dashboards/mc-parity-dashboard.html`](reports/dashboards/mc-parity-dashboard.html) |
| **Portfolio Validator Dashboard** | 6×13 PASS/FAIL chip matrix across every ingested IR. | [`reports/dashboards/portfolio-validator-dashboard.html`](reports/dashboards/portfolio-validator-dashboard.html) |
| **Industry-First Dossier** (HTML, 89 cards, deterministic Merkle) | 89 industry-firsts across W33-W244 — search/filter, paper-trail links. | [`reports/dossier/INDUSTRY_FIRST_DOSSIER.html`](reports/dossier/INDUSTRY_FIRST_DOSSIER.html) |
| **Regulator Portal** (3-tab single-page) | Industry Firsts + Kernel Attestation (Merkle) + Performance (sub-µs Rust benches) in one auditor-ready landing. | [`reports/dossier/REGULATOR_PORTAL.html`](reports/dossier/REGULATOR_PORTAL.html) |
| **Closed-Form Portfolio** (HTML, 120 solvers) | 120 closed-form solvers × 589 configs (100% pass rate) — searchable + status-filterable. | [`reports/dossier/CLOSED_FORM_PORTFOLIO.html`](reports/dossier/CLOSED_FORM_PORTFOLIO.html) |
| **`slot-math-kernels` PyPI package** | 22 kernels vendored, pure-stdlib, MIT-licensed, `pip install`-ready (clean-venv tested). | [`packages/slot-math-kernels/`](packages/slot-math-kernels/) |
| **Evidence Manifest** (SHA-256 Merkle root over 20 deliverables) | Cryptographic commitment so the whole sales surface verifies from one hash. | [`reports/acceptance/W4_11_EVIDENCE_MANIFEST.json`](reports/acceptance/W4_11_EVIDENCE_MANIFEST.json) |
| **Verify the bundle** | Standalone Python verifier — re-hashes every file, re-derives the Merkle root, exits non-zero on any tampering. | `python3 tools/parity/verify_evidence_manifest.py` |

The full W4.11* + W4.15 surface is re-verified on every PR via `.github/workflows/template-parity.yml` (104-spec sweep, dashboards uploaded as CI artifacts). The W244 kernel attestation + dossier HTML drift gates run on every PR via `.github/workflows/w244-kernel-attest.yml` and `.github/workflows/w244-dossier-html.yml`.

---

## Quick Start

```bash
# Install dependencies
npm install

# Run quick simulation (500K spins)
npm run sim:quick

# Run standard simulation (20M spins)
npm run sim

# Run full production simulation (100M spins)
npm run sim:full
```

---

## CLI Options

```bash
node dist/index.js [options]

OPTIONS:
  --spins <number>     Number of spins to simulate (default: 20000000)
  --bet <number>       Bet amount per spin (default: 1)
  --seed <number>      Base RNG seed for reproducibility (default: 12345)
  --workers <number>   Number of worker threads (default: CPU cores - 1)
  --mode <mode>        Simulation mode: base, fs, full (default: full)
  --out <path>         Output directory (default: ./out)
  --reels <path>       Load reel strips from external JSON file
  --config <path>      Load full game config from JSON file
  --quick              Quick run alias (sets spins=500000)
  --verbose            Enable verbose logging
  --help, -h           Show help message
```

---

## Example Commands

```bash
# Quick sanity check
npm run sim -- --quick

# Standard run with custom seed
npm run sim -- --spins 5000000 --seed 7

# Full parallel run (8 workers)
npm run sim -- --spins 20000000 --seed 12345 --workers 8

# Production run to custom output
npm run sim -- --spins 100000000 --out ./out/production_run

# Base game only (no Free Spins)
npm run sim -- --spins 1000000 --mode base
```

---

## Output Structure

Each run creates a timestamped folder:

```
out/sim_runs/2024-01-15_14-30_spins20M_seed12345_workers8/
├── SimReport.json        # Full simulation report
├── PAR.csv               # PAR sheet for certification
└── config_snapshot.json  # Frozen config for reproducibility
```

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Type checking
npm run lint
```

---

## Simulation Metrics

The simulation tracks:

| Metric | Description |
|--------|-------------|
| **RTP** | Total return to player with 95% CI |
| **Hit Rate** | Percentage of winning spins |
| **FS Trigger** | Free Spins frequency (1 in X) |
| **Avg FS Win** | Average Free Spins session payout |
| **H&W Trigger** | Hold & Win frequency (1 in X) |
| **Volatility** | Standard deviation and classification |
| **Tail Stats** | 100x+, 500x+, 1000x+ win rates |
| **Max Win** | Highest observed win in simulation |

---

## Game Specifications (Default Template)

| Parameter | Value |
|-----------|-------|
| Layout | 5x3 |
| Paylines | 10 |
| Target RTP | 96.00% |
| Max Win | 5000x |
| Volatility | High |

### Symbols

**Low Pay:** LP_1 through LP_5 (customize with your theme)

**High Pay:** HP_1 through HP_4 (customize with your theme)

**Special:** Wild (substitutes), Scatter (triggers FS), Lightning Orb (triggers H&W)

### Features

- **Free Spins:** 8/12/15 spins for 3/4/5 scatters, with progressive multiplier
- **Hold & Win:** Triggered by 5+ Lightning Orbs, collect orb values

---

## Customization Guide

### 1. Symbols (`src/model/symbols.ts`)

Define your game's symbol set:

```typescript
export enum SymbolId {
  // Low Pay - Replace with your theme
  LP_LYRE = 'LP_LYRE',
  LP_COIN = 'LP_COIN',
  // High Pay - Replace with your theme
  HP_ZEUS = 'HP_ZEUS',
  HP_HADES = 'HP_HADES',
  // Special
  WILD_SHIELD = 'WILD_SHIELD',
  SCATTER_TEMPLE = 'SCATTER_TEMPLE',
  LIGHTNING_ORB = 'LIGHTNING_ORB',
}
```

### 2. Symbol Roles (`src/config/symbolConfig.ts`)

Map your symbols to their roles:

```typescript
export const SYMBOL_ROLES: SymbolRoles = {
  wild: SymbolId.WILD_SHIELD,
  scatter: SymbolId.SCATTER_TEMPLE,
  special: SymbolId.LIGHTNING_ORB,
  topPaying: SymbolId.HP_ZEUS,
};
```

### 3. Paytable (`src/model/paytable.ts`)

Set pay values for symbol combinations:

```typescript
export const LINE_PAYTABLE: PaytableEntry[] = [
  { symbol: SymbolId.HP_ZEUS, pays: { 3: 1.5, 4: 5.0, 5: 25.0 } },
  // ...
];
```

### 4. Reel Strips (`src/model/reels.ts`)

Design symbol distribution on each reel:

```typescript
export const BASE_REELS: ReelStrip[] = [
  // REEL 1
  [LP1, LP2, HP1, LP3, LP4, LP5, ...],
  // ...
];
```

### 5. Game Config (`src/config/gameConfig.ts`)

Configure features and targets:

```typescript
export const GAME_CONFIG: GameConfig = {
  targetRTP: 0.96,
  maxWin: 5000,
  freeSpins: { awards: { 3: 8, 4: 12, 5: 15 } },
  holdAndWin: { triggerOrbCount: 5, fullGridBonus: 1000 },
  // ...
};
```

---

## Creating a Math Lock

When math is finalized:

1. Run full simulation:
   ```bash
   npm run sim -- --spins 100000000 --seed 12345
   ```

2. Verify RTP is within CI of target

3. Archive the output folder with timestamp

4. Update version in `package.json` and `gameConfig.ts`

---

## Architecture

```
src/
├── cli/           # CLI with Commander
│   └── args.ts    # Argument parser
├── config/        # Game configuration
│   ├── gameConfig.ts    # Main config
│   └── symbolConfig.ts  # Symbol role mapping
├── engine/        # Core simulation engine
│   ├── rng.ts     # XorShift128+ RNG
│   ├── spin.ts    # Grid generation
│   ├── evaluate.ts # Win evaluation
│   ├── features.ts # Free Spins logic
│   └── holdAndWin.ts # Hold & Win logic
├── model/         # Math model definitions
│   ├── symbols.ts # Symbol definitions
│   ├── paytable.ts # Pay values
│   ├── paylines.ts # Payline patterns
│   └── reels.ts   # Reel strips
├── report/        # Report generation
│   ├── reporter.ts # Report formatting
│   └── tuningAssistant.ts # Auto-tuning hints
├── sim/           # Simulation engine
│   ├── accumulator.ts # Streaming stats with bigint
│   ├── worker.ts  # Worker thread
│   └── parallel.ts # Coordinator
└── utils/         # Utilities
    ├── credits.ts # Integer credits system
    ├── bigintStats.ts # Overflow-safe statistics
    ├── histogram.ts # HDR Histogram wrapper
    └── hash.ts    # FNV-1a hashing
```

---

## Determinism Guarantees

- Same `seed` + `spins` + `config` = identical results
- Worker seeds derived via FNV-1a hash: `hash64(baseSeed, workerIndex)`
- Config checksum stored in report for verification
- All floating point stabilized for reproducibility

---

## Precision & Scale Features

### Integer Credits System

All internal calculations use integer credits to avoid floating-point precision errors:

```typescript
import { CREDIT_SCALE, betToCredits, creditsToMoney } from './utils/credits.js';

const betCredits = betToCredits(1);  // 100 credits
const winCredits = betCredits * 5;   // 500 credits (5x win)
const money = creditsToMoney(winCredits);  // 5.00
```

Benefits:
- No cumulative rounding errors over billions of spins
- Deterministic results across platforms
- Certification-grade precision

### BigInt Overflow Prevention

For simulations >100M spins, the accumulator uses `bigint` for sum of squared wins:

```typescript
// Standard number would overflow at ~1B spins
// sumWinSq can reach 10^20 for large sims
// BigInt handles it without precision loss
```

Automatic switching:
- <100M spins: Uses standard `number` (faster)
- >=100M spins: Uses `bigint` for variance calculation

---

## Guide for Non-Mathematicians

### Understanding the Metrics

| Metric | What It Means | Target Range (High Volatility) |
|--------|---------------|-------------------------------|
| **RTP (Return To Player)** | How much money the game returns to players over time. 96% RTP means for every $100 wagered, $96 is returned as wins (on average over millions of spins). | 94-97% |
| **Hit Rate** | Percentage of spins that result in ANY win. Lower = more "dead spins" between wins. | 20-30% |
| **FS 1-in-X** | How often Free Spins trigger. "1 in 150" means roughly one FS trigger every 150 spins. | 1 in 150-250 |
| **H&W 1-in-X** | How often Hold & Win triggers. | 1 in 200-300 |
| **Volatility** | How "swingy" the game is. High = rare big wins, many losses. Low = frequent small wins. | HIGH for this template |

### Understanding Confidence Intervals (CI)

The 95% CI tells you the range where the "true" RTP likely falls:
- `RTP: 95.87% +/- 0.15%` means true RTP is between 95.72% and 96.02%
- If target (96.00%) is INSIDE this range -> **Math is OK**
- If target is OUTSIDE this range -> **Math needs adjustment**

**Why you need 20M+ spins:** With fewer spins, the CI is too wide to be useful. Example:
- 100K spins: CI might be +/-2% (useless for tuning)
- 1M spins: CI might be +/-0.5% (rough guidance)
- 20M spins: CI about +/-0.1% (good for decisions)
- 100M spins: CI about +/-0.05% (production lock)

### Daily Workflow

```
1. QUICK RUN - Sanity check after changes
   npm run sim:quick
   -> Takes ~5 seconds
   -> Shows rough RTP trend
   -> Good for catching obvious breaks

2. TWEAK CONFIG - Make your changes
   -> Edit src/model/reels.ts (symbol frequency)
   -> Edit src/model/paytable.ts (pay values)
   -> Edit src/config/gameConfig.ts (features)

3. FULL RUN - Validate changes
   npm run sim -- --spins 20000000
   -> Takes ~30 seconds
   -> Shows reliable metrics
   -> Check "TUNING HINTS" section

4. COMPARE REPORTS - See what changed
   npm run compare -- out/.../runA/SimReport.json out/.../runB/SimReport.json
   -> Shows RTP delta, hit rate delta, etc.
```

### What to Do When...

| Situation | Action |
|-----------|--------|
| RTP too LOW | Add more HP symbols to reels, increase paytable values, increase Wild frequency |
| RTP too HIGH | Remove HP symbols, decrease paytable, reduce multiplier weights |
| FS too RARE | Add more Scatter symbols to reels (especially middle reels) |
| FS too FREQUENT | Remove Scatter stops from reels |
| H&W too RARE | Add more Lightning Orb symbols to reels |
| Game feels BORING | Increase hit rate (more LP symbols), decrease FS rarity |
| Max Win too LOW | Increase multiplier cap, add higher multiplier weights |

---

## Math Lock Checklist

Before declaring math "LOCKED" for production:

```
[ ] 1. RTP within +/-0.1% of target
    -> Observed RTP should be 95.9% - 96.1% for 96% target

[ ] 2. 95% CI covers target
    -> The range [CI Low - CI High] must include 96.00%

[ ] 3. Free Spins frequency in band
    -> Should be 1 in 150-250 for high volatility

[ ] 4. Hold & Win frequency reasonable
    -> Should be 1 in 200-300 for this template

[ ] 5. Hit rate appropriate
    -> Should be 20-30% for high volatility

[ ] 6. Max win observed or justified
    -> Should see 500x+ wins in simulation
    -> 5000x cap should be achievable (check math)

[ ] 7. Sufficient spins run
    -> Minimum 20M for decisions
    -> 100M for final lock

[ ] 8. Config frozen
    -> Hash recorded in SimReport.json
    -> No changes after this point

[ ] 9. Report archived
    -> SimReport.json saved with timestamp
    -> PAR.csv ready for certification
```

---

## Compare Tool

Compare two simulation runs to see what changed:

```bash
npm run compare -- path/to/runA/SimReport.json path/to/runB/SimReport.json
```

Output:
```
COMPARISON: runA vs runB
-------------------------------------
RTP:           95.87% -> 96.12%  (+0.25%)
Hit Rate:      23.4%  -> 24.1%   (+0.7%)
FS Frequency:  1/182  -> 1/165   (more frequent)
H&W Frequency: 1/245  -> 1/230   (more frequent)
Max Win:       2140x  -> 2890x   (+750x)
Volatility:    HIGH   -> HIGH    (unchanged)
-------------------------------------
```

---

## Assumptions & Simplifications

This simulator makes the following assumptions:

1. **Single bet level** - All calculations assume bet = 1. Actual bet multipliers are linear.

2. **Infinite bankroll** - No session length or stop-loss modeling.

3. **Independent spins** - Each spin is statistically independent (as required by regulation).

4. **Uniform distribution** - Reel positions are selected uniformly at random from the strip.

5. **No progressive jackpot** - Base RTP only. Progressive contribution would be additive.

6. **Win evaluation order** - Lines evaluated left-to-right, scatter evaluated separately, best symbol match used per line.

7. **FS Progressive Multiplier** - Starts at 1x, increases during feature.

---

## Contributing

We accept community PRs for:

- **New closed-form solver kernels** (`src/features/`)
- **Compliance rules** (UKGC / MGA / eCOGRA / EU GA 2024)
- **Public benchmark references** (published RTP catalogue)
- **Bug fixes** (regression test required)

Start by reading [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) —
it covers local setup, common workflows, the Vitest OOM workaround,
project layout, the PR review checklist, and the release process.

Quick contributor flow:

```bash
git clone https://github.com/Bojan20/slot-math-engine-template.git
cd slot-math-engine-template
npm install && npm run build
npm test              # 294 spec files, 7554 tests
git checkout -b feat/W206-my-solver
# … edit src/features/myNewSolver.ts + tests/my_new_solver.test.ts …
git commit -m "feat(W206): my new solver"
git push origin HEAD
# open a PR; CI gate enforces tests + lint + master TODO sync.
```

If you're adding a kernel, the acceptance bar is **MC ratio
measured/expected ∈ [0.9, 1.1]** at ≥ 1500 tournaments + **≥ 30 specs**
+ a row in `SLOTH_MASTER.md`. The closed-form portfolio
(`src/portfolio/closedForms.ts`) registers your kernel with the
operator package builder so downstream consumers see it.

For questions or design discussion, open an issue with the relevant
label (`[design]`, `[compliance]`, `[devex]`).

---

## License

MIT License - Use this template freely for your slot game projects.
