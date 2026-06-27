# slot-math-kernels

**20 closed-form slot math kernels — pure-stdlib, regulator-audit-ready.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)

## What this is

A distributable PyPI package containing the **W244 math kernel fleet** —
20 closed-form RTP / FS / jackpot / cluster / cascade / ways kernels
covering all major industry slot mechanics, with NO numpy / scipy /
sympy / z3-solver dependencies.

Each kernel:
- Pure-stdlib Python (Python 3.10+)
- Deterministic JSON output with Merkle root attestation
- Acceptance tests (Python + Rust parity gate in the monorepo)
- ULP-level (< 9.42e-15) cross-language byte-stable

## Install

```bash
pip install slot-math-kernels
```

## Command-line usage

The package installs a `slot-math` entry-point CLI:

```bash
slot-math list                                    # show all 22 kernels
slot-math info charge_meter                       # docs + API for one
slot-math both-ways --ltr-rtp 0.96 --share 0.7    # quick calc
slot-math charge-meter --expected-charge 0.5 \
          --tier classic:50:10                    # Wald RTP
slot-math buy-feature --bonus 95 --cost 100 \
          --base-rtp 0.965 --target 0.95          # UKGC/MGA audit
slot-math run wheel --config params.json          # run any kernel from JSON
```

All output is JSON on stdout — pipe to `jq` or `python -m json.tool`.

## Quick start

```python
from slot_math_kernels import charge_meter, must_hit_by

# Wald-identity multi-tier RTP for Starburst-style meter
params = charge_meter.ChargeMeterParams(
    expected_charge_per_spin=0.5,
    tiers=(
        charge_meter.ChargeTier("classic", threshold=50.0,
                                 award_value_x_bet=10.0),
    ),
)
result = charge_meter.charge_meter_rtp(params)
print(result["rtp_contribution"])  # → 0.10
```

## Runnable examples

5 working end-to-end demos in `examples/`:

| File | Pattern | Industry refs |
|---|---|---|
| `01_charge_meter_starburst.py` | Wald multi-tier meter | NetEnt Starburst / Money Cart |
| `02_buy_feature_compliance.py` | Bonus Buy + UKGC/MGA gates | BTG / Pragmatic Bonus Buy |
| `03_inverse_solver_designer.py` | Newton-Raphson auto-resolve | Goal-Seek replacement |
| `04_wheel_megafortune.py` | Geometric amortisation | Mega Fortune / WoF |
| `05_money_collect_cash_eruption.py` | Markov DP respin chain | Money Train / Cash Eruption |

Each runs in <100ms with assertions:
```bash
python examples/01_charge_meter_starburst.py
# → RTP contribution: 0.1000 ✓ Wald identity check passed
```

## Kernel coverage

| Kernel | Pattern | Tech |
|---|---|---|
| `charge_meter` | Starburst meter / Money Cart / Power Stacks | Wald identity multi-tier |
| `money_collect` | Cash Eruption / Money Train / Coin Volcano | Binomial trigger + Markov DP |
| `must_hit_by` | Lightning Link / Dragon Link mystery pot | Conservation flow + log1p |
| `pick_chain` | Mega Moolah / Mighty Cash multi-level | First-order statistic + DP |
| `buy_feature` | BTG / Pragmatic Bonus Buy | UKGC RTS 13C + MGA RG 2021/02 |
| `wheel` | Wheel of Fortune / Megafortune | Geometric amortisation w/ spin-again |
| `state_machine` | Supermeter / Stakelogic mode | Markov stationary via Gauss elim |
| `expanding_symbol` | Book of Dead / Book of Ra FS | Binomial(reels, p_per_reel) |
| `persistent_multiplier` | Sticky Bandits / Mighty Wild | Exact DP w/ cap |
| `cascade` | Sweet Bonanza / Money Train tumble | Bounded geometric chain |
| `cluster_pays` | Aloha / Gates of Olympus | Operator-dist aggregator |
| `sticky_wilds` | Sticky Bandits Wild / Pyramid King | Markov DP |
| `stacked_wilds` | Mega Moolah / Buffalo 1024-ways | Binomial PMF |
| `ways_evaluator` | Megaways 117649 / 1024 / 243 | Product over reels |
| `pay_anywhere` | Sweet Bonanza scatter / Gonzo | Binomial + min_pay_count |
| `both_ways` | Thunderstruck II / Starburst | Line-share × multiplier |
| `asymmetric_paytable` | Twin Spin / Wild West Gold | Per-shape aggregator |
| `hold_and_win` | Lightning Link composed | money_collect + must_hit_by |
| `crash_kernel` | Stake-style Provably Fair Crash | Pareto distribution |
| `inverse_solver` | designer auto-resolve target → param | Newton-Raphson + Bisection |
| `multi_dim_inverse_solver` | multi-objective auto-calibration | N-D Newton + Jacobian |

## Audit / verification

Each kernel emits a deterministic JSON artifact with `merkle_root_sha256`.
Two runs of the same input produce byte-identical output. The full
monorepo includes a CI gate verifying Python ↔ Rust port parity (max
delta 9.42e-15 ULP across 18 kernels).

## Regulator compliance

`buy_feature` codifies:
- **UKGC RTS 13C**: buy_rtp delta vs base_rtp ≤ 0.5 pp (default tolerance)
- **MGA RG 2021/02**: buy_rtp ≤ 0.96 absolute ceiling (default)

`reg-oracle` agent (in monorepo) covers 12 jurisdiction profiles
(UKGC, MGA, NV, NJ, ON, AAMS, MI, PA, BC, Quebec, GLI-16, GLI-19).

## Links

- **Catalog**: [W244_KERNEL_CATALOG.md](https://github.com/Bojan20/slot-math-engine-template/blob/main/docs/W244_KERNEL_CATALOG.md)
- **Monorepo**: https://github.com/Bojan20/slot-math-engine-template
- **Issues**: https://github.com/Bojan20/slot-math-engine-template/issues

## License

MIT (this package). Refer to the monorepo for licensing of derived works.
