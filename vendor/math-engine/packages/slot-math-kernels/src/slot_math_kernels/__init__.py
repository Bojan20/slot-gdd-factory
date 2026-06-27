"""slot-math-kernels — 20 closed-form slot math kernels.

Distribution wrapper around the W244 math kernel fleet from the
slot-math-engine-template monorepo. All kernels are pure-stdlib (no
numpy / scipy / sympy / z3-solver deps) and produce deterministic
output suitable for regulator audit + Merkle attestation.

Quick start
===========

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

Kernels (per `docs/W244_KERNEL_CATALOG.md`)
==========================================

  • charge_meter            Starburst meter / Money Cart / Power Stacks
  • money_collect           Cash Eruption / Money Train (Markov DP)
  • must_hit_by             Lightning Link / Dragon Link mystery pots
  • pick_chain              Mega Moolah / Mighty Cash multi-level
  • buy_feature             BTG/Pragmatic Bonus Buy (UKGC RTS 13C + MGA)
  • wheel                   Wheel of Fortune / Dragon Cash wheel
  • state_machine           Supermeter / Stakelogic mode switch
  • expanding_symbol        Book of Dead / Book of Ra FS
  • persistent_multiplier   Sticky Bandits / Mighty Wild
  • cascade                 Sweet Bonanza / Money Train tumble
  • cluster_pays            Aloha / Gates of Olympus
  • sticky_wilds            Sticky Bandits Wild / Pyramid King
  • stacked_wilds           Mega Moolah / Buffalo 1024-ways
  • ways_evaluator          Megaways 117649 / 1024 / 243
  • pay_anywhere            Sweet Bonanza scatter / Gonzo / Wolf Gold
  • both_ways               Thunderstruck II / Starburst both-ways
  • asymmetric_paytable     Twin Spin / Wild West Gold / Wild Toro
  • hold_and_win            Lightning Link composed kernel
  • crash_kernel            Stake-style Provably Fair Crash game
  • inverse_solver          Newton-Raphson 1-D auto-resolve
  • multi_dim_inverse_solver N-D Newton-Raphson multi-objective

License: MIT (this package). Underlying monorepo proprietary.
"""

__version__ = "1.0.0"

# 22 vendored kernel modules — fully standalone (no monorepo dep).
# Source vendored from `tools/math_dsl/*.py` at slot-math-engine-template
# wave 50 (2026-05-30). Cross-kernel deps (both_ways_expanding_wild,
# hold_and_win) rewritten to relative imports.
from . import (
    asymmetric_paytable,
    both_ways,
    both_ways_expanding_wild,
    buy_feature,
    cascade,
    charge_meter,
    cluster_pays,
    crash_kernel,
    expanding_symbol,
    hold_and_win,
    inverse_solver,
    money_collect,
    multi_dim_inverse_solver,
    must_hit_by,
    pay_anywhere,
    persistent_multiplier,
    pick_chain,
    stacked_wilds,
    state_machine,
    sticky_wilds,
    ways_evaluator,
    wheel,
)


__all__ = [
    "asymmetric_paytable",
    "both_ways",
    "both_ways_expanding_wild",
    "buy_feature",
    "cascade",
    "charge_meter",
    "cluster_pays",
    "crash_kernel",
    "expanding_symbol",
    "hold_and_win",
    "inverse_solver",
    "money_collect",
    "multi_dim_inverse_solver",
    "must_hit_by",
    "pay_anywhere",
    "persistent_multiplier",
    "pick_chain",
    "stacked_wilds",
    "state_machine",
    "sticky_wilds",
    "ways_evaluator",
    "wheel",
]
