"""W244 wave 20 — closed-form analytical model for `cascade` (tumble) feature.

Industry pattern (Pragmatic Sweet Bonanza, Relax Money Train, Play'n GO
Reactoonz, BTG Bonanza, all tumble/avalanche/cascade games):

  Cascade dynamics
  ----------------
    On win: winning symbols disappear, remaining symbols fall down,
    new symbols drop from top. If new arrangement triggers another
    win, cascade continues. Each consecutive cascade may carry an
    escalating multiplier (e.g. 1× → 2× → 4× → 8× → 16×).

  Closed-form RTP contribution
  ----------------------------
    Per-spin RTP from cascade tail (BEYOND the first win):

      Let p_win_per_cascade = P(cascade step also produces a win)
          base_pay_per_cascade = E[pay × bet | cascade step won]
          multiplier_at_step_n = `multiplier_ladder[n]` (1-indexed)

      E[total_pay_per_trigger] = sum_{n=1..max_chain} (
        P(reach cascade step n) × base_pay_per_cascade × multiplier_at_step_n
      )

      where P(reach step n) = p_initial_win × p_win_per_cascade^(n-1)

    Geometric chain with multiplier ramp. Bounded by `max_chain` cap.

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_cascade_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_cascade_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CascadeParams:
    """Closed-form model inputs."""
    p_initial_win: float                    # P(base spin produces a win)
    base_pay_per_cascade_x_bet: float       # E[pay × bet | cascade won]
    p_win_per_cascade: float                # P(cascade step also wins)
    multiplier_ladder: tuple[float, ...]    # mult at step 1, 2, 3, ...
    max_chain: int = 16                     # absolute cap on cascade length

    def __post_init__(self):
        if not (0.0 <= self.p_initial_win <= 1.0):
            raise ValueError(
                f"p_initial_win {self.p_initial_win} outside [0,1]"
            )
        if self.base_pay_per_cascade_x_bet < 0:
            raise ValueError("base_pay_per_cascade_x_bet must be ≥ 0")
        if not (0.0 <= self.p_win_per_cascade <= 1.0):
            raise ValueError(
                f"p_win_per_cascade {self.p_win_per_cascade} outside [0,1]"
            )
        if not self.multiplier_ladder:
            raise ValueError("multiplier_ladder must be non-empty")
        if any(m < 0 for m in self.multiplier_ladder):
            raise ValueError("multiplier_ladder entries must be ≥ 0")
        if self.max_chain < 1:
            raise ValueError("max_chain must be ≥ 1")


def expected_chain_length(params: CascadeParams) -> float:
    """E[number of cascade steps after the initial win | initial win triggered].

    Geometric arrival truncated at max_chain. For p_win_per_cascade < 1:

      E[k_cascades] = sum_{k=1..max_chain} P(at least k cascades)
                    = sum_{k=1..max_chain} p_win_per_cascade^k
                    = p × (1 - p^max_chain) / (1 - p)   if p < 1

    For p = 1: deterministic max_chain.
    """
    p = params.p_win_per_cascade
    n = params.max_chain
    if p >= 1.0:
        return float(n)
    if p <= 0:
        return 0.0
    return p * (1.0 - p ** n) / (1.0 - p)


def expected_pay_per_trigger(params: CascadeParams) -> float:
    """E[total pay × bet | initial cascade triggered].

    sum_{n=1..max_chain} P(reach step n) × base_pay × multiplier_at_step_n

    where P(reach step n) = p_win_per_cascade^(n-1) (n=1 is the initial win).
    """
    total = 0.0
    p_chain = 1.0  # P(reach step 1 | initial win triggered) = 1
    for step in range(1, params.max_chain + 1):
        idx = min(step - 1, len(params.multiplier_ladder) - 1)
        mult = params.multiplier_ladder[idx]
        total += p_chain * params.base_pay_per_cascade_x_bet * mult
        # Advance to next step: multiply by p_win_per_cascade
        p_chain *= params.p_win_per_cascade
    return total


def cascade_rtp(params: CascadeParams) -> dict:
    """Per-base-spin RTP contribution + audit breakdown."""
    e_chain_len = expected_chain_length(params)
    e_pay_per_trigger = expected_pay_per_trigger(params)
    rtp = params.p_initial_win * e_pay_per_trigger

    # Per-step expected contribution breakdown
    per_step = []
    p_chain = 1.0
    for step in range(1, params.max_chain + 1):
        idx = min(step - 1, len(params.multiplier_ladder) - 1)
        mult = params.multiplier_ladder[idx]
        contrib = p_chain * params.base_pay_per_cascade_x_bet * mult
        per_step.append({
            "step": step,
            "p_reach": p_chain,
            "multiplier": mult,
            "contribution_x_bet": contrib,
        })
        p_chain *= params.p_win_per_cascade

    return {
        "rtp_contribution": rtp,
        "p_initial_win": params.p_initial_win,
        "base_pay_per_cascade_x_bet": params.base_pay_per_cascade_x_bet,
        "p_win_per_cascade": params.p_win_per_cascade,
        "max_chain": params.max_chain,
        "expected_chain_length": e_chain_len,
        "expected_pay_per_trigger_x_bet": e_pay_per_trigger,
        "per_step_breakdown": per_step,
    }
