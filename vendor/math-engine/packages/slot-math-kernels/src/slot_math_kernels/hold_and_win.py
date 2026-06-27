"""W244 wave 27 — closed-form analytical model for `hold_and_win`.

Industry pattern (IGT Lightning Link, Aristocrat Dragon Cash, Scientific
Games Lightning Cash, Pragmatic Big Bass H&W, Quickspin Hold'n'Link):

  Hold & Win bonus mode
  ---------------------
    Identical respin mechanics to money_collect — money symbols lock,
    respin counter resets. KEY DIFFERENCE: money symbols may carry a
    JACKPOT TRIGGER TAG (mini / minor / major / grand). When such symbol
    lands AND episode terminates with grid OR specific config (full
    column / full grid), the tagged jackpot is awarded ON TOP of the
    cash collection.

  Award decomposition
  -------------------
    Total H&W award per trigger:
      = SUM(money_values_locked) × bet   [cash-collection component]
      + SUM(triggered_jackpot_values)    [jackpot tier component]

    Reuses `money_collect` for the cash side, `must_hit_by` for jackpot
    contribution flow accounting. This kernel COMPOSES them and emits
    a unified audit dict.

  Closed-form RTP contribution
  ----------------------------
    RTP_HW = RTP_money_collect_only + RTP_jackpot_tiers_only

    where the two components are computed independently and summed
    (assumes jackpot probability is small enough that joint conditioning
    is second-order — industry-standard approximation).

Pure-stdlib. Composes:
  * tools.math_dsl.money_collect
  * tools.math_dsl.must_hit_by
"""
from __future__ import annotations

from dataclasses import dataclass

from .money_collect import (
    MoneyCollectParams,
    money_collect_rtp_contribution,
)
from .must_hit_by import (
    MustHitByParams,
    MustHitByPot,
    must_hit_by_rtp,
)


@dataclass(frozen=True)
class HoldAndWinParams:
    """Composed H&W model: money_collect + jackpot tiers."""
    money_params: MoneyCollectParams
    jackpot_pots: tuple[MustHitByPot, ...]

    def __post_init__(self):
        if not self.jackpot_pots:
            raise ValueError("jackpot_pots must be non-empty (use money_collect alone otherwise)")


def hold_and_win_rtp(params: HoldAndWinParams) -> dict:
    """Per-base-spin RTP + per-component breakdown."""
    money_result = money_collect_rtp_contribution(params.money_params)
    jackpot_result = must_hit_by_rtp(
        MustHitByParams(pots=params.jackpot_pots)
    )
    total_rtp = money_result["rtp_contribution"] + jackpot_result["rtp_contribution"]
    return {
        "rtp_contribution": total_rtp,
        "money_component": {
            "rtp_contribution": money_result["rtp_contribution"],
            "trigger_p": money_result["trigger_p"],
            "expected_value_per_money": money_result["expected_value_per_money"],
            "expected_total_per_episode": money_result["expected_total_per_episode"],
        },
        "jackpot_component": {
            "rtp_contribution": jackpot_result["rtp_contribution"],
            "pots_count": len(jackpot_result["pots"]),
            "pots": jackpot_result["pots"],
        },
    }
