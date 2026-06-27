# Changelog

All notable changes to `slot-math-kernels` are documented here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`slot-math` CLI entry-point** (`pyproject.toml` `[project.scripts]`):
  - `slot-math list` — enumerate 22 kernels with one-line docs
  - `slot-math info <kernel>` — docstring + public API surface
  - `slot-math both-ways --ltr-rtp X --share Y` — quick closed-form RTP
  - `slot-math charge-meter --expected-charge X --tier name:thresh:award`
  - `slot-math buy-feature --bonus X --cost Y --base-rtp Z --target W`
  - `slot-math run <kernel> --config params.json` — generic JSON-driven runner
  - `slot-math --version` — package version
  - All output JSON on stdout, pipeable to `jq` / `python -m json.tool`

## [1.0.0] — 2026-05-30

First public release. 22 closed-form slot math kernels, fully vendored
(no monorepo path dependency).

### Added

- **20 math kernels** covering all major industry slot mechanics:
  - `charge_meter` (Starburst meter / Money Cart)
  - `money_collect` (Cash Eruption / Money Train; Markov DP)
  - `must_hit_by` (Lightning Link / Dragon Link mystery pot)
  - `pick_chain` (Mega Moolah / Mighty Cash multi-level)
  - `buy_feature` (BTG / Pragmatic Bonus Buy with UKGC RTS 13C + MGA RG 2021/02 gates)
  - `wheel` (Wheel of Fortune / Megafortune; geometric amortisation)
  - `state_machine` (Supermeter / Stakelogic mode; Markov stationary via Gauss)
  - `expanding_symbol` (Book of Dead / Book of Ra FS)
  - `persistent_multiplier` (Sticky Bandits / Mighty Wild; exact DP w/ cap)
  - `cascade` (Sweet Bonanza / Money Train tumble)
  - `cluster_pays` (Aloha / Gates of Olympus)
  - `sticky_wilds` (Sticky Bandits Wild / Pyramid King)
  - `stacked_wilds` (Mega Moolah / Buffalo 1024-ways)
  - `ways_evaluator` (Megaways 117649 / 1024 / 243)
  - `pay_anywhere` (Sweet Bonanza scatter / Gonzo)
  - `both_ways` (Thunderstruck II / Starburst both-ways)
  - `asymmetric_paytable` (Twin Spin / Wild West Gold / Wild Toro)
  - `hold_and_win` (composed: money_collect + must_hit_by)
  - `crash_kernel` (Stake-style Provably Fair Crash; Pareto)
  - `both_ways_expanding_wild` (composed kernel)
- **2 solver kernels**:
  - `inverse_solver` (Newton-Raphson 1-D + Bisection 1-D)
  - `multi_dim_inverse_solver` (N-D Newton-Raphson with Gauss elimination)
- **5 runnable examples** in `examples/`:
  - `01_charge_meter_starburst.py`
  - `02_buy_feature_compliance.py`
  - `03_inverse_solver_designer.py`
  - `04_wheel_megafortune.py`
  - `05_money_collect_cash_eruption.py`

### Engineering guarantees

- **Pure-stdlib**: zero runtime deps (no numpy / scipy / sympy / z3).
- **Deterministic**: byte-stable output across runs (regulator audit).
- **Cross-language parity**: ULP-stable Python ↔ Rust port (max delta 9.42e-15 across 18 kernels in the upstream monorepo).
- **Mutation tested**: Stryker score 98.88 % on the underlying TypeScript layer; 22/22 kernels lint-clean per `kernel_lint` (KLINT001-KLINT010).
- **MIT licensed** (this package).

### Documentation

- `README.md` with quick-start + 22-kernel coverage table
- `LICENSE` (MIT)
- 5 runnable example scripts with assertions
- Upstream monorepo: <https://github.com/Bojan20/slot-math-engine-template>
- Industry-First Dossier (89 IFs): `reports/dossier/INDUSTRY_FIRST_DOSSIER.{json,md,html}` in monorepo
- Regulator Portal: `reports/dossier/REGULATOR_PORTAL.html` in monorepo

### Supported Python versions

- Python 3.10, 3.11, 3.12 (CI-tested)
- Should work on 3.13/3.14 (pure-stdlib, but not gated)

[1.0.0]: https://github.com/Bojan20/slot-math-engine-template/releases/tag/v1.0.0
