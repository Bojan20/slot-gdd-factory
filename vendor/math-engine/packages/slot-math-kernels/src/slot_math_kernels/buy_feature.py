"""W244 wave 15 — closed-form analytical model for `buy_feature` (Bonus Buy).

Industry pattern (BTG Bonus Buy, Pragmatic Buy Feature, Hacksaw all-buy,
Push Gaming Bonus Buy, Nolimit City Feature Buy):

  Player pays `buy_cost_x_bet` × bet to immediately enter the bonus
  (typically free spins) without waiting for the natural trigger. The
  bonus then runs identically to the natural-trigger version.

  Regulatory contract (UKGC RTS 13C, MGA RG 2021/02):
    The buy MUST be FAIR — that is, the long-run RTP when buying must
    not exceed the long-run RTP when playing the base game normally
    by more than a small tolerance (typically ≤ 0.5 pp).

  Closed-form fair-price computation
  ----------------------------------
    Fair price ratio: buy_cost_x_bet × bet should yield
    E[bonus_award] ≥ buy_cost_x_bet × bet × target_buy_rtp

    where target_buy_rtp is typically the same as the base game RTP
    (UKGC) or a regulator-set ceiling (MGA caps buy RTP at 96 %).

    From the bonus side:
      E[bonus_award_x_bet] = bonus_average_pay_x_bet (closed-form
                              over FS structure)
      fair_buy_cost_x_bet  = bonus_average_pay_x_bet / target_buy_rtp

  Buy RTP delta vs base RTP
  -------------------------
    Operators commonly target buy_rtp slightly HIGHER than base_rtp
    (within regulator tolerance) to incentivise the buy purchase.
    Delta is a regulator-monitored metric.

      buy_rtp = bonus_average_pay_x_bet / buy_cost_x_bet
      delta_pp_vs_base = (buy_rtp - base_rtp) × 100

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission (buy_cost validation)
  * `tools/build_buy_feature_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_buy_feature_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BuyFeatureParams:
    """Closed-form model inputs."""
    bonus_average_pay_x_bet: float    # E[bonus award × bet | bonus runs]
    buy_cost_x_bet: float             # what player pays to buy in
    base_game_rtp: float              # base game (non-bonus) RTP
    target_buy_rtp: float = 0.96      # operator-set buy RTP target

    def __post_init__(self):
        if self.bonus_average_pay_x_bet < 0:
            raise ValueError("bonus_average_pay_x_bet must be ≥ 0")
        if self.buy_cost_x_bet <= 0:
            raise ValueError("buy_cost_x_bet must be > 0")
        if not (0.0 < self.base_game_rtp <= 1.0):
            raise ValueError(
                f"base_game_rtp {self.base_game_rtp} outside (0, 1]"
            )
        if not (0.0 < self.target_buy_rtp <= 1.0):
            raise ValueError(
                f"target_buy_rtp {self.target_buy_rtp} outside (0, 1]"
            )


def buy_rtp(params: BuyFeatureParams) -> float:
    """Buy RTP = E[bonus award] / buy cost.

    > 1.0 means EV > 0 from the buy (operator-side risk).
    < 1.0 means buyer-side risk (long-run loss to buying).
    """
    return params.bonus_average_pay_x_bet / params.buy_cost_x_bet


def fair_buy_cost_x_bet(params: BuyFeatureParams) -> float:
    """Cost that achieves target_buy_rtp exactly.

        fair_cost = bonus_pay / target_rtp
    """
    return params.bonus_average_pay_x_bet / params.target_buy_rtp


def delta_pp_vs_base(params: BuyFeatureParams) -> float:
    """(buy_rtp - base_game_rtp) × 100, in percentage points."""
    return (buy_rtp(params) - params.base_game_rtp) * 100.0


def ukgc_rts13c_pass(params: BuyFeatureParams, tolerance_pp: float = 0.5) -> bool:
    """UKGC RTS 13C: buy_rtp must not exceed base_game_rtp by more
    than `tolerance_pp` percentage points (default 0.5 pp).

    NOTE: RTS 13C also requires buy RTP to be DISCLOSED to the player
    via the help screen + game info menu before purchase. This kernel
    only validates the math; UI disclosure is enforced separately at
    runtime in `src/ui/buy_feature_disclosure.ts`.
    """
    return abs(delta_pp_vs_base(params)) <= tolerance_pp


def mga_2021_02_pass(params: BuyFeatureParams, ceiling_rtp: float = 0.96) -> bool:
    """MGA RG 2021/02: buy_rtp must not exceed `ceiling_rtp` (default 96 %).

    Stricter than UKGC — caps the absolute buy RTP rather than the
    delta vs base.
    """
    return buy_rtp(params) <= ceiling_rtp


def buy_feature_audit(params: BuyFeatureParams) -> dict:
    """Full audit dict — RTP, fair cost, deltas, jurisdiction passes."""
    return {
        "bonus_average_pay_x_bet": params.bonus_average_pay_x_bet,
        "buy_cost_x_bet": params.buy_cost_x_bet,
        "base_game_rtp": params.base_game_rtp,
        "target_buy_rtp": params.target_buy_rtp,
        "buy_rtp": buy_rtp(params),
        "fair_buy_cost_x_bet": fair_buy_cost_x_bet(params),
        "delta_pp_vs_base": delta_pp_vs_base(params),
        "delta_pp_vs_target": (
            (buy_rtp(params) - params.target_buy_rtp) * 100.0
        ),
        "ukgc_rts13c_pass_0p5": ukgc_rts13c_pass(params, 0.5),
        "ukgc_rts13c_pass_1p0": ukgc_rts13c_pass(params, 1.0),
        "mga_2021_02_pass_0p96": mga_2021_02_pass(params, 0.96),
        "mga_2021_02_pass_0p97": mga_2021_02_pass(params, 0.97),
        # W244 wave 36 — composition compat: kernel-uniform `rtp_contribution`
        # key (= buy_rtp). Other kernels expose `rtp_contribution`; this
        # alignment lets composed kernels sum across the fleet uniformly.
        "rtp_contribution": buy_rtp(params),
    }
