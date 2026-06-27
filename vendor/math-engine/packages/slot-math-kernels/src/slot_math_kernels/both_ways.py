"""W244 wave 30 — closed-form analytical model for `both_ways` evaluator.

Industry pattern (Microgaming Thunderstruck II both-ways, NetEnt
Starburst both-ways, IGT Cleopatra both-ways):

  Both-ways evaluator
  ------------------
    Standard line games evaluate left-to-right only (LTR). Both-ways
    games evaluate pays in BOTH directions: LTR + right-to-left (RTL).

    Each direction independently scans paylines for the longest
    same-symbol streak starting from the relevant edge. A line pays
    if matched in EITHER direction (per industry default; some
    variants pay only longest of the two).

  Closed-form RTP contribution
  ----------------------------
    RTP[both_ways] = RTP[ltr_only] × bidirectional_multiplier

    where `bidirectional_multiplier` is typically:
      * 2.0 if all symbols pay both ways (perfect doubling)
      * < 2.0 if some symbols are LTR-only (scatter, bonus)
      * Computed empirically from PAR or MC ground truth

    Per industry convention, scatter pays don't double (they're
    anywhere-on-grid), so:

      bidirectional_multiplier ≈ 1 + (line_pay_share_of_ltr_rtp /
                                       total_ltr_rtp)

    Operator supplies `line_pay_share` from PAR. Kernel aggregates.

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_both_ways_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_both_ways_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BothWaysParams:
    """Closed-form model inputs."""
    ltr_only_rtp: float                  # LTR-only RTP (baseline)
    line_pay_share: float                # fraction of LTR RTP that doubles (line wins)
    # Remaining (1 - line_pay_share) is scatter/bonus/feature RTP — does NOT double.

    def __post_init__(self):
        if not (0.0 <= self.ltr_only_rtp <= 2.0):
            raise ValueError(
                f"ltr_only_rtp {self.ltr_only_rtp} outside [0,2]"
            )
        if not (0.0 <= self.line_pay_share <= 1.0):
            raise ValueError(
                f"line_pay_share {self.line_pay_share} outside [0,1]"
            )


def bidirectional_multiplier(params: BothWaysParams) -> float:
    """Effective multiplier on LTR RTP: 1 + line_pay_share.

    Line pays double (LTR + RTL); scatter/bonus stay flat.
    """
    return 1.0 + params.line_pay_share


def both_ways_rtp(params: BothWaysParams) -> dict:
    """Per-spin RTP after both-ways uplift."""
    mult = bidirectional_multiplier(params)
    new_rtp = params.ltr_only_rtp * mult
    line_part_ltr = params.ltr_only_rtp * params.line_pay_share
    scatter_part = params.ltr_only_rtp * (1.0 - params.line_pay_share)
    line_part_doubled = line_part_ltr * 2.0
    return {
        "rtp_contribution": new_rtp,
        "ltr_only_rtp": params.ltr_only_rtp,
        "line_pay_share": params.line_pay_share,
        "bidirectional_multiplier": mult,
        "line_pay_ltr": line_part_ltr,
        "line_pay_doubled": line_part_doubled,
        "scatter_bonus_unchanged": scatter_part,
        "uplift_x_bet": new_rtp - params.ltr_only_rtp,
    }
