"""W244 wave 16 — closed-form analytical model for `wheel` feature.

Industry pattern (Wheel of Fortune-style bonus wheel, Multi-tier WAP
jackpot wheel, Aristocrat Dragon Cash wheel, IGT Wheel of Fortune):

  Wheel structure
  ---------------
    Player spins a wheel with N segments. Each segment has a weight
    (probability share) and an award value × bet. Special segments:

      * Credit award (positive × bet)
      * Jackpot (named pot trigger → routes to linear_progressive or
        must_hit_by kernel)
      * Spin-again (no award, re-spin the wheel; can chain bounded)
      * No-win (zero credit, terminates)

  Closed-form RTP contribution per spin
  -------------------------------------
    Per-spin RTP from a wheel feature:

        RTP = trigger_p × E[wheel_award_x_bet | trigger]

    where E[award] is the weighted expectation over segments. With
    spin-again segments, we use the absorbing Markov chain on
    {terminal | re-spin} states:

        E[award] = (sum_terminal(w_i × v_i) + sum_again(w_j × E[award])) / W_total

    Solving:
        E[award] × (1 - p_again) = sum_terminal(w_i × v_i) / W_total
        E[award] = E[terminal_award] / (1 - p_again)

    Geometric-amortised over the spin-again loops. Bounded by
    `max_spin_again` (chain cap; default 5) to prevent infinite
    loop on a degenerate distribution.

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_wheel_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_wheel_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WheelSegment:
    """One wheel segment."""
    kind: str                   # "credit" | "jackpot" | "spin_again" | "no_win"
    weight: float               # probability share (relative)
    value_x_bet: float = 0.0    # award × bet (only meaningful for kind=credit/jackpot)
    jackpot_id: str = ""        # only when kind=jackpot

    def __post_init__(self):
        if self.kind not in {"credit", "jackpot", "spin_again", "no_win"}:
            raise ValueError(f"unknown segment kind {self.kind!r}")
        if self.weight < 0:
            raise ValueError("segment weight must be ≥ 0")
        if self.kind in {"credit", "jackpot"} and self.value_x_bet < 0:
            raise ValueError("credit/jackpot value_x_bet must be ≥ 0")
        if self.kind == "jackpot" and not self.jackpot_id:
            raise ValueError("jackpot segment requires jackpot_id")


@dataclass(frozen=True)
class WheelParams:
    """Closed-form model inputs."""
    trigger_p: float                          # per-spin wheel trigger
    segments: tuple[WheelSegment, ...]
    max_spin_again: int = 5                   # cap on spin-again chain

    def __post_init__(self):
        if not (0.0 <= self.trigger_p <= 1.0):
            raise ValueError(f"trigger_p {self.trigger_p} outside [0,1]")
        if not self.segments:
            raise ValueError("segments must be non-empty")
        if self.max_spin_again < 0:
            raise ValueError("max_spin_again must be ≥ 0")


def total_weight(segments: tuple[WheelSegment, ...]) -> float:
    return sum(s.weight for s in segments)


def terminal_award_expectation(segments: tuple[WheelSegment, ...]) -> float:
    """E[award × bet | one spin lands on a terminal segment].

    Sum over (credit, jackpot, no_win) of (weight × value) / total_weight.
    Jackpot value here is the AVERAGE award for that pot (handed to the
    jackpot kernel for true closed-form; the wheel just supplies the
    `value_x_bet` as the published average).
    """
    W = total_weight(segments)
    if W <= 0:
        return 0.0
    s = 0.0
    for seg in segments:
        if seg.kind in {"credit", "jackpot"}:
            s += seg.weight * seg.value_x_bet
    return s / W


def spin_again_probability(segments: tuple[WheelSegment, ...]) -> float:
    """P(spin_again | one spin). Used by geometric-amortisation closed-form."""
    W = total_weight(segments)
    if W <= 0:
        return 0.0
    return sum(s.weight for s in segments if s.kind == "spin_again") / W


def expected_award_per_trigger(params: WheelParams) -> float:
    """E[total award | one wheel trigger], accounting for spin-again chain.

    With bounded chain (max_spin_again), use partial geometric sum:

      E_total = E_terminal × (1 + p_again + p_again^2 + ... + p_again^N)
              = E_terminal × (1 - p_again^(N+1)) / (1 - p_again)
        if p_again < 1.

    For p_again >= 1 (degenerate), the cap kicks in:
      E_total = E_terminal × (max_spin_again + 1).
    """
    e_term = terminal_award_expectation(params.segments)
    p_again = spin_again_probability(params.segments)
    N = params.max_spin_again

    if p_again >= 1.0:
        # Degenerate: every spin is spin-again → cap at N+1 hops, each
        # contributing zero terminal (since terminal weight = 0 too).
        # E_total = 0 in this case (no terminal exists).
        return 0.0 if e_term == 0 else e_term * (N + 1)
    if p_again <= 0:
        return e_term
    # Bounded geometric sum
    multiplier = (1.0 - p_again ** (N + 1)) / (1.0 - p_again)
    return e_term * multiplier


def wheel_rtp(params: WheelParams) -> dict:
    """Full per-spin RTP contribution + segment audit breakdown."""
    e_award = expected_award_per_trigger(params)
    rtp = params.trigger_p * e_award

    seg_breakdown = []
    W = total_weight(params.segments)
    for seg in params.segments:
        p_segment = seg.weight / W if W > 0 else 0.0
        seg_breakdown.append({
            "kind": seg.kind,
            "weight": seg.weight,
            "probability": p_segment,
            "value_x_bet": seg.value_x_bet,
            "jackpot_id": seg.jackpot_id or None,
        })
    return {
        "rtp_contribution": rtp,
        "trigger_p": params.trigger_p,
        "expected_award_per_trigger": e_award,
        "terminal_award_expectation": terminal_award_expectation(params.segments),
        "spin_again_probability": spin_again_probability(params.segments),
        "max_spin_again": params.max_spin_again,
        "segments": seg_breakdown,
    }
