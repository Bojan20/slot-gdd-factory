"""W244 wave 25 — closed-form analytical model for `ways_evaluator`.

Industry pattern (BTG Megaways: Bonanza, Extra Chilli, White Rabbit;
Microgaming 243-ways, 1024-ways; NetEnt Twin Spin 243-ways;
Pragmatic Big Bass Splash 4096-ways):

  Variable-rows / fixed-ways game
  -------------------------------
    Slot has N_REELS reels. Each reel reveals between `min_rows` and
    `max_rows` symbols on a given spin (random for Megaways, fixed
    for traditional 243/1024-ways).

    Ways count per spin = product over reels(row_count_per_reel).

    Per-way pay: standard left-to-right matching with symbol weights
    + paytable. Operator supplies the per-way RTP for the configured
    paytable + reel composition.

  Closed-form RTP contribution
  ----------------------------
    Per-spin RTP = E[ways_count] × per_way_rtp_x_bet

    where E[ways_count] = product over reels(E[row_count_per_reel])
    when reels are independent.

    For variable-rows topology (Megaways), each reel's row count
    follows an operator-supplied empirical distribution:
      `row_distribution[reel_idx]: {row_count: probability}`

    Closed-form scales O(n_reels × max_rows).

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_ways_evaluator_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_ways_evaluator_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WaysEvaluatorParams:
    """Closed-form model inputs."""
    # Per-reel row count distribution. Element i is a dict
    # {row_count: probability} summing to 1.0 per reel.
    row_distribution_per_reel: tuple[dict[int, float], ...]
    # Per-way RTP — what each "way" contributes on average per spin.
    # Industry typical: ~ 0.96 / E[ways] so total = ~96 % when × E[ways].
    per_way_rtp_x_bet: float

    def __post_init__(self):
        if not self.row_distribution_per_reel:
            raise ValueError("row_distribution_per_reel must be non-empty")
        if self.per_way_rtp_x_bet < 0:
            raise ValueError("per_way_rtp_x_bet must be ≥ 0")
        for i, dist in enumerate(self.row_distribution_per_reel):
            if not isinstance(dist, dict) or not dist:
                raise ValueError(
                    f"reel {i} row_distribution must be non-empty dict"
                )
            for rows, prob in dist.items():
                if rows < 1:
                    raise ValueError(
                        f"reel {i}: row count {rows} must be ≥ 1"
                    )
                if prob < 0:
                    raise ValueError(
                        f"reel {i}: probability {prob} must be ≥ 0"
                    )
            s = sum(dist.values())
            if abs(s - 1.0) > 1e-9:
                raise ValueError(
                    f"reel {i}: probabilities sum to {s}, expected 1.0"
                )


def expected_rows_per_reel(
    params: WaysEvaluatorParams,
) -> tuple[float, ...]:
    """E[row_count] per reel."""
    return tuple(
        sum(rows * prob for rows, prob in dist.items())
        for dist in params.row_distribution_per_reel
    )


def expected_ways_count(params: WaysEvaluatorParams) -> float:
    """E[ways] = product over reels(E[row_count_per_reel]).

    Valid only if reels are independent (industry-standard assumption).
    """
    e_rows = expected_rows_per_reel(params)
    out = 1.0
    for e in e_rows:
        out *= e
    return out


def ways_evaluator_rtp(params: WaysEvaluatorParams) -> dict:
    """Per-spin RTP + per-reel breakdown."""
    e_rows = expected_rows_per_reel(params)
    e_ways = expected_ways_count(params)
    rtp = e_ways * params.per_way_rtp_x_bet

    per_reel = []
    for i, (dist, e_r) in enumerate(zip(params.row_distribution_per_reel, e_rows)):
        per_reel.append({
            "reel_index": i,
            "expected_rows": e_r,
            "row_distribution": dict(dist),
        })

    return {
        "rtp_contribution": rtp,
        "n_reels": len(params.row_distribution_per_reel),
        "expected_rows_per_reel": list(e_rows),
        "expected_ways_count": e_ways,
        "per_way_rtp_x_bet": params.per_way_rtp_x_bet,
        "per_reel_breakdown": per_reel,
    }
