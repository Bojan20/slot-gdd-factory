"""W244 wave 41 — closed-form analytical model for `crash` game mechanic.

Industry pattern (Stake.com Crash, Roobet Crash, BC.Game Crash,
Bustabit, all Provably Fair Crash variants):

  Crash game core
  ---------------
    Player places bet B. A multiplier X(t) rises exponentially over
    time. Game "crashes" at random multiplier C ~ Pareto distribution.
    Player must "cash out" at some multiplier T (player-selected) BEFORE
    crash to win B × T; otherwise loses B.

  Crash distribution (industry-standard)
  --------------------------------------
    P(C ≥ m) = (1 - house_edge) / m for m ≥ 1
    P(C < 1) = house_edge

    So `house_edge` = P(instant crash at 1.00×) — typical 1 % (0.01).
    Survival: P(C ≥ m) decays as 1/m beyond the floor.

  Closed-form RTP for fixed-target player
  ---------------------------------------
    Player strategy: pre-committed cashout multiplier T ≥ 1.
    P(win) = P(C ≥ T) = (1 - house_edge) / T
    Payout if win: B × T
    RTP = P(win) × T = (1 - house_edge) / T × T = (1 - house_edge)

    **Remarkable**: RTP is INDEPENDENT of player's cashout choice T.
    All targets give the same long-run RTP (= 1 - house_edge).
    What changes is variance — high T = rare-big wins, low T = frequent-small.

  Variance per round
  ------------------
    E[X] = (1 - house_edge)               # constant
    E[X²] = (1 - house_edge) × T          # grows linearly in T
    Var[X] = E[X²] - E[X]² = T × (1 - hE) - (1 - hE)²
           = (1 - hE) × (T - (1 - hE))

    Higher T → higher variance → higher player risk/reward.

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_crash_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_crash_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CrashParams:
    """Closed-form model inputs."""
    house_edge: float                # P(instant crash at 1.00×); typical 0.01
    cashout_multiplier: float        # player-committed cashout T ≥ 1.00

    def __post_init__(self):
        if not (0.0 <= self.house_edge < 1.0):
            raise ValueError(f"house_edge {self.house_edge} outside [0, 1)")
        if self.cashout_multiplier < 1.0:
            raise ValueError(
                f"cashout_multiplier {self.cashout_multiplier} must be ≥ 1.0"
            )


def probability_of_crash_below(house_edge: float, m: float) -> float:
    """P(crash multiplier C < m) — Pareto CDF with house edge floor."""
    if m <= 1.0:
        # Below 1.0 only the instant-crash mass at the floor counts.
        return house_edge if m == 1.0 else 0.0
    # For m > 1: total mass = house_edge + (1 - house_edge) × (1 - 1/m)
    return house_edge + (1.0 - house_edge) * (1.0 - 1.0 / m)


def probability_of_win(params: CrashParams) -> float:
    """P(player wins) = P(C ≥ T) = (1 - house_edge) / T for T ≥ 1."""
    return (1.0 - params.house_edge) / params.cashout_multiplier


def rtp(params: CrashParams) -> float:
    """RTP per round — equals (1 - house_edge), independent of T."""
    return probability_of_win(params) * params.cashout_multiplier


def variance_per_round(params: CrashParams) -> float:
    """Var[X per round] = (1 - hE) × (T - (1 - hE))."""
    survival = 1.0 - params.house_edge
    return survival * (params.cashout_multiplier - survival)


def expected_rounds_to_ruin(
    params: CrashParams,
    bankroll_x_bet: float,
) -> float:
    """E[rounds to ruin | bankroll = B × bet] under Gambler's-ruin approximation.

    For sub-fair game (RTP < 1), expected rounds = bankroll / (1 - RTP).
    """
    edge = 1.0 - rtp(params)
    if edge <= 0:
        return float("inf")
    return bankroll_x_bet / edge


def crash_audit(params: CrashParams, bankroll_x_bet: float = 100.0) -> dict:
    """Full audit dict — RTP, win prob, variance, edge, ruin estimate."""
    return {
        "house_edge": params.house_edge,
        "cashout_multiplier": params.cashout_multiplier,
        "probability_of_win": probability_of_win(params),
        "rtp": rtp(params),
        "variance_per_round": variance_per_round(params),
        "edge_per_round": 1.0 - rtp(params),
        "expected_rounds_to_ruin": expected_rounds_to_ruin(params, bankroll_x_bet),
        "bankroll_x_bet": bankroll_x_bet,
        "strategy_class": (
            "conservative" if params.cashout_multiplier <= 1.5 else
            "moderate" if params.cashout_multiplier <= 5.0 else
            "aggressive"
        ),
    }
